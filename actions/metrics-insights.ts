import { and, eq } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { calendarEvents, contentItems, publishRecords } from "../server/db/schema.js";
import {
  METRIC_KEYS,
  PLATFORM_LABELS_FALLBACK,
  engagementScore,
  engagementTotal,
} from "../server/lib/metrics.js";

/**
 * 归因洞察 (Phase 3 后半, 加分项): metrics × 日历排期 × 内容库 的交叉分析。
 *
 * 定位: 把「人工录入的数据 + 本来就存在的排期/质检/标签数据」交叉出结构化结论,
 * 供 agent 复盘引用 — 不推算未录入的数据, 样本不足时如实标注置信度。
 * 纯读 + 纯聚合, 无新表。
 */
export default defineAction({
  title: "归因洞察",
  description:
    "交叉分析互动数据 × 日历排期 × 内容库, 产出「什么选题/标题/发布时间/内容类型效果好」的结构化结论 (bestPickPerDimension + 可复制的做法清单 + 建议规避项)。写复盘周报、下阶段选题规划、回答「为什么这条效果好」时调用。数据不足时如实返回 insufficient_data。",
  schema: z.object({
    platform: z.string().optional().describe("只分析某平台; 缺省全平台"),
    minSample: z
      .number()
      .int()
      .min(2)
      .max(50)
      .optional()
      .describe("分组结论的最小样本量; 缺省 3"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const minSample = args.minSample ?? 3;

    // 1. 已录入数据的成功发布 (归因分析的对象)。metrics 是 jsonb,
    //    先按状态取全量再在内存里过滤有真实录入的记录。
    const recordConds = [eq(publishRecords.status, "succeeded")];
    if (args.platform) recordConds.push(eq(publishRecords.platform, args.platform));
    const records = await db
      .select()
      .from(publishRecords)
      .where(and(...recordConds));
    const filtered = records.filter((r) => {
      const m = (r.metrics ?? {}) as Record<string, unknown>;
      return METRIC_KEYS.some((k) => typeof m[k] === "number");
    });

    if (filtered.length < 2) {
      return {
        status: "insufficient_data" as const,
        message:
          "可分析的已录入数据不足 2 条。先让用户通过 /metrics 录入页或 metrics-save 录入真实互动数据, 再来做归因分析。",
        withMetrics: filtered.length,
        source: "manual (用户手动录入, 非平台 API 回流)",
      };
    }

    // 2. 拉排期与内容库数据 (纯读)。
    const items = await db.select().from(contentItems);
    const events = await db.select().from(calendarEvents);
    const itemByTopic = new Map(items.map((i) => [i.topic, i]));

    type Attr = {
      recordId: string;
      topic: string;
      title: string;
      platform: string;
      publishedAt: string;
      weekday: string;
      hourBand: string;
      month: string;
      kind: string | null;
      tags: string[];
      profile: string | null;
      score: number;
      interactions: number;
    };

    const attrs: Attr[] = filtered.map((r) => {
      const m = (r.metrics ?? {}) as Record<string, number>;
      const item = itemByTopic.get(r.topic);
      const at = r.publishedAt ?? "";
      const date = new Date(at);
      // 时段分桶用本地时区: 用户关心「我几点发的好」, 与内容日历 time 口径一致。
      const hour = Number.isNaN(date.getHours()) ? null : date.getHours();
      const hourBand =
        hour === null
          ? "未记录"
          : hour < 6
            ? "凌晨(0-6)"
            : hour < 12
              ? "上午(6-12)"
              : hour < 18
                ? "下午(12-18)"
                : "晚间(18-24)";
      return {
        recordId: r.id,
        topic: r.topic,
        title: r.title || r.topic,
        platform: r.platform,
        publishedAt: at,
        weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()] ?? "未知",
        hourBand,
        month: at.slice(0, 7),
        kind: item?.kind ?? null,
        tags: item?.tags ?? [],
        profile: item?.profile ?? null,
        score: engagementScore(m),
        interactions: engagementTotal(m),
      };
    });

    const avg = attrs.reduce((s, a) => s + a.score, 0) / attrs.length;

    // 3. 通用分组分析器 (每组给出均值 vs 全局均值, 样本不足的组不参与结论)。
    function groupBy<K extends keyof Attr>(key: K) {
      const buckets = new Map<string, Attr[]>();
      for (const a of attrs) {
        const value = a[key];
        if (value == null || value === "") continue;
        const values = Array.isArray(value) ? value : [String(value)];
        for (const v of values) {
          const list = buckets.get(v) ?? [];
          list.push(a);
          buckets.set(v, list);
        }
      }
      return [...buckets.entries()]
        .map(([value, list]) => ({
          value,
          count: list.length,
          avgScore: Math.round((list.reduce((s, a) => s + a.score, 0) / list.length) * 10) / 10,
          avgInteractions:
            Math.round(
              (list.reduce((s, a) => s + a.interactions, 0) / list.length) * 10,
            ) / 10,
          vsAverage:
            Math.round(
              ((list.reduce((s, a) => s + a.score, 0) / list.length - avg) / (avg || 1)) *
                100,
            ) / 10,
          sampleNote:
            list.length < minSample ? `样本不足 (${list.length} < ${minSample}), 仅供参考` : undefined,
        }))
        .sort((a, b) => b.avgScore - a.avgScore);
    }

    const platformGroups = groupBy("platform").map((g) => ({
      ...g,
      label: PLATFORM_LABELS_FALLBACK[g.value] ?? g.value,
    }));
    const weekdayGroups = groupBy("weekday");
    const hourGroups = groupBy("hourBand");
    const kindGroups = groupBy("kind");
    const tagGroups = groupBy("tags");

    const conclusions = [
      { dimension: "平台", ...pickConclusion(platformGroups, minSample) },
      { dimension: "发布星期", ...pickConclusion(weekdayGroups, minSample) },
      { dimension: "发布时段", ...pickConclusion(hourGroups, minSample) },
      { dimension: "内容类型", ...pickConclusion(kindGroups, minSample) },
      { dimension: "标签", ...pickConclusion(tagGroups, minSample) },
    ].filter((c) => c.best !== null);

    // 4. TOP 内容的可复制做法 (标题/标签/时段拼接, 供 agent 引用)。
    const top3 = [...attrs].sort((a, b) => b.score - a.score).slice(0, 3);
    const replicablePatterns = top3.map((a) => ({
      title: a.title,
      platform: PLATFORM_LABELS_FALLBACK[a.platform] ?? a.platform,
      publishedAt: a.publishedAt,
      publishTime: `${a.weekday} ${a.hourBand}`,
      tags: a.tags,
      interactions: a.interactions,
      engagementScore: a.score,
      kind: a.kind,
    }));

    const avoidPatterns = [...attrs]
      .sort((a, b) => a.score - b.score)
      .slice(0, 2)
      .map((a) => ({
        title: a.title,
        platform: PLATFORM_LABELS_FALLBACK[a.platform] ?? a.platform,
        publishTime: `${a.weekday} ${a.hourBand}`,
        interactions: a.interactions,
        engagementScore: a.score,
      }));

    // 5. 质检关联 (若有): 内容库 steps 里 quality-gate 的分数与效果的关系。
    const gatePairs = top3.map((a) => {
      const item = itemByTopic.get(a.topic);
      const gateStep = (item?.steps ?? []).find((s) => s.skill === "quality-gate");
      return {
        topic: a.topic,
        gateScore: gateStep?.summary?.match(/(\d{1,3})\s*分/)?.[1] ?? null,
        engagementScore: a.score,
      };
    });

    return {
      status: "ok" as const,
      window: { generatedAt: new Date().toISOString() },
      sample: {
        analyzed: attrs.length,
        globalAvgScore: Math.round(avg * 10) / 10,
        note:
          attrs.length < 5
            ? "样本量较小 (少于 5 条), 结论仅作参考"
            : undefined,
      },
      conclusions,
      breakdowns: {
        byPlatform: platformGroups,
        byWeekday: weekdayGroups,
        byHourBand: hourGroups,
        byKind: kindGroups,
        byTag: tagGroups,
      },
      replicablePatterns,
      avoidPatterns,
      qualityGateCorrelation: gatePairs,
      linkedCalendarEvents: events.filter((e) => e.status === "published").length,
      source: "manual (用户手动录入, 非平台 API 回流)",
    };
  },
});

/** 分组统计行 (groupBy 的返回形状, pickConclusion 的输入)。 */
interface GroupRow {
  value: string;
  count: number;
  avgScore: number;
  avgInteractions: number;
  vsAverage: number;
  sampleNote?: string;
}

/**
 * 取一个维度里「样本达标且优于其他组」的最佳取值作为结论;
 * 达标组不足 2 个时无对比意义, 返回 best=null。
 */
function pickConclusion(
  groups: GroupRow[],
  minSample: number,
): { best: string | null; avgScore: number; vsAverage: number; sampleNote?: string } {
  const eligible = groups.filter((g) => g.count >= minSample);
  if (eligible.length < 2) return { best: null, avgScore: 0, vsAverage: 0 };
  const best = eligible[0]!;
  return {
    best: best.value,
    avgScore: best.avgScore,
    vsAverage: best.vsAverage,
    sampleNote: best.sampleNote,
  };
}
