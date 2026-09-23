import { desc } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { profiles } from "../server/db/schema.js";

export default defineAction({
  title: "列出账号画像",
  description:
    "读取全部账号画像 (概览: id/名称/六维是否存在/是否激活)。需要了解当前有哪些账号、切换画像前先调用。",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(profiles)
      .orderBy(desc(profiles.updatedAt));
    return {
      profiles: rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        hasIdentity: Boolean(row.identity),
        hasStyle: Boolean(row.style),
        hasAudience: Boolean(row.audience),
        hasPlatforms: Boolean(row.platforms),
        hasPreferences: Boolean(row.preferences),
        hasMemory: Boolean(row.memory),
      })),
      total: rows.length,
    };
  },
});
