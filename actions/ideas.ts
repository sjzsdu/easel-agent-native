import { desc } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { ideas } from "../server/db/schema.js";

export default defineAction({
  title: "列出选题",
  description:
    "读取选题库全部选题 (看板: pending 待做 / doing 进行中 / done 已完成), 按更新时间倒序。策划层工作前先查这里避免重复造题。",
  schema: z.object({
    status: z
      .enum(["pending", "doing", "done"])
      .optional()
      .describe("只看某一列"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ status }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(ideas)
      .orderBy(desc(ideas.updatedAt));
    return {
      ideas: status ? rows.filter((row) => row.status === status) : rows,
      total: rows.length,
    };
  },
});
