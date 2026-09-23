import { eq } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { profiles } from "../server/db/schema.js";
import { nowIso, slugify } from "../server/lib/ids.js";

export default defineAction({
  title: "保存账号画像",
  description:
    "创建或更新账号画像的六维内容 (定位/风格/受众/平台/偏好红线/记忆)。画像构建向导、归因层把经验沉淀回 memory 都用它。不传 id 按 name 新建; 传 id 更新对应画像。",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("已有画像 id (即 name 的 slug); 缺省按 name 新建"),
    name: z.string().min(1).describe("画像名称 (如 科技数码达人)"),
    identity: z.string().optional().describe("定位: 差异化与内容方向"),
    style: z.string().optional().describe("风格: 语气/结构/视觉/节奏"),
    audience: z.string().optional().describe("受众: 核心人群/兴趣/痛点"),
    platforms: z
      .string()
      .optional()
      .describe("平台: 各平台账号信息与规则"),
    preferences: z
      .string()
      .optional()
      .describe("偏好与红线: 要做的/不做的/合规底线 (全层强制)"),
    memory: z
      .string()
      .optional()
      .describe("长期记忆: 洞察/踩坑/受众反馈规律 (归因层回写)"),
    makeActive: z
      .boolean()
      .optional()
      .describe("设为当前激活画像; 缺省新建时自动激活"),
  }),
  run: async (args) => {
    const db = getDb();
    const at = nowIso();
    const id = args.id || slugify(args.name);
    const patch = {
      name: args.name,
      identity: args.identity,
      style: args.style,
      audience: args.audience,
      platforms: args.platforms,
      preferences: args.preferences,
      memory: args.memory,
      updatedAt: at,
    };
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as typeof patch;

    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, id))
      .then((rows) => rows[0]);

    let row;
    if (existing) {
      [row] = await db
        .update(profiles)
        .set(fields)
        .where(eq(profiles.id, id))
        .returning();
    } else {
      [row] = await db
        .insert(profiles)
        .values({
          id,
          ...fields,
          name: args.name,
          createdAt: at,
          active: args.makeActive ?? true,
        })
        .returning();
    }

    if (args.makeActive === true || !existing) {
      await db.update(profiles).set({ active: false });
      await db
        .update(profiles)
        .set({ active: true, updatedAt: at })
        .where(eq(profiles.id, id))
        .returning();
      [row] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, id))
        .then((rows) => rows);
    }

    return { profile: row, created: !existing };
  },
});
