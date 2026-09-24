/**
 * 第二梯队平台发布冒烟 (对真实 dev DB, 不发任何外部内容)。
 *
 * 覆盖:
 *   A. assisted 全链路 (真实小红书 publisher, 无 mock):
 *      入队 → worker → PublishAssistedReadyError → manual_assisted 留痕
 *      (复制包进 metrics.assisted) + 任务 succeeded + outcome.assisted 返回
 *   B. requiresMedia 失败路径 (视频号无视频): worker → 终态 failed, 错误入留痕
 *   C. douyin 凭据缺失: publish() 诚实抛 PublishCredentialError
 *   D. 清理全部冒烟数据
 *
 * 运行: node_modules/.bin/tsx scripts/tier2-publish-smoke.ts
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";

// 隔离数据库: dev server 常驻进程持有 ./data/pglite 的 PGlite 进程锁,
// 冒烟用内存实例 (与真实 schema 同迁移), 互不干扰。
process.env.DATABASE_URL = "pglite:memory"; // guard:allow-env-credential — in-memory test DB selector, not a credential

const runMigrations = (await import("../server/plugins/db.js")).default;
await runMigrations({});

const { getDb } = await import("../server/db/index.js");
const { publishJobs, publishRecords } = await import("../server/db/schema.js");
const { newId, nowIso } = await import("../server/lib/ids.js");
const { outputsDir } = await import("../server/lib/outputs-store.js");
const { processPendingPublishJobs } = await import("../server/lib/publish-worker.js");

const TOPIC = "_tier2-smoke";

async function main() {
  const db = getDb();
  const results: string[] = [];

  // 0. 预置产物 (worker 执行前校验存在性 — 这正是要冒烟的行为)
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const projectDir = join(outputsDir(), TOPIC);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "article.md"),
    "这是一篇用于第二梯队发布冒烟的正文, 内容足够长以满足质量门禁与辅助发布包组装的要求, 不含任何敏感信息。\n",
  );
  // 自带 manifest (标签来源), 保证脚本可重复运行。
  writeFileSync(
    join(projectDir, ".easel.json"),
    JSON.stringify({ topic: TOPIC, title: "第二梯队冒烟", status: "ready", tags: ["冒烟", "测试"] }),
  );
  results.push(`0. 产物就绪 ${join(projectDir, "article.md")}`);

  async function enqueue(platform: string, mediaPaths: string[] = []): Promise<string> {
    const at = nowIso();
    const jobId = newId("pj");
    await db.insert(publishJobs).values({
      id: jobId,
      topic: TOPIC,
      contentPath: `${TOPIC}/article.md`,
      mediaPaths,
      platform,
      title: "第二梯队冒烟",
      scheduledAt: at,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      qualityGate: { verdict: "pass", score: 100, checkedAt: at },
      createdAt: at,
      updatedAt: at,
    });
    return jobId;
  }

  // ── A. assisted 全链路 (小红书, 真实 publisher) ─────────────────────
  const xhsJob = await enqueue("xiaohongshu");
  const processed = await processPendingPublishJobs();
  if (!processed.succeeded.includes(xhsJob))
    throw new Error(`A: assisted 任务应 succeeded, 实际 ${JSON.stringify(processed)}`);

  const [xhsRecord] = await db
    .select()
    .from(publishRecords)
    .where(eq(publishRecords.jobId, xhsJob));
  if (!xhsRecord || xhsRecord.status !== "manual_assisted")
    throw new Error(`A: 留痕应为 manual_assisted, 实际 ${xhsRecord?.status}`);
  const pack = (xhsRecord.metrics as Record<string, unknown>).assisted as
    | { copyText?: string; webEntry?: string; title?: string }
    | undefined;
  if (!pack?.copyText?.includes("#冒烟")) throw new Error("A: 复制包缺少标签");
  if (!pack.webEntry?.includes("creator.xiaohongshu.com")) throw new Error("A: 缺网页入口");
  if (xhsRecord.url !== null) throw new Error("A: manual_assisted 不应有 url (未真正发布)");
  results.push(`A. xiaohongshu assisted 全链路 ✓ (复制包 ${pack.copyText.length} 字, url=null)`);

  // ── B. requiresMedia 失败路径 (视频号无视频 → 终态 failed) ──────────
  const chJob = await enqueue("wechat-channels");
  const processed2 = await processPendingPublishJobs();
  if (!processed2.failed.includes(chJob))
    throw new Error(`B: 视频号无视频应 failed, 实际 ${JSON.stringify(processed2)}`);
  const [chRecord] = await db
    .select()
    .from(publishRecords)
    .where(eq(publishRecords.jobId, chJob));
  if (!chRecord || chRecord.status !== "failed" || !chRecord.error?.includes("仅支持视频"))
    throw new Error(`B: 失败留痕缺失或错误文案不符: ${chRecord?.error}`);
  results.push("B. wechat-channels requiresMedia 失败路径 ✓ (错误如实入留痕)");

  // ── C. douyin 凭据缺失: 诚实抛 PublishCredentialError ───────────────
  const { douyinPublisher } = await import("../server/lib/publish/douyin.js");
  let credentialError = false;
  try {
    await douyinPublisher.publish(
      {
        topic: TOPIC,
        title: "t",
        contentPath: `${TOPIC}/article.md`,
        mediaPaths: [`${TOPIC}/video.mp4`],
        tags: [],
      },
      {},
    );
  } catch (error) {
    const { PublishCredentialError } = await import("../server/lib/publish/index.js");
    credentialError = error instanceof PublishCredentialError;
    if (!credentialError) throw error;
  }
  if (!credentialError) throw new Error("C: douyin 无凭据时应抛 PublishCredentialError");
  results.push("C. douyin 凭据缺失 → PublishCredentialError (不假装成功) ✓");

  // ── D. 清理冒烟数据 (恢复 DB 与文件系统) ────────────────────────────
  for (const jobId of [xhsJob, chJob]) {
    await db.delete(publishRecords).where(eq(publishRecords.jobId, jobId));
    await db.delete(publishJobs).where(eq(publishJobs.id, jobId));
  }
  rmSync(projectDir, { recursive: true, force: true });
  results.push("D. 冒烟数据已清理 ✓");

  console.log(results.join("\n"));
  console.log("\nSMOKE OK");
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error("SMOKE FAILED:", error);
  process.exit(1);
}
