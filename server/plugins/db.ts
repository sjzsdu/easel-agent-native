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
  ],
  { table: "easel_app_migrations" },
);
