import { sql } from "drizzle-orm";
import { boolean, jsonb, text } from "drizzle-orm/pg-core";
import { table } from "@agent-native/core/db/schema";

/**
 * Easel workbench domain tables (Phase 1).
 *
 * Deliberately owner-less: Phase 1 is a single-user local workbench (PGlite in
 * development), mirroring the original Easel which had no multi-user model.
 * Queries therefore do not need `accessFilter`/`assertAccess` scoping (the
 * unscoped-query guard only applies to tables that spread `ownableColumns()`).
 * When multi-user support lands, add `...ownableColumns()` and row scoping in
 * one additive migration.
 */

const nowText = sql`(now() AT TIME ZONE 'utc')::text`;

/** Six-dimension account profile (定位/风格/受众/平台/偏好红线/记忆). */
export const profiles = table("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  identity: text("identity").notNull().default(""),
  style: text("style").notNull().default(""),
  audience: text("audience").notNull().default(""),
  platforms: text("platforms").notNull().default(""),
  preferences: text("preferences").notNull().default(""),
  memory: text("memory").notNull().default(""),
  active: boolean("active").notNull().default(false),
  createdAt: text("created_at").notNull().default(nowText),
  updatedAt: text("updated_at").notNull().default(nowText),
});

/** 选题库 ideas (kanban: pending/doing/done). */
export const ideas = table("ideas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default(""),
  status: text("status", { enum: ["pending", "doing", "done"] })
    .notNull()
    .default("pending"),
  scheduledDate: text("scheduled_date"),
  createdAt: text("created_at").notNull().default(nowText),
  updatedAt: text("updated_at").notNull().default(nowText),
});

/** 内容日历 entries: content items (选题/草稿/待发/已发) + events (节日/电商/平台/行业). */
export const calendarEvents = table("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  endDate: text("end_date"),
  time: text("time"),
  platform: text("platform"),
  kind: text("kind", { enum: ["content", "event"] })
    .notNull()
    .default("content"),
  eventType: text("event_type", {
    enum: ["holiday", "ecommerce", "platform", "industry"],
  }),
  status: text("status", { enum: ["idea", "draft", "ready", "published"] })
    .notNull()
    .default("draft"),
  note: text("note").notNull().default(""),
  url: text("url"),
  source: text("source"),
  ideaId: text("idea_id"),
  createdAt: text("created_at").notNull().default(nowText),
  updatedAt: text("updated_at").notNull().default(nowText),
});

/**
 * Searchable SQL index of `outputs/<topic>/` projects. The `.easel.json`
 * manifest inside each project directory stays the source of truth; this table
 * is refreshed by the `outputs` action so the agent can query it with SQL and
 * the UI gets one fast list.
 */
export const contentItems = table("content_items", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  title: text("title").notNull().default(""),
  summary: text("summary").notNull().default(""),
  profile: text("profile"),
  platform: text("platform"),
  kind: text("kind", {
    enum: [
      "article",
      "xhs-note",
      "video",
      "cards",
      "poster",
      "audio",
      "other",
    ],
  }).default("other"),
  status: text("status", { enum: ["draft", "ready", "published"] })
    .notNull()
    .default("draft"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  cover: text("cover"),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
  steps: jsonb("steps")
    .$type<
      {
        layer?: string;
        skill?: string;
        at?: string;
        status?: string;
        summary?: string;
        outputs?: string[];
      }[]
    >()
    .notNull()
    .default([]),
  createdAt: text("created_at").notNull().default(nowText),
  updatedAt: text("updated_at").notNull().default(nowText),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type IdeaRow = typeof ideas.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type ContentItemRow = typeof contentItems.$inferSelect;
