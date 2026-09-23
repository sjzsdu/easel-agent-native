import { runMigrations } from "@agent-native/core/db";

/**
 * App-owned startup migrations (local development path; production uses
 * `pnpm migrate:production`).
 *
 * Rules: every entry carries a stable `name` (tracked independently of
 * `version`), SQL is additive-only (`IF NOT EXISTS`, never DROP/RENAME), and
 * new columns are nullable or defaulted so existing rows stay valid.
 */
export default runMigrations(
  [
    {
      version: 1,
      name: "easel-core-tables",
      sql: `
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        identity TEXT NOT NULL DEFAULT '',
        style TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT '',
        platforms TEXT NOT NULL DEFAULT '',
        preferences TEXT NOT NULL DEFAULT '',
        memory TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT false,
        created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
        updated_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
      );

      CREATE TABLE IF NOT EXISTS ideas (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        scheduled_date TEXT,
        created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
        updated_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
      );

      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        end_date TEXT,
        time TEXT,
        platform TEXT,
        kind TEXT NOT NULL DEFAULT 'content',
        event_type TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        note TEXT NOT NULL DEFAULT '',
        url TEXT,
        source TEXT,
        idea_id TEXT,
        created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
        updated_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
      );

      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        profile TEXT,
        platform TEXT,
        kind TEXT NOT NULL DEFAULT 'other',
        status TEXT NOT NULL DEFAULT 'draft',
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        cover TEXT,
        deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
        steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
        updated_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events (date);
      CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items (status);
      `,
    },
    {
      version: 2,
      name: "easel-publish-pipeline",
      sql: `
      CREATE TABLE IF NOT EXISTS publish_jobs (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        content_path TEXT NOT NULL,
        media_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
        platform TEXT NOT NULL,
        account TEXT,
        title TEXT NOT NULL DEFAULT '',
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        claimed_at TEXT,
        finished_at TEXT,
        quality_gate JSONB NOT NULL DEFAULT '{"verdict":"pass","score":100,"checkedAt":""}'::jsonb,
        created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
        updated_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
      );

      CREATE TABLE IF NOT EXISTS publish_records (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        topic TEXT NOT NULL,
        platform TEXT NOT NULL,
        account TEXT,
        title TEXT NOT NULL DEFAULT '',
        content_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        url TEXT,
        error TEXT,
        response_summary TEXT NOT NULL DEFAULT '',
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
        updated_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
      );

      CREATE INDEX IF NOT EXISTS idx_publish_jobs_status ON publish_jobs (status);
      CREATE INDEX IF NOT EXISTS idx_publish_jobs_scheduled ON publish_jobs (scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_publish_records_topic ON publish_records (topic);
      `,
    },
  ],
  { table: "easel_app_migrations" },
);
