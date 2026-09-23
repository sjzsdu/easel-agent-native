import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { calendarEvents } from "../server/db/schema.js";

export default defineAction({
  title: "删除日历条目",
  description: "从内容日历删除一条内容或事件。仅在用户明确要求删除时使用。",
  schema: z.object({
    id: z.string().min(1).describe("条目 id"),
  }),
  deferLoading: true,
  run: async ({ id }) => {
    const db = getDb();
    const deleted = await db
      .delete(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .returning({ id: calendarEvents.id });
    if (deleted.length === 0) fail(`日历条目不存在: ${id}`, { statusCode: 404 });
    return { ok: true, id };
  },
});
