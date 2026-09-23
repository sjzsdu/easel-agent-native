import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { calendarEvents } from "../server/db/schema.js";
import { newId, nowIso } from "../server/lib/ids.js";

export default defineAction({
  title: "保存日历条目",
  description:
    "新建或更新内容日历条目。内容条目 (kind=content, 状态 选题 idea/草稿 draft/待发 ready/已发 published) 或事件条目 (kind=event, 类型 节日 holiday/电商 ecommerce/平台 platform/行业 industry)。选题排期进日历、发布状态回写都用它。",
  schema: z.object({
    id: z.string().optional().describe("已有条目 id; 缺省新建"),
    title: z.string().min(1).describe("标题"),
    date: z.string().min(1).describe("日期 YYYY-MM-DD"),
    endDate: z.string().optional().describe("跨期事件结束日期; 单日留空"),
    time: z.string().optional().describe("时间 HH:MM, 如 09:30"),
    platform: z
      .string()
      .optional()
      .describe("目标平台 (xiaohongshu/douyin/zhihu/bilibili/weibo/wechat-oa/wechat-channels/kuaishou)"),
    kind: z.enum(["content", "event"]).optional().describe("缺省 content"),
    eventType: z
      .enum(["holiday", "ecommerce", "platform", "industry"])
      .optional()
      .describe("kind=event 时的事件类型"),
    status: z
      .enum(["idea", "draft", "ready", "published"])
      .optional()
      .describe("kind=content 时的状态; 缺省 draft"),
    note: z.string().optional().describe("备注"),
    url: z.string().optional().describe("相关链接"),
    source: z.string().optional().describe("来源"),
    ideaId: z.string().optional().describe("关联的选题库 id"),
  }),
  run: async (args) => {
    const db = getDb();
    const at = nowIso();
    const payload = {
      title: args.title,
      date: args.date,
      endDate: args.endDate || null,
      time: args.time || null,
      platform: args.platform || null,
      kind: args.kind ?? "content",
      eventType: args.kind === "event" ? (args.eventType ?? null) : null,
      status: args.status ?? "draft",
      note: args.note ?? "",
      url: args.url || null,
      source: args.source || null,
      ideaId: args.ideaId || null,
      updatedAt: at,
    };

    if (args.id) {
      const [row] = await db
        .update(calendarEvents)
        .set(payload)
        .where(eq(calendarEvents.id, args.id))
        .returning();
      if (!row) fail(`日历条目不存在: ${args.id}`, { statusCode: 404 });
      return { event: row };
    }

    const [row] = await db
      .insert(calendarEvents)
      .values({ id: newId("ev"), ...payload, createdAt: at })
      .returning();
    return { event: row };
  },
});
