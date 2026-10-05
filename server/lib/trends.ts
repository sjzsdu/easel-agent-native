/**
 * 多平台热榜聚合 (Easel 热点雷达的数据源).
 *
 * 主源: 60s API v2 (https://60s.viki.moe/v2/...) — 一份 JSON 聚合多个平台.
 * 备源: v2.xxapi.cn — 仅覆盖微博/抖音/B站/百度.
 * B站第三源: B站官方热搜 (api.bilibili.com — data.trending.list, keyword/heat_score).
 * 约定: 单平台 6s 超时、60s 进程内缓存、解析容错
 * (data / data.data / data.trending.list 与纯字符串条目双形态).
 */

export interface TrendItem {
  rank: number;
  title: string;
  url?: string;
  hot?: number | string;
}

export type TrendSourceId = "60s" | "xxapi" | "official";

export interface TrendResult {
  platform: string;
  label: string;
  source: TrendSourceId | "cache" | null;
  items: TrendItem[];
  error?: string;
  fetchedAt: string;
}

export interface TrendPlatformDef {
  key: string;
  label: string;
  primary: string;
  fallback?: string;
  /** 第三降级源 (B站官方接口, 仅 B站 配置). */
  extraFallback?: { url: string; source: "official" };
}

export const TREND_PLATFORMS: TrendPlatformDef[] = [
  { key: "weibo", label: "微博", primary: "https://60s.viki.moe/v2/weibo", fallback: "https://v2.xxapi.cn/api/weibohot" },
  { key: "douyin", label: "抖音", primary: "https://60s.viki.moe/v2/douyin", fallback: "https://v2.xxapi.cn/api/douyinhot" },
  { key: "zhihu", label: "知乎", primary: "https://60s.viki.moe/v2/zhihu" },
  {
    key: "bili",
    label: "B站",
    primary: "https://60s.viki.moe/v2/bili",
    fallback: "https://v2.xxapi.cn/api/bilibilihot",
    // 60s /v2/bili 常 500、xxapi 仅纯字符串标题; 官方接口稳定且带 heat_score.
    extraFallback: {
      url: "https://api.bilibili.com/x/web-interface/search/square?limit=50",
      source: "official",
    },
  },
  { key: "baidu", label: "百度", primary: "https://60s.viki.moe/v2/baidu/hot", fallback: "https://v2.xxapi.cn/api/baiduhot" },
  { key: "toutiao", label: "头条", primary: "https://60s.viki.moe/v2/toutiao" },
];

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 6_000;

const cache = new Map<string, { at: number; items: TrendItem[]; source: TrendSourceId }>();

function pickItems(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const body = raw as Record<string, unknown>;
  const data = body.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).data;
    if (Array.isArray(nested)) return nested;
    const list = (data as Record<string, unknown>).list;
    if (Array.isArray(list)) return list;
    // B站官方热搜: data.trending.list[]
    const trending = (data as Record<string, unknown>).trending;
    if (trending && typeof trending === "object") {
      const trendingList = (trending as Record<string, unknown>).list;
      if (Array.isArray(trendingList)) return trendingList;
    }
  }
  if (Array.isArray(body.list)) return body.list;
  return [];
}

function normalizeItems(rawItems: unknown[]): TrendItem[] {
  const items: TrendItem[] = [];
  for (const entry of rawItems) {
    // 纯字符串条目 (xxapi bilibilihot / weibohot 等): 标题即条目本身.
    if (typeof entry === "string") {
      const title = entry.trim();
      if (!title) continue;
      items.push({ rank: items.length + 1, title });
      if (items.length >= 50) break;
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const title =
      (typeof item.title === "string" && item.title) ||
      (typeof item.name === "string" && item.name) ||
      (typeof item.word === "string" && item.word) ||
      (typeof item.query === "string" && item.query) ||
      (typeof item.keyword === "string" && item.keyword) ||
      (typeof item.show_name === "string" && item.show_name) ||
      "";
    if (!title) continue;
    const url =
      (typeof item.url === "string" && item.url) ||
      (typeof item.mobile_url === "string" && item.mobile_url) ||
      (typeof item.link === "string" && item.link) ||
      undefined;
    const hotRaw = item.hot ?? item.num ?? item.score ?? item.heat ?? item.heat_score;
    const hot =
      typeof hotRaw === "number"
        ? hotRaw
        : typeof hotRaw === "string" && hotRaw
          ? hotRaw
          : undefined;
    items.push({ rank: items.length + 1, title, url, hot });
    if (items.length >= 50) break;
  }
  return items;
}

async function fetchItems(url: string): Promise<TrendItem[]> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "easel-agent-native/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  const items = normalizeItems(pickItems(body));
  if (items.length === 0) throw new Error("empty list");
  return items;
}

/** 热榜数据不进 SQL: 内存缓存 60s, 与原 Easel /api/trends 语义一致. */
export async function getTrends(platformKeys?: string[]): Promise<{
  fetchedAt: string;
  results: TrendResult[];
}> {
  const selected = platformKeys?.length
    ? TREND_PLATFORMS.filter((def) => platformKeys.includes(def.key))
    : TREND_PLATFORMS;

  const results = await Promise.all(
    selected.map(async (def): Promise<TrendResult> => {
      const now = Date.now();
      const cached = cache.get(def.key);
      if (cached && now - cached.at < CACHE_TTL_MS) {
        return {
          platform: def.key,
          label: def.label,
          source: "cache",
          items: cached.items,
          fetchedAt: new Date(cached.at).toISOString(),
        };
      }

      const attempts: Array<{ url: string; source: TrendSourceId }> = [
        { url: def.primary, source: "60s" },
      ];
      if (def.fallback) attempts.push({ url: def.fallback, source: "xxapi" });
      if (def.extraFallback) attempts.push(def.extraFallback);

      const errors: string[] = [];
      for (const attempt of attempts) {
        try {
          const items = await fetchItems(attempt.url);
          cache.set(def.key, { at: now, items, source: attempt.source });
          return {
            platform: def.key,
            label: def.label,
            source: attempt.source,
            items,
            fetchedAt: new Date(now).toISOString(),
          };
        } catch (error) {
          errors.push(
            `${attempt.source}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (cached) {
        return {
          platform: def.key,
          label: def.label,
          source: "cache",
          items: cached.items,
          error: `数据源暂不可用, 返回缓存 (${errors.join("; ")})`,
          fetchedAt: new Date(cached.at).toISOString(),
        };
      }
      return {
        platform: def.key,
        label: def.label,
        source: null,
        items: [],
        error: errors.join("; ") || "数据源不可用",
        fetchedAt: new Date(now).toISOString(),
      };
    }),
  );

  return { fetchedAt: new Date().toISOString(), results };
}
