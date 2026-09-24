/**
 * 归因链路冒烟辅助 (一次性): 种入/清理测试发布记录。
 * 用法: npx tsx scripts/metrics-smoke.ts seed|clean
 * 记录 id 固定为 pr_metrics_smoke_* 便于 action 冒烟引用与清理。
 */
import { eq, like } from "drizzle-orm";

import { getDb } from "../server/db/index.js";
import { publishRecords } from "../server/db/schema.js";

const SMOKE_PREFIX = "pr_metrics_smoke_";
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

async function seed() {
  const db = getDb();
  // 幂等: 清掉上次中断残留的冒烟记录再种入 (PGlite 文件库会持久化).
  await db.delete(publishRecords).where(like(publishRecords.id, `${SMOKE_PREFIX}%`));
  const rows = [
    {
      id: `${SMOKE_PREFIX}1`,
      topic: "metrics-smoke-a",
      platform: "xiaohongshu",
      title: "冒烟-已带数据",
      status: "succeeded" as const,
      publishedAt: daysAgo(2),
      // 周中的下午发布 (用于 weekday/hour 分组)
      metrics: { views: 5000, likes: 300, collects: 120, comments: 40, shares: 15 },
    },
    {
      id: `${SMOKE_PREFIX}2`,
      topic: "metrics-smoke-b",
      platform: "weibo",
      title: "冒烟-待录入",
      status: "succeeded" as const,
      publishedAt: daysAgo(6),
      metrics: {},
    },
    {
      id: `${SMOKE_PREFIX}3`,
      topic: "metrics-smoke-c",
      platform: "xiaohongshu",
      title: "冒烟-对照组",
      status: "succeeded" as const,
      publishedAt: daysAgo(12),
      metrics: { views: 1200, likes: 30, collects: 5, comments: 2, shares: 1 },
    },
  ];
  for (const row of rows) {
    await db
      .insert(publishRecords)
      .values({ ...row, jobId: null, account: null, contentPath: "t/x.md", createdAt: row.publishedAt, updatedAt: row.publishedAt });
  }
  console.log("seeded", rows.length, "records");
}

async function clean() {
  const db = getDb();
  const deleted = await db
    .delete(publishRecords)
    .where(like(publishRecords.id, `${SMOKE_PREFIX}%`))
    .returning({ id: publishRecords.id });
  // 再兜底按 topic 清 (防止冒烟过程中另建了记录)
  const byTopic = await db
    .delete(publishRecords)
    .where(eq(publishRecords.topic, "metrics-smoke-a"))
    .returning({ id: publishRecords.id });
  console.log("cleaned", deleted.length + byTopic.length);
}

const mode = process.argv[2];
if (mode === "seed") await seed();
else if (mode === "clean") await clean();
else {
  console.error("usage: tsx scripts/metrics-smoke.ts seed|clean");
  process.exit(1);
}
// PGlite 句柄会挂住事件循环, 显式退出 (否则命令永远不返回).
process.exit(0);
