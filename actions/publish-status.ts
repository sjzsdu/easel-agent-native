import { and, desc, eq, inArray } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishJobs } from "../server/db/schema.js";
import {
  PLATFORM_LABELS,
  summarizePublishers,
} from "../server/lib/publish/index.js";

/** 查询发布队列状态 (排期中/执行中/成功/失败/取消 + 各平台能力)。 */
export default defineAction({
  title: "查询发布状态",
  description:
    "查询发布队列: 列出待发/执行中/成功/失败/取消的任务与错误信息, 附带各平台自动发布能力声明 (not_implemented 的平台会如实标注)。用户问「发到哪一步了」「队列里有什么」时调用。",
  schema: z.object({
    status: z
      .enum(["pending", "running", "succeeded", "failed", "cancelled"])
      .optional()
      .describe("只看某状态; 缺省返回全部"),
    platform: z.string().optional().describe("只看某平台"),
    topic: z.string().optional().describe("只看某内容项目"),
    limit: z.number().int().min(1).max(100).optional().describe("返回条数上限; 缺省 50"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const conditions = [];
    if (args.status) conditions.push(eq(publishJobs.status, args.status));
    if (args.platform) conditions.push(eq(publishJobs.platform, args.platform));
    if (args.topic) conditions.push(eq(publishJobs.topic, args.topic));

    const rows = await db
      .select()
      .from(publishJobs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(publishJobs.scheduledAt))
      .limit(args.limit ?? 50);

    const counts: Record<string, number> = {};
    for (const row of await db.select({ status: publishJobs.status }).from(publishJobs)) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }

    return {
      jobs: rows,
      total: rows.length,
      counts,
      platformLabels: PLATFORM_LABELS,
      platformCapabilities: await summarizePublishers(),
    };
  },
});
