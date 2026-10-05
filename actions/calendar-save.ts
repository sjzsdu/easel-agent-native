import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { calendarEvents } from "../server/db/schema.js";
import { newId, nowIso } from "../server/lib/ids.js";

/**
 * 校验并归一化 HH:MM 时间。规则:
 * - 只接受 HH:MM 或 H:MM (24 小时制), 其他格式 fail-fast
 * - 个位小时补零 ("9:30" → "09:30"), 全角冒号归一化
 * - 绝不转换为 UTC/ISO: 日历 time 字段与 date 同为用户本地时区的展示口径,
 *   存 "14:05" 就显示 "14:05" (此前曾出现 20:00 存进去变 12:00 的 8 小时偏移)
 */
function normalizeTime(raw: string): string | null {
  const text = raw.trim().replace("：", ":");
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export default defineAction({
  title: "保存日历条目",
  description:
    "新建或更新内容日历条目。内容条目 (kind=content, 状态 选题 idea/草稿 draft/待发 ready/已发 published) 或事件条目 (kind=event, 类型 节日 holiday/电商 ecommerce/平台 platform/行业 industry)。选题排期进日历、发布状态回写都用它。time 是用户本地时区的 HH:MM (24h), 直接按字面值存储与展示, 不要转成 UTC 或 ISO 时间戳。",
  schema: z.object({
    id: z.string().optional().describe("已有条目 id; 缺省新建"),
    title: z.string().min(1).describe("标题"),
    date: z.string().min(1).describe("日期 YYYY-MM-DD"),
    endDate: z.string().optional().describe("跨期事件结束日期; 单日留空"),
    time: z.string().optional().describe("时间 HH:MM (24h, 本地时区), 如 09:30; 按字面值存取, 不要转 UTC"),
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
    const time = args.time ? normalizeTime(args.time) : null;
    if (args.time && !time) {
      fail(`时间格式无效: 「${args.time}」— 需要 24 小时制 HH:MM (如 20:30), 不要传 ISO 时间戳或 UTC 值`, {
        statusCode: 400,
      });
    }
    const payload = {
      title: args.title,
      date: args.date,
      endDate: args.endDate || null,
      time,
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
