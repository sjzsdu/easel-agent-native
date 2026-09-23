/**
 * 媒体产物登记 — media-* actions 成功/失败后把 step 写进
 * outputs/<topic>/.easel.json 并同步 content_items SQL 索引。
 *
 * 与 output-manifest action 同一登记契约: 大文件只记路径, 不进 SQL。
 */

import { getDb } from "../../db/index.js";
import { upsertContentItem } from "../content-index.js";
import { readManifest, writeManifest } from "../outputs-store.js";

export interface MediaStepInput {
  topic: string;
  skill: string;
  status: "done" | "failed";
  summary: string;
  outputs?: string[];
}

export async function recordMediaStep(input: MediaStepInput): Promise<void> {
  const existing = readManifest(input.topic) ?? {
    topic: input.topic,
    created: new Date().toISOString(),
  };
  const steps = Array.isArray(existing.steps) ? [...existing.steps] : [];
  steps.push({
    layer: "produce",
    skill: input.skill,
    status: input.status,
    at: new Date().toISOString(),
    summary: input.summary,
    outputs: input.outputs,
  });
  const manifest = writeManifest(input.topic, { ...existing, steps });
  await upsertContentItem(getDb(), { topic: input.topic, manifest });
}
