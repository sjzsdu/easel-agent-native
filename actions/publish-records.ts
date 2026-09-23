import { and, desc, eq } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishRecords } from "../server/db/schema.js";

/**
 * 查询发布历史留痕。metrics 字段为 Phase 3 归因预留:
 * 当前恒为 {}, P3 接入后在此回流平台数据 (浏览/点赞/涨粉等)。
 */
export default defineAction({
  title: "查询发布记录",
  description:
    "查询历史发布留痕 (成功/失败、发布 URL、平台原始响应摘要)。复盘内容效果、核对发布结果时调用。metrics 字段为 Phase 3 归因数据预留, 当前为空。",
  schema: z.object({
    topic: z.string().optional().describe("只看某内容项目"),
    platform: z.string().optional().describe("只看某平台"),
    status: z.enum(["succeeded", "failed"]).optional().describe("只看成功或失败"),
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
      attributionNote: "metrics 字段为 Phase 3 归因数据回流预留; 当前恒为空对象",
    };
  },
});
