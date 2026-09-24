/**
 * 发布 worker (Phase 2): 取队 → 执行 → 留痕 → 回写状态。
 *
 * 被 publish-scheduler 插件按 tick 调用; 也可由 publish-retry 立即触发。
 * 职责边界:
 * - 只认 `status='pending' AND scheduled_at<=now` 的任务, 用 status CAS
 *   抢占 (UPDATE ... WHERE status='pending' RETURNING 即原子认领)。
 * - 执行前再校验产物文件存在; 适配层不可用时如实落 failed 并写错误。
 * - 成功: publish_records 留痕 → content_items.status='published' →
 *   manifest .easel.json status 同步 → 关联 calendar_events 回写 url+published。
 * - 失败: 指数退避重排 scheduled_at; 超过 max_attempts 落 failed 并留痕。
 *
 * 回写走数据库 + manifest 双通道, UI 通过 useChangeVersions(["action"]) 与
 * 框架同步事件实时看到状态变化。
 */

import { existsSync } from "node:fs";

import { and, eq, lte } from "drizzle-orm";
import { recordChange } from "@agent-native/core/server/poll";

import { getDb } from "../db/index.js";
import {
  calendarEvents,
  contentItems,
  publishJobs,
  publishRecords,
} from "../db/schema.js";
import { newId, nowIso } from "./ids.js";
import {
  outputsDir,
  readManifest,
  writeManifest,
} from "./outputs-store.js";import {
  classifyPublishError,
  isPublishPlatform,
  PLATFORM_LABELS,
  PublishAssistedReadyError,
  resolvePublisher,
  type AssistedPublishPayload,
  type PublishContent,
} from "./publish/index.js";

/** 指数退避: 1min → 5min → 25min (attempt n 的延迟 = 60s * 5^(n-1)). */
export function retryDelayMs(attempt: number): number {
  return 60_000 * Math.pow(5, Math.max(0, attempt - 1));
}

export interface ProcessResult {
  claimed: number;
  succeeded: string[];
  failed: string[];
}

/**
 * 发布终态通知 (real-time-sync 模式): recordChange 携带结构化 payload,
 * /publish 页通过共享 SSE 通道 (subscribeSyncEvents) 收到后弹 toast
 * + 行内刷新。对话线程由 AgentKit 运行时独占持久化, 后台直写会竞态,
 * 故结构化播报走框架原生事件流而非直写线程。
 */
export function notifyPublishOutcome(change: {
  jobId: string;
  jobTitle: string;
  platform: string;
  status: "succeeded" | "failed" | "assisted";
  url?: string | null;
  error?: string | null;
  retryable?: boolean;
}): void {
  const label = platformLabel(change.platform);
  let summary: string;
  if (change.status === "succeeded") {
    summary = `「${change.jobTitle}」已发布到${label}`;
  } else if (change.status === "assisted") {
    summary = `「${change.jobTitle}」辅助发布包已生成 (${label}) — 到发布页复制并粘贴发布`;
  } else {
    const reason = change.error ? `：${change.error.slice(0, 120)}` : "";
    summary = `「${change.jobTitle}」发布失败 (${label})${reason}`;
  }
  try {
    recordChange({
      source: "publish",
      type: "job-finished",
      key: change.jobId,
      notify: {
        status: change.status,
        title: change.jobTitle,
        platform: change.platform,
        platformLabel: label,
        url: change.url ?? null,
        error: change.error ? change.error.slice(0, 200) : null,
        retryable: change.retryable ?? false,
        summary,
      },
    });
  } catch (error) {
    // 通知是尽力而为的增强: 事件通道故障绝不能反过来把发布结果打成失败。
    console.error(
      "[publish-worker] notify failed (publish outcome unaffected):",
      error instanceof Error ? error.message : error,
    );
  }
}

/** 处理所有到点的 pending 任务; 单次 tick 全跑完 (队列量级是个人量级). */
export async function processPendingPublishJobs(): Promise<ProcessResult> {
  const db = getDb();
  const now = nowIso();
  const result: ProcessResult = { claimed: 0, succeeded: [], failed: [] };

  const due = await db
    .select({ id: publishJobs.id })
    .from(publishJobs)
    .where(and(eq(publishJobs.status, "pending"), lte(publishJobs.scheduledAt, now)));

  for (const { id } of due) {
    // 原子认领: pending → running (只更新仍处于 pending 的行).
    const [claimed] = await db
      .update(publishJobs)
      .set({ status: "running", claimedAt: now, updatedAt: now })
      .where(and(eq(publishJobs.id, id), eq(publishJobs.status, "pending")))
      .returning();
    if (!claimed) continue; // 别的 tick / 进程已认领
    result.claimed += 1;

    const outcome = await executePublishJob(claimed);
    if (outcome.ok) result.succeeded.push(claimed.id);
    else result.failed.push(claimed.id);
  }

  return result;
}

export interface ExecuteOutcome {
  ok: boolean;
  error?: string;
  /** 辅助发布就绪时的复制包 payload (UI 一键复制用). */
  assisted?: AssistedPublishPayload;
}

/** 执行单个已认领任务, 全程状态回写。绝不吞错 — 失败一定留痕。 */
export async function executePublishJob(job: {
  id: string;
  topic: string;
  contentPath: string;
  mediaPaths: string[];
  platform: string;
  account: string | null;
  title: string;
  attempts: number;
  maxAttempts: number;
}): Promise<ExecuteOutcome> {
  const db = getDb();

  if (!isPublishPlatform(job.platform)) {
    return finishFailure(db, job, `未知平台: ${job.platform}`, false);
  }

  // 执行前再校验产物存在 (产物可能已被移动/删除)。
  const missing = [job.contentPath, ...job.mediaPaths].filter(
    (p) => !fileExists(p),
  );
  if (missing.length > 0) {
    return finishFailure(
      db,
      job,
      `产物文件不存在: ${missing.join(", ")} — 请先在内容库确认成品文件`,
      false,
    );
  }

  const publisher = resolvePublisher(job.platform);
  const content: PublishContent = {
    topic: job.topic,
    title: job.title,
    contentPath: job.contentPath,
    mediaPaths: job.mediaPaths,
    tags: readTopicTags(job.topic),
  };

  try {
    const res = await publisher.publish(content, {
      account: job.account ?? undefined,
    });
    return await finishSuccess(db, job, res.url, res.raw);
  } catch (error) {
    const kind = classifyPublishError(error);
    const message = error instanceof Error ? error.message : String(error);
    // 辅助发布就绪: 留 manual_assisted 记录 + 任务 succeeded (交付完成,
    // 剩余动作是用户粘贴), 并把复制包 payload 透传给 UI。
    if (kind === "assisted_ready" && isPublishPlatform(job.platform)) {
      const payload =
        error instanceof PublishAssistedReadyError
          ? error.payload
          : undefined;
      return finishAssisted(db, job, payload);
    }
    // 瞬时错误才退避重试; not_supported / credential / unknown 不重试
    // (unknown 保守处理为不重试, 避免对平台重复发送)。
    const retryable = kind === "transient" && job.attempts + 1 < job.maxAttempts;
    return finishFailure(db, job, message, retryable);
  }
}

/** 辅助发布完成路径: manual_assisted 留痕 + 任务 succeeded + UI 通知。 */
async function finishAssisted(
  db: ReturnType<typeof getDb>,
  job: { id: string; topic: string; platform: string; account: string | null; title: string; contentPath: string },
  payload?: AssistedPublishPayload,
): Promise<ExecuteOutcome> {
  const at = nowIso();
  const label = payload?.label ?? platformLabel(job.platform);
  const rawSummary = payload?.message ?? "辅助发布包已生成, 待用户在平台网页端人工发布";

  await db.insert(publishRecords).values({
    id: newId("pr"),
    jobId: job.id,
    topic: job.topic,
    platform: job.platform,
    account: job.account,
    title: job.title,
    contentPath: job.contentPath,
    status: "manual_assisted",
    url: null, // 未真正发布, 无 URL
    error: null,
    responseSummary: rawSummary,
    metrics: { assisted: payload ?? null },
    publishedAt: null,
    createdAt: at,
    updatedAt: at,
  });

  await db
    .update(publishJobs)
    .set({ status: "succeeded", finishedAt: at, lastError: null, updatedAt: at })
    .where(eq(publishJobs.id, job.id));

  notifyPublishOutcome({
    jobId: job.id,
    jobTitle: job.title,
    platform: job.platform,
    status: "assisted",
  });

  return { ok: true, assisted: payload };
}

/** 成功路径: 留痕 + 状态回写 (content_items / manifest / calendar_events). */
async function finishSuccess(
  db: ReturnType<typeof getDb>,
  job: { id: string; topic: string; platform: string; account: string | null; title: string; contentPath: string },
  url: string | undefined,
  raw: string,
): Promise<ExecuteOutcome> {
  const at = nowIso();
  const rawSummary = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;

  await db.insert(publishRecords).values({
    id: newId("pr"),
    jobId: job.id,
    topic: job.topic,
    platform: job.platform,
    account: job.account,
    title: job.title,
    contentPath: job.contentPath,
    status: "succeeded",
    url: url ?? null,
    error: null,
    responseSummary: rawSummary,
    metrics: {}, // Phase 3 归因数据回流时填充
    publishedAt: at,
    createdAt: at,
    updatedAt: at,
  });

  await db
    .update(publishJobs)
    .set({ status: "succeeded", finishedAt: at, lastError: null, updatedAt: at })
    .where(eq(publishJobs.id, job.id));

  notifyPublishOutcome({
    jobId: job.id,
    jobTitle: job.title,
    platform: job.platform,
    status: "succeeded",
    url: url ?? null,
  });

  // content_items 状态回写 (SQL 索引)。
  await db
    .update(contentItems)
    .set({ status: "published", updatedAt: at })
    .where(eq(contentItems.topic, job.topic));

  // manifest 同步 (.easel.json 是内容库展示源)。
  syncManifestPublished(job.topic);

  // 关联日历条目回写: 同 topic + 同平台, ready/idea 状态 → published + url。
  const conditions = [eq(calendarEvents.kind, "content"), eq(calendarEvents.title, job.title)];
  const events = await db
    .update(calendarEvents)
    .set({ status: "published", url: url ?? null, updatedAt: at })
    .where(and(...conditions))
    .returning({ id: calendarEvents.id });

  return { ok: true };
}

/** 失败路径: 重试退避或终态 failed, 都在 publish_records 留一行。 */
async function finishFailure(
  db: ReturnType<typeof getDb>,
  job: { id: string; topic: string; contentPath: string; platform: string; account: string | null; title: string; attempts: number; maxAttempts: number },
  message: string,
  retryable: boolean,
): Promise<ExecuteOutcome> {
  const at = nowIso();
  const attempts = job.attempts + 1;

  if (retryable) {
    const delay = retryDelayMs(attempts);
    const nextAt = new Date(Date.now() + delay).toISOString();
    await db
      .update(publishJobs)
      .set({
        status: "pending",
        attempts,
        scheduledAt: nextAt,
        lastError: message,
        claimedAt: null,
        updatedAt: at,
      })
      .where(eq(publishJobs.id, job.id));
    return { ok: false, error: message };
  }

  await db.insert(publishRecords).values({
    id: newId("pr"),
    jobId: job.id,
    topic: job.topic,
    platform: job.platform,
    account: job.account,
    title: job.title,
    contentPath: job.contentPath,
    status: "failed",
    url: null,
    error: message.slice(0, 1000),
    responseSummary: "",
    metrics: {},
    publishedAt: null,
    createdAt: at,
    updatedAt: at,
  });

  await db
    .update(publishJobs)
    .set({ status: "failed", attempts, finishedAt: at, lastError: message, updatedAt: at })
    .where(eq(publishJobs.id, job.id));

  notifyPublishOutcome({
    jobId: job.id,
    jobTitle: job.title,
    platform: job.platform,
    status: "failed",
    error: message,
    retryable,
  });

  return { ok: false, error: message };
}

/** manifest.status → published (失败不影响发布结果本身, 只同步展示层). */
function syncManifestPublished(topic: string): void {
  try {
    const manifest = readManifest(topic);
    if (!manifest || manifest.status === "published") return;
    writeManifest(topic, { ...manifest, status: "published" });
  } catch {
    // manifest 只读盘失败不回滚发布留痕
  }
}

function readTopicTags(topic: string): string[] {
  try {
    const manifest = readManifest(topic);
    return Array.isArray(manifest?.tags) ? manifest.tags : [];
  } catch {
    return [];
  }
}

/** outputs/ 相对路径存在性检查 (拒绝越界路径). */
function fileExists(relPath: string): boolean {
  const base = outputsDir();
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) return false;
  try {
    return existsSync(`${base}/${normalized}`);
  } catch {
    return false;
  }
}

/** 人类可读的平台名 (错误信息/日志用). */
export function platformLabel(platform: string): string {
  return isPublishPlatform(platform) ? PLATFORM_LABELS[platform] : platform;
}
