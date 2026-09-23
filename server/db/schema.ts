import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, text } from "drizzle-orm/pg-core";
import { table } from "@agent-native/core/db/schema";

/**
 * Easel workbench domain tables (Phase 1 + Phase 2 publish pipeline).
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
 * 发布队列 (Phase 2). One row per (内容, 平台) 发布尝试链。payload 只引用
 * outputs/ 路径, 不内联正文/媒体 (大文件/媒体绝不进 SQL)。
 *
 * status: pending → running → succeeded | failed; pending → cancelled;
 * failed 可经 publish-retry 回到 pending (手动重试重置 attempts)。
 */
export const publishJobs = table("publish_jobs", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  contentPath: text("content_path").notNull(),
  mediaPaths: jsonb("media_paths").$type<string[]>().notNull().default([]),
  platform: text("platform").notNull(),
  account: text("account"),
  title: text("title").notNull().default(""),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status", {
    enum: ["pending", "running", "succeeded", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  claimedAt: text("claimed_at"),
  finishedAt: text("finished_at"),
  qualityGate: jsonb("quality_gate")
    .$type<{ verdict: string; score: number; checkedAt: string }>()
    .notNull()
    .default({ verdict: "pass", score: 100, checkedAt: "" }),
  createdAt: text("created_at").notNull().default(nowText),
  updatedAt: text("updated_at").notNull().default(nowText),
});

/**
 * 发布结果留痕 (Phase 2)。成功与最终失败各留一行; `metrics` 预留给
 * Phase 3 归因数据回流 (只存数字/JSON, 永不存原始大文件)。
 */
export const publishRecords = table("publish_records", {
  id: text("id").primaryKey(),
  jobId: text("job_id"),
  topic: text("topic").notNull(),
  platform: text("platform").notNull(),
  account: text("account"),
  title: text("title").notNull().default(""),
  contentPath: text("content_path").notNull().default(""),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  url: text("url"),
  error: text("error"),
  responseSummary: text("response_summary").notNull().default(""),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  publishedAt: text("published_at"),
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
export type PublishJobRow = typeof publishJobs.$inferSelect;
export type PublishRecordRow = typeof publishRecords.$inferSelect;
