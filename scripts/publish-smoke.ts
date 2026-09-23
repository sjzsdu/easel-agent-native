/**
 * 发布链路一次性冒烟脚本 (对真实 dev DB, 不发外部内容)。
 *
 * 用注入的 mock publisher 验证完整状态机:
 *   1. 入队 (模拟 publish-queue 的写库路径)
 *   2. publish-cancel 取消 → publish-retry 重新入队
 *   3. worker 执行 → succeeded + publish_records 留痕 + content_items 回写
 *   4. 清理冒烟数据
 *
 * 运行: npx tsx scripts/publish-smoke.ts
 */

import { rmSync } from "node:fs";
import { eq } from "drizzle-orm";

import { getDb } from "../server/db/index.js";
import { contentItems, publishJobs, publishRecords } from "../server/db/schema.js";
import { newId, nowIso } from "../server/lib/ids.js";
import { processPendingPublishJobs } from "../server/lib/publish-worker.js";

// 冒烟专用: 把 xiaohongshu publisher 换成成功 mock (仅本进程内存)。
// worker 从本进程的注册表取 publisher — 同进程内直接改 REGISTRY 条目即可。
const publishModule = await import("../server/lib/publish/index.js");
const original = publishModule.resolvePublisher("xiaohongshu");
const mockPublisher = Object.freeze({
  ...original,
  description: "smoke mock",
  capabilities: () => ({
    autoPublish: true,
    browserAutomation: false,
    apiScheduling: false,
    media: false,
    note: "smoke test mock publisher",
  }),
  async publish() {
    return { url: "https://smoke.example/published/1", raw: "smoke-mock-ok" };
  },
});

// REGISTRY 是模块私有 — 通过 listPublishers 拿到同一对象引用后原地替换字段
// (Publisher 是普通对象, 属性可写; 冒烟结束后恢复原字段)。
const target = publishModule.listPublishers().find((p) => p.platform === "xiaohongshu");
if (!target) throw new Error("xiaohongshu publisher not found in registry");
const mutable = target as unknown as {
  description: string;
  capabilities: () => unknown;
  publish: (content: never, options: never) => Promise<unknown>;
};
const savedDescription = mutable.description;
const savedCaps = target.capabilities();
const savedPublish = target.publish.bind(target);
mutable.description = mockPublisher.description;
mutable.capabilities = mockPublisher.capabilities;
mutable.publish = mockPublisher.publish as typeof mutable.publish;

function restorePublisher() {
  mutable.description = savedDescription;
  mutable.capabilities = () => savedCaps;
  mutable.publish = savedPublish as typeof mutable.publish;
}

async function main() {
  const db = getDb();
  const at = nowIso();
  const topic = "_publish-smoke";
  const results: string[] = [];

  // 0. 预置 content_items 索引行 (worker 会回写 status) + 真实产物文件
  //    (worker 执行前会校验产物存在 — 这正是要冒烟的行为)。
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const { outputsDir } = await import("../server/lib/outputs-store.js");
  const projectDir = join(outputsDir(), topic);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "article.md"), "# 发布冒烟测试\n正文内容, 无敏感信息。\n");
  results.push(`0. 产物文件 ${resolve(projectDir, "article.md")} 就绪 ✓`);

  await db
    .insert(contentItems)
    .values({ id: topic, topic, title: "发布冒烟测试", status: "ready", updatedAt: at })
    .onConflictDoUpdate({ target: contentItems.id, set: { status: "ready", updatedAt: at } });

  // 1. 入队
  const jobId = newId("pj");
  await db.insert(publishJobs).values({
    id: jobId,
    topic,
    contentPath: "_publish-smoke/article.md",
    mediaPaths: [],
    platform: "xiaohongshu",
    title: "发布冒烟测试",
    scheduledAt: at,
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    qualityGate: { verdict: "pass", score: 100, checkedAt: at },
    createdAt: at,
    updatedAt: at,
  });
  results.push(`1. 入队 ${jobId} ✓`);

  // 2. cancel → retry
  const cancelled = await db
    .update(publishJobs)
    .set({ status: "cancelled", finishedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(publishJobs.id, jobId))
    .returning();
  if (cancelled[0]?.status !== "cancelled") throw new Error("cancel failed");
  results.push("2. publish-cancel → cancelled ✓");

  const retried = await db
    .update(publishJobs)
    .set({ status: "pending", finishedAt: null, updatedAt: nowIso() })
    .where(eq(publishJobs.id, jobId))
    .returning();
  if (retried[0]?.status !== "pending") throw new Error("retry failed");
  results.push("3. publish-retry → pending ✓");

  // 3. worker 执行 (mock 平台 → 成功路径)
  const processed = await processPendingPublishJobs();
  if (!processed.succeeded.includes(jobId))
    throw new Error(`worker did not succeed: ${JSON.stringify(processed)}`);
  results.push("4. worker 执行 → succeeded ✓");

  // 4. 回读确认 (写后回读契约)
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId));
  if (job?.status !== "succeeded") throw new Error("job not succeeded after readback");
  const records = await db.select().from(publishRecords).where(eq(publishRecords.jobId, jobId));
  if (records.length !== 1 || records[0]?.status !== "succeeded") throw new Error("record missing");
  if (!records[0]?.url) throw new Error("record url missing");
  results.push(`5. 回读: job=succeeded, record url=${records[0].url} ✓`);
  const [item] = await db.select().from(contentItems).where(eq(contentItems.topic, topic));
  if (item?.status !== "published") throw new Error("content_items not published");
  results.push("6. content_items.status → published ✓");

  // 5. 清理冒烟数据 (restore DB to pre-smoke state)
  await db.delete(publishRecords).where(eq(publishRecords.jobId, jobId));
  await db.delete(publishJobs).where(eq(publishJobs.id, jobId));
  await db.delete(contentItems).where(eq(contentItems.id, topic));
  rmSync(projectDir, { recursive: true, force: true });
  results.push("7. 冒烟数据已清理 ✓");

  restorePublisher();
  console.log(results.join("\n"));
  console.log("\nSMOKE OK");
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error("SMOKE FAILED:", error);
  restorePublisher();
  process.exit(1);
}
