/**
 * 归因 metrics 工具 (Phase 3 后半)。
 *
 * 数据诚实性是第一原则: P3 未接平台 API, 互动数据来自用户手动录入/粘贴。
 * 本模块只做三件事:
 * - 定义指标白名单与归一化 (数字、非负、上限), 绝不存截图/大字段
 * - 计算 engagement 总分 (统一加权, 供 TOP 排行与平台对比)
 * - 平台展示名兜底 (publish 层的 PLATFORM_LABELS 归发布工作流所有,
 *   这里自带一份静态映射, 不 import server/lib/publish 避免越界)
 */

/** 允许写入 publish_records.metrics 的指标键 (全为数字)。 */
export const METRIC_KEYS = [
  "views",
  "likes",
  "collects",
  "comments",
  "shares",
  "followersGained",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  views: "播放/浏览",
  likes: "点赞",
  collects: "收藏",
  comments: "评论",
  shares: "转发/分享",
  followersGained: "粉丝变化",
};

/** 单项指标上限 (防手滑/防脏数据; 真实互动量远低于此)。 */
const METRIC_MAX = 100_000_000;

/**
 * 归一化并校验用户录入的指标。规则:
 * - 白名单外的键拒绝 (fail-fast, 避免把截图 base64 之类塞进 jsonb)
 * - 数字字符串接受 ("123" → 123), 小数向下取整, 负数拒绝
 * - 全部合法返回 { ok: true, metrics } (空输入返回 { ok: true, metrics: {} })
 * - 任一非法返回 { ok: false, error }
 */
export function normalizeMetrics(
  input: Record<string, unknown>,
): { ok: true; metrics: Partial<Record<MetricKey, number>> } | { ok: false; error: string } {
  const metrics: Partial<Record<MetricKey, number>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!METRIC_KEYS.includes(key as MetricKey)) {
      return {
        ok: false,
        error: `不支持的指标字段: ${key} (允许: ${METRIC_KEYS.join(", ")})`,
      };
    }
    let num: number;
    if (typeof value === "number") {
      num = value;
    } else if (typeof value === "string" && value.trim() !== "") {
      num = Number(value);
    } else {
      return { ok: false, error: `指标 ${key} 必须是数字或数字字符串` };
    }
    if (!Number.isFinite(num)) {
      return { ok: false, error: `指标 ${key} 不是有效数字` };
    }
    num = Math.floor(num);
    if (num < 0) {
      return { ok: false, error: `指标 ${key} 不能为负数` };
    }
    if (num > METRIC_MAX) {
      return { ok: false, error: `指标 ${key} 超出合理上限 (${METRIC_MAX})` };
    }
    if (num > 0) metrics[key as MetricKey] = num;
  }
  return { ok: true, metrics };
}

/**
 * 统一互动分 (TOP 排行/平台对比用)。权重反映社媒运营常识:
 * 评论 > 转发 > 收藏 > 点赞; 粉丝变化单独记, 不混进单条互动分。
 */
export function engagementScore(m: Partial<Record<MetricKey, number>>): number {
  return (
    (m.likes ?? 0) * 1 +
    (m.collects ?? 0) * 2 +
    (m.comments ?? 0) * 3 +
    (m.shares ?? 0) * 2
  );
}

/** 单条记录的总互动次数 (likes+collects+comments+shares), 展示用。 */
export function engagementTotal(m: Partial<Record<MetricKey, number>>): number {
  return (
    (m.likes ?? 0) + (m.collects ?? 0) + (m.comments ?? 0) + (m.shares ?? 0)
  );
}

export const PLATFORM_LABELS_FALLBACK: Record<string, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  "wechat-oa": "公众号",
  "wechat-channels": "视频号",
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key as MetricKey] ?? key;
}
