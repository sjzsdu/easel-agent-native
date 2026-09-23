import { eq } from "drizzle-orm";

import { contentItems } from "../db/schema.js";
import type { EaselManifest } from "./outputs-store.js";
import { nowIso } from "./ids.js";

type Db = ReturnType<typeof import("../db/index.js").getDb>;

const KNOWN_KINDS = [
  "article",
  "xhs-note",
  "video",
  "cards",
  "poster",
  "audio",
  "other",
] as const;
const KNOWN_STATUSES = ["draft", "ready", "published"] as const;

/**
 * 把 outputs/<topic>/.easel.json 的展示头 upsert 进 content_items 索引表,
 * 让 Agent 可以用 SQL 查询内容库, UI 也拿到与文件一致的数据.
 */
export async function upsertContentItem(
  db: Db,
  args: {
    topic: string;
    manifest: EaselManifest;
    fileCount?: number;
  },
): Promise<void> {
  const { topic, manifest } = args;
  const at = nowIso();
  const kind = (KNOWN_KINDS as readonly string[]).includes(manifest.kind ?? "")
    ? (manifest.kind as (typeof KNOWN_KINDS)[number])
    : "other";
  const status = (KNOWN_STATUSES as readonly string[]).includes(
    manifest.status ?? "",
  )
    ? (manifest.status as (typeof KNOWN_STATUSES)[number])
    : "draft";

  await db
    .insert(contentItems)
    .values({
      id: topic,
      topic,
      title: manifest.title || topic,
      summary: manifest.summary || "",
      profile: manifest.profile || null,
      platform: manifest.platform || null,
      kind,
      status,
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
      cover: manifest.cover || null,
      deliverables: Array.isArray(manifest.deliverables)
        ? manifest.deliverables
        : [],
      steps: Array.isArray(manifest.steps) ? manifest.steps : [],
      createdAt: manifest.created || at,
      updatedAt: manifest.updated || at,
    })
    .onConflictDoUpdate({
      target: contentItems.id,
      set: {
        title: manifest.title || topic,
        summary: manifest.summary || "",
        profile: manifest.profile || null,
        platform: manifest.platform || null,
        kind,
        status,
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
        cover: manifest.cover || null,
        deliverables: Array.isArray(manifest.deliverables)
          ? manifest.deliverables
          : [],
        steps: Array.isArray(manifest.steps) ? manifest.steps : [],
        updatedAt: manifest.updated || at,
      },
    });
}

/** 删除索引行 (项目目录被删时调用). */
export async function removeContentItem(
  db: Db,
  topic: string,
): Promise<void> {
  await db.delete(contentItems).where(eq(contentItems.id, topic));
}
