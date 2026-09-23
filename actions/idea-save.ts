import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { ideas } from "../server/db/schema.js";
import { newId, nowIso } from "../server/lib/ids.js";

export default defineAction({
  title: "保存选题",
  description:
    "新建或更新选题库中的一条选题 (标题/备注/来源/状态/排期日期)。热点转选题、爆款拆解结果落库、状态列推进都用它。不传 id 则新建。",
  schema: z.object({
    id: z.string().optional().describe("已有选题 id; 缺省新建"),
    title: z.string().min(1).describe("选题标题"),
    note: z.string().optional().describe("选题备注/切入点"),
    source: z
      .string()
      .optional()
      .describe("来源 (如 热点标题、原文链接)"),
    status: z
      .enum(["pending", "doing", "done"])
      .optional()
      .describe("看板状态; 缺省 pending"),
    scheduledDate: z
      .string()
      .optional()
      .describe("排期日期 YYYY-MM-DD; 传空字符串清除"),
  }),
  run: async (args) => {
    const db = getDb();
    const at = nowIso();

    if (args.id) {
      const existing = await db
        .select({ id: ideas.id })
        .from(ideas)
        .where(eq(ideas.id, args.id))
        .then((rows) => rows[0]);
      if (!existing) fail(`选题不存在: ${args.id}`, { statusCode: 404 });

      const [row] = await db
        .update(ideas)
        .set({
          title: args.title,
          note: args.note ?? undefined,
          source: args.source ?? undefined,
          status: args.status ?? undefined,
          scheduledDate:
            args.scheduledDate === undefined
              ? undefined
              : args.scheduledDate === ""
                ? null
                : args.scheduledDate,
          updatedAt: at,
        })
        .where(eq(ideas.id, args.id))
        .returning();
      return { idea: row };
    }

    const id = newId("idea");
    const [row] = await db
      .insert(ideas)
      .values({
        id,
        title: args.title,
        note: args.note ?? "",
        source: args.source ?? "",
        status: args.status ?? "pending",
        scheduledDate: args.scheduledDate || null,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    return { idea: row };
  },
});
