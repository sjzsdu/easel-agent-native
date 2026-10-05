import { and, desc, eq } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishRecords } from "../server/db/schema.js";

/**
 * 查询发布历史留痕。metrics 字段存用户手动录入的互动数据 (metrics-save):
 * 手动录入模式 (manualEntry=true) 会创建 status=manual_assisted 的留痕行,
 * 归因侧与真发 succeeded 区分统计。
 */
export default defineAction({
  title: "查询发布记录",
  description:
    "查询历史发布留痕 (成功/失败/辅助交付、发布 URL、平台原始响应摘要、手动录入的互动数据 metrics)。复盘内容效果、核对发布结果时调用。metrics 由用户手动录入 (metrics-save), 非平台 API 回流。",
  schema: z.object({
    topic: z.string().optional().describe("只看某内容项目"),
    platform: z.string().optional().describe("只看某平台"),
    status: z
      .enum(["succeeded", "failed", "manual_assisted"])
      .optional()
      .describe("按状态筛选: succeeded 已发布 / failed 失败 / manual_assisted 辅助发布包已交付待人工粘贴"),
    limit: z.number().int().min(1).max(200).optional().describe("返回条数上限; 缺省 50"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const conditions = [];
    if (args.topic) conditions.push(eq(publishRecords.topic, args.topic));
    if (args.platform) conditions.push(eq(publishRecords.platform, args.platform));
    if (args.status) conditions.push(eq(publishRecords.status, args.status));

    const rows = await db
      .select()
      .from(publishRecords)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(publishRecords.createdAt))
      .limit(args.limit ?? 50);

    return {
      records: rows,
      total: rows.length,
      attributionNote:
        "metrics 字段由用户手动录入 (metrics-save, 非平台 API 回流); 手动录入的留痕 status=manual_assisted, 与真发 succeeded 区分",
    };
  },
});
