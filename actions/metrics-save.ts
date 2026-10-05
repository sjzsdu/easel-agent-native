import { and, desc, eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishRecords } from "../server/db/schema.js";
import {
  METRIC_KEYS,
  engagementScore,
  normalizeMetrics,
} from "../server/lib/metrics.js";
import { nowIso } from "../server/lib/ids.js";

/**
 * 归因数据录入 (Phase 3 后半)。两条入口:
 *
 * 1. 关联录入 (默认): 定位到一条 publish_records 发布留痕, metrics 写进该行。
 *    目标定位优先级: publish_record_id > topic+platform > recordId。
 * 2. 手动录入 (manualEntry=true): 无发布环境/发布留痕时也可先录数据 —
 *    自动种一条 status="manual_assisted" 的留痕行, 与发布记录强绑定的下游
 *    (metrics 趋势聚合、归因洞察) 无需任何改动即可分析这些数据。
 *    归因看板继续按状态区分真发与手动数据, 不混渟。
 *
 * 数据来源诚实性: P3 未接平台数据 API, 互动数据一律由用户手动录入/粘贴,
 * 绝不自动生成或推算。metrics 只存数字 (jsonb), 截图等大文件走 outputs/ 存路径。
 * 成功后回读确认再返回 (如实汇报契约)。
 */
export default defineAction({
  title: "录入互动数据",
  description:
    "把互动数据 (播放/点赞/收藏/评论/转发/粉丝变化) 写入发布留痕的 metrics 字段。数据必须是用户从平台后台手动复制来的真实数字 — 未经用户提供的数字绝不允许录入或编造。有关联发布记录时按发布记录定位 (优先 publish_record_id, 或 topic+platform, 或最近一条成功记录); 没有发布留痕 (内容没走发布链路/手动发的旧内容) 传 manualEntry=true 直接录入, 会创建一条 manual_assisted 留痕行并如实标注来源。复盘、归因分析前先录入。",
  schema: z.object({
    metrics: z
      .record(z.string(), z.unknown())
      .describe(
        "互动数据, 允许的键: views(播放/浏览)/likes(点赞)/collects(收藏)/comments(评论)/shares(转发)/followersGained(粉丝变化), 值为非负数字",
      ),
    manualEntry: z
      .boolean()
      .optional()
      .describe(
        "true = 手动录入模式: 不定位发布记录, 直接建一条 manual_assisted 留痕 (适合没走发布链路的内容); 缺省 false = 必须定位到已有发布记录",
      ),
    publishRecordId: z
      .string()
      .optional()
      .describe("目标发布记录 id (publish-records 返回的 id); 最精确"),
    recordId: z.string().optional().describe("同 publishRecordId 的别名"),
    topic: z
      .string()
      .optional()
      .describe("无 record id 时按内容项目名定位 (配合 platform); manualEntry 时作为手动留痕的主题名"),
    platform: z
      .string()
      .optional()
      .describe(
        "定位平台 (与 topic 配合); manualEntry 时是手动留痕的平台, 建议传平台 slug (xiaohongshu/douyin/bilibili/weibo/zhihu/wechat-oa/wechat-channels/kuaishou)",
      ),
    title: z
      .string()
      .optional()
      .describe("manualEntry 时手动留痕的标题 (缺省用 topic)"),
    note: z
      .string()
      .max(500)
      .optional()
      .describe("数据备注 (如截取时间「发布后 48h」), 会并入 metrics.source"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();

    // 1. 指标归一化/校验 (白名单、非负、上限)。
    const normalized = normalizeMetrics(args.metrics);
    if (!normalized.ok) fail(normalized.error, { statusCode: 400 });
    if (Object.keys(normalized.metrics).length === 0) {
      fail("metrics 为空 — 至少录入一项指标", { statusCode: 400 });
    }

    const at = nowIso();

    // 2. 定位目标: 手动模式直接建留痕行, 关联模式按显式 id > topic+platform > 最近一条。
    let target;
    if (args.manualEntry) {
      const topic = (args.topic || args.title || "").trim();
      if (!topic) {
        fail("手动录入需要 topic (或 title) 说明这条数据属于哪条内容", { statusCode: 400 });
      }
      const inserted = await db
        .insert(publishRecords)
        .values({
          id: `pr_manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          jobId: null,
          topic,
          platform: args.platform || "xiaohongshu",
          account: null,
          title: args.title || topic,
          contentPath: "",
          // manual_assisted 是发布链路里「辅助发布已交付」的既有状态; 归因侧
          // 用它承载手动录入的数据来源, 与真发 succeeded 区分开。
          status: "manual_assisted",
          url: null,
          error: null,
          responseSummary: "手动录入互动数据 (无发布链路留痕)",
          metrics: {},
          publishedAt: null,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      target = inserted[0];
    } else if (args.publishRecordId || args.recordId) {
      const id = args.publishRecordId ?? args.recordId!;
      [target] = await db
        .select()
        .from(publishRecords)
        .where(eq(publishRecords.id, id))
        .limit(1);
      if (!target) fail(`发布记录不存在: ${id}`, { statusCode: 404 });
    } else if (args.topic) {
      const conditions = [eq(publishRecords.topic, args.topic)];
      if (args.platform) conditions.push(eq(publishRecords.platform, args.platform));
      [target] = await db
        .select()
        .from(publishRecords)
        .where(and(...conditions))
        .orderBy(desc(publishRecords.createdAt))
        .limit(1);
      if (!target) {
        fail(
          `找不到发布记录 (topic=${args.topic}${args.platform ? `, platform=${args.platform}` : ""}) — 先用 publish-records 查看留痕; 若这条内容没走发布链路 (手动发的/旧内容), 改用 manualEntry=true 直接录入`,
          { statusCode: 404 },
        );
      }
    } else {
      fail(
        "请指定 publishRecordId, 或 topic (可配 platform) 来定位发布记录; 没有发布留痕时传 manualEntry=true 直接录入",
        { statusCode: 400 },
      );
    }

    if (target!.status !== "succeeded" && target!.status !== "manual_assisted") {
      fail(
        `该记录发布状态为 ${target!.status}, 只有已发布 (succeeded) 或辅助发布已交付 (manual_assisted, 用户已粘贴发布) 的内容才能录入互动数据`,
        { statusCode: 400 },
      );
    }

    // 手动留痕行补上 publishedAt (归因侧按 publishedAt 过滤与分桶; 手动数据
    // 的「发布时间」就是录入时间, 如实标注)。
    if (args.manualEntry && !target!.publishedAt) {
      await db
        .update(publishRecords)
        .set({ publishedAt: at })
        .where(eq(publishRecords.id, target!.id));
      target!.publishedAt = at;
    }

    // 3. 写入 (merge 保留已有字段, 手动录入可分批补)。
    const nextMetrics: Record<string, unknown> = {
      ...(target!.metrics ?? {}),
      ...normalized.metrics,
      // 录入方式与备注进元信息, 区别于未来可能的 API 自动回流。
      collectedVia: "manual",
      collectedAt: at,
      ...(args.note ? { note: args.note } : {}),
    };

    await db
      .update(publishRecords)
      .set({ metrics: nextMetrics, updatedAt: at })
      .where(eq(publishRecords.id, target!.id));

    // 4. 回读确认 (写操作完成后回读再报告)。
    const [confirmed] = await db
      .select()
      .from(publishRecords)
      .where(eq(publishRecords.id, target!.id))
      .limit(1);

    const m = confirmed!.metrics as Record<string, unknown>;
    return {
      ok: true,
      recordId: confirmed!.id,
      topic: confirmed!.topic,
      platform: confirmed!.platform,
      metrics: m,
      engagementScore: engagementScore(m as never),
      allowedKeys: METRIC_KEYS,
      source: "manual (用户手动录入, 非平台 API 回流)",
      entry: args.manualEntry ? ("manual" as const) : ("linked" as const),
      entryNote: args.manualEntry
        ? "已创建 manual_assisted 手动留痕行 (无发布链路), 归因趋势/洞察会统计这条数据并标注来源"
        : undefined,
    };
  },
});
