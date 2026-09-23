import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { profiles } from "../server/db/schema.js";

export default defineAction({
  title: "删除账号画像",
  description: "删除一个账号画像及其六维内容。破坏性操作, 仅在用户明确要求时使用。",
  schema: z.object({
    id: z.string().min(1).describe("画像 id"),
  }),
  deferLoading: true,
  run: async ({ id }) => {
    const db = getDb();
    const deleted = await db
      .delete(profiles)
      .where(eq(profiles.id, id))
      .returning({ id: profiles.id });
    if (deleted.length === 0) fail(`画像不存在: ${id}`, { statusCode: 404 });
    return { ok: true, id };
  },
});
