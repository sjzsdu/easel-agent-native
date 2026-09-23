import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { profiles } from "../server/db/schema.js";

export default defineAction({
  title: "读取账号画像",
  description:
    "读取一个账号画像的六维完整内容: 定位 identity、风格 style、受众 audience、平台 platforms、偏好与红线 preferences、长期记忆 memory。不传 id 则返回当前激活的画像。任何策划/创作任务开始前必须先读取它, 让输出贴合真实账号。",
  schema: z.object({
    id: z.string().optional().describe("画像 id; 缺省返回激活中的画像"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const db = getDb();
    let row;
    if (id) {
      row = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, id))
        .then((rows) => rows[0]);
      if (!row) fail(`画像不存在: ${id}`, { statusCode: 404 });
    } else {
      const all = await db.select().from(profiles);
      row =
        all.find((candidate) => candidate.active) ?? all[0];
      if (!row) {
        return { profile: null, hint: "尚无画像 — 用 profile-save 创建, 或使用 profile-builder 技能引导用户完成" };
      }
    }
    return { profile: row };
  },
});
