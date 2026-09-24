import { and, desc, eq, isNotNull } from "drizzle-orm";
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
 * 归因数据查询 (Phase 3 后半)。只返回真实录入的数字 —
 * 没录入过就如实返回空, 绝不推算或补零伪装完整。
 */
export default defineAction({
  title: "查询互动数据",
  description:
    "查询已发布内容的互动数据 (播放/点赞/收藏/评论/转发/粉丝变化)。只返回用户手动录入过的真实数字: 没有数据的记录会明确标记 missing, 不推算不补零。复盘单条内容、检查「哪些还没录数据」时调用。",
  schema: z.object({
    topic: z.string().optional().describe("只看某内容项目"),
    platform: z.string().optional().describe("只看某平台"),
    onlyWithMetrics: z
      .boolean()
      .optional()
      .describe("true = 只返回已录入数据的记录; 缺省全部 (含 missing)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("返回条数上限; 缺省 50"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const conditions = [eq(publishRecords.status, "succeeded"), isNotNull(publishRecords.publishedAt)];
    if (args.topic) conditions.push(eq(publishRecords.topic, args.topic));
    if (args.platform) conditions.push(eq(publishRecords.platform, args.platform));

    const rows = await db
      .select()
      .from(publishRecords)
      .where(and(...conditions))
      .orderBy(desc(publishRecords.publishedAt))
      .limit(args.limit ?? 50);

    const entries = rows
      .map((row) => {
        const raw = (row.metrics ?? {}) as Record<string, unknown>;
        const metrics: Record<string, number> = {};
        for (const key of METRIC_KEYS) {
          const v = raw[key];
          if (typeof v === "number" && Number.isFinite(v)) metrics[key] = v;
        }
        const has = Object.keys(metrics).length > 0;
        return {
          recordId: row.id,
          topic: row.topic,
          title: row.title,
          platform: row.platform,
          platformLabel: PLATFORM_LABELS_FALLBACK[row.platform] ?? row.platform,
          publishedAt: row.publishedAt,
          url: row.url,
          metrics: has ? metrics : null,
          engagementTotal: has ? engagementTotal(metrics) : null,
          engagementScore: has ? engagementScore(metrics) : null,
          collectedVia: typeof raw.collectedVia === "string" ? raw.collectedVia : null,
          collectedAt: typeof raw.collectedAt === "string" ? raw.collectedAt : null,
          note: typeof raw.note === "string" ? raw.note : null,
          hasMetrics: has,
        };
      })
      .filter((entry) => (args.onlyWithMetrics ? entry.hasMetrics : true));

    return {
      entries,
      total: entries.length,
      withMetrics: entries.filter((e) => e.hasMetrics).length,
      missing: entries.filter((e) => !e.hasMetrics).length,
      metricKeys: METRIC_KEYS,
      metricLabels: METRIC_LABELS,
      source: "manual (用户手动录入, 非平台 API 回流)",
    };
  },
});
