import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { profiles } from "../server/db/schema.js";
import { nowIso } from "../server/lib/ids.js";

export default defineAction({
  title: "切换激活画像",
  description:
    "设置当前激活的账号画像 (同一时刻最多一个)。用户在工作台切换画像、Agent 需要按指定画像工作时调用。传空 id 表示清除激活 (通用模式)。",
  schema: z.object({
    id: z.string().describe("画像 id; 传空字符串清除激活状态"),
  }),
  run: async ({ id }) => {
    const db = getDb();
    const at = nowIso();

    if (id) {
      const target = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, id))
        .then((rows) => rows[0]);
      if (!target) fail(`画像不存在: ${id}`, { statusCode: 404 });
    }

    await db.update(profiles).set({ active: false, updatedAt: at });
    if (id) {
      await db
        .update(profiles)
        .set({ active: true, updatedAt: at })
        .where(eq(profiles.id, id));
    }
    return { ok: true, activeId: id || null };
  },
});
