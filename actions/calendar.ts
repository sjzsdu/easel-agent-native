import { and, asc, eq, gte, lte } from "drizzle-orm";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { calendarEvents } from "../server/db/schema.js";

export default defineAction({
  title: "读取内容日历",
  description:
    "读取内容日历条目 (内容: 选题/草稿/待发/已发; 事件: 节日/电商/平台活动/行业节点)。可按日期范围过滤。排期规划、检查某天/某周安排前先调用。",
  schema: z.object({
    startDate: z
      .string()
      .optional()
      .describe("起始日期 YYYY-MM-DD (含); 缺省不限"),
    endDate: z
      .string()
      .optional()
      .describe("结束日期 YYYY-MM-DD (含); 缺省不限"),
    kind: z
      .enum(["content", "event"])
      .optional()
      .describe("只看内容或只看事件"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ startDate, endDate, kind }) => {
    const db = getDb();
    const conditions = [];
    if (startDate) conditions.push(gte(calendarEvents.date, startDate));
    if (endDate) conditions.push(lte(calendarEvents.date, endDate));
    if (kind) conditions.push(eq(calendarEvents.kind, kind));

    const rows = await db
      .select()
      .from(calendarEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(calendarEvents.date), asc(calendarEvents.time));

    const today = new Date().toISOString().slice(0, 10);
    return {
      events: rows,
      total: rows.length,
      upcoming14: rows.filter(
        (row) => row.date >= today && row.date <= addDays(today, 14),
      ).length,
    };
  },
});

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
