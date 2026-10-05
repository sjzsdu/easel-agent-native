import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishRecords } from "../server/db/schema.js";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  PLATFORM_LABELS_FALLBACK,
  engagementScore,
  engagementTotal,
} from "../server/lib/metrics.js";

/**
 * 归因聚合 (Phase 3 后半): 把手动录入的互动数据聚合成可画图的序列。
 *
 * 只聚合真实录入过的记录 — 数据缺口如实标注, 不推算不补零伪装完整。
 * 返回四个序列, 供 dashboard SVG 图表与 agent 复盘引用:
 * - 30 天互动趋势 (逐日互动总数 + 录入条数)
 * - 平台对比 (各平台互动汇总, 按 engagementScore 降序)
 * - TOP 内容排行 (按互动分前 N)
 * - 星期规律 (0-6 各星期几的平均单条互动 + 样本量)
 */
export default defineAction({
  title: "互动趋势聚合",
  description:
    "把已录入的互动数据聚合为可画图的序列: 近 30 天互动趋势、平台对比、TOP 内容排行、发布星期规律。只统计真实录入过的记录, 样本不足时如实标注。写归因周报、回答「哪类内容/哪天发效果好」、画效果图表前调用。",
  schema: z.object({
    days: z
      .number()
      .int()
      .min(7)
      .max(90)
      .optional()
      .describe("趋势窗口天数; 缺省 30"),
    topN: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("TOP 内容条数; 缺省 10"),
    platform: z.string().optional().describe("只统计某平台"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const days = args.days ?? 30;
    const topN = args.topN ?? 10;

    // 真发成功 + 手动录入的留痕都参与聚合; 失败/取消永远不参与。
    const conditions = [
      inArray(publishRecords.status, ["succeeded", "manual_assisted"]),
      isNotNull(publishRecords.publishedAt),
    ];
    if (args.platform) conditions.push(eq(publishRecords.platform, args.platform));

    const rows = await db
      .select()
      .from(publishRecords)
      .where(and(...conditions));

    // 只留已录入数据的记录; 日期以发布时间为准 (手动录入的留痕 = 录入时间, 见 metrics-save)。
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const dated = rows
      .map((row) => {
        const raw = (row.metrics ?? {}) as Record<string, unknown>;
        const metrics: Record<string, number> = {};
        for (const key of METRIC_KEYS) {
          const v = raw[key];
          if (typeof v === "number" && Number.isFinite(v)) metrics[key] = v;
        }
        const at = row.publishedAt ?? "";
        return {
          recordId: row.id,
          topic: row.topic,
          title: row.title,
          platform: row.platform,
          at,
          metrics,
          total: engagementTotal(metrics),
          score: engagementScore(metrics),
          hasData: Object.keys(metrics).length > 0,
          source: row.status === "manual_assisted" ? ("manual" as const) : ("published" as const),
        };
      })
      .filter((r) => r.hasData && r.at >= cutoff.toISOString())
      .sort((a, b) => b.at.localeCompare(a.at));

    // 分子分母同一窗口: publishedTotal 也只统计 cutoff 内的成功发布,
    // 否则 30 天前的记录只进分母不进分子, 覆盖度被低估。
    const publishedTotal = rows.filter(
      (row) => (row.publishedAt ?? "") >= cutoff.toISOString(),
    ).length;
    const withData = dated.length;

    // ── 1. 近 N 天逐日趋势 (只含有数据的日期; 空档期不伪造 0) ──
    const byDay = new Map<string, { total: number; score: number; count: number }>();
    for (const r of dated) {
      const day = r.at.slice(0, 10);
      const bucket = byDay.get(day) ?? { total: 0, score: 0, count: 0 };
      bucket.total += r.total;
      bucket.score += r.score;
      bucket.count += 1;
      byDay.set(day, bucket);
    }
    const trend = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({
        date,
        interactions: bucket.total,
        engagementScore: bucket.score,
        published: bucket.count,
      }));

    // ── 2. 平台对比 ──
    const byPlatform = new Map<string, { count: number; interactions: number; score: number; views: number }>();
    for (const r of dated) {
      const bucket = byPlatform.get(r.platform) ?? { count: 0, interactions: 0, score: 0, views: 0 };
      bucket.count += 1;
      bucket.interactions += r.total;
      bucket.score += r.score;
      bucket.views += r.metrics.views ?? 0;
      byPlatform.set(r.platform, bucket);
    }
    const platformComparison = [...byPlatform.entries()]
      .map(([platform, bucket]) => ({
        platform,
        label: PLATFORM_LABELS_FALLBACK[platform] ?? platform,
        records: bucket.count,
        interactions: bucket.interactions,
        views: bucket.views,
        engagementScore: bucket.score,
        avgScore: bucket.count ? Math.round((bucket.score / bucket.count) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore);

    // ── 3. TOP 内容排行 ──
    const top = dated.slice(0, topN).map((r, i) => ({
      rank: i + 1,
      recordId: r.recordId,
      topic: r.topic,
      title: r.title || r.topic,
      platform: r.platform,
      label: PLATFORM_LABELS_FALLBACK[r.platform] ?? r.platform,
      publishedAt: r.at,
      metrics: r.metrics,
      interactions: r.total,
      engagementScore: r.score,
    }));

    // ── 4. 星期规律 (0=周日; 样本不足的星期如实标注) ──
    const weekdayBuckets = Array.from({ length: 7 }, () => ({ score: 0, count: 0 }));
    for (const r of dated) {
      // 星期分桶用本地时区 (与用户对「哪天发的好」的直觉一致)。
      const wd = new Date(r.at).getDay();
      const bucket = weekdayBuckets[wd]!;
      bucket.score += r.score;
      bucket.count += 1;
    }
    const weekdayPattern = weekdayBuckets.map((bucket, weekday) => ({
      weekday,
      label: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekday],
      records: bucket.count,
      avgEngagement: bucket.count ? Math.round((bucket.score / bucket.count) * 10) / 10 : null,
    }));

    return {
      window: { days, generatedAt: new Date().toISOString() },
      coverage: {
        publishedSucceeded: publishedTotal,
        withMetrics: withData,
        missingMetrics: publishedTotal - withData,
        coveragePct:
          publishedTotal > 0 ? Math.round((withData / publishedTotal) * 100) : 0,
        manualEntries: dated.filter((r) => r.source === "manual").length,
        note:
          withData < 5
            ? "样本量较小 (少于 5 条已录入数据), 结论仅作参考"
            : undefined,
      },
      trend,
      platformComparison,
      top,
      weekdayPattern,
      metricLabels: METRIC_LABELS,
      source: "manual (用户手动录入, 非平台 API 回流)",
    };
  },
});
