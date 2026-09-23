import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { ideas } from "../server/db/schema.js";

export default defineAction({
  title: "删除选题",
  description: "从选题库删除一条选题。仅在用户明确要求删除时使用。",
  schema: z.object({
    id: z.string().min(1).describe("选题 id"),
  }),
  deferLoading: true,
  run: async ({ id }) => {
    const db = getDb();
    const deleted = await db
      .delete(ideas)
      .where(eq(ideas.id, id))
      .returning({ id: ideas.id });
    if (deleted.length === 0) fail(`选题不存在: ${id}`, { statusCode: 404 });
    return { ok: true, id };
  },
});
