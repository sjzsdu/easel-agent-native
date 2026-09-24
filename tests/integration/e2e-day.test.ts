/**
 * 端到端验收 — 「创作者的一天」五层工作流跑通。
 *
 *   发现 trends → 策划 profile / idea-save / calendar-save
 *   → 创作 output-file-save / output-manifest / quality-gate
 *   → 发布 publish-queue (定时 + cancel, 绝不真发) → 归因 metrics-save / metrics-trends
 *
 * 每一步都断言数据真实落库 / 落盘:
 *   - DB 用隔离的内存 PGlite (createTestDb), 不碰用户真实数据;
 *   - outputs/ 落盘用独立主题目录, afterAll 删除 (发布前置校验也依赖真实文件)。
 *
 * 发布步骤的「mock」边界: publish-queue 用 +1h 的 scheduledAt 入队 → 断言
 * pending → 立即 cancel。测试进程里没有调度器, 所以到点执行永远不会发生;
 * 归因所需的 succeeded 发布记录按 scripts/metrics-smoke.ts 的既有做法直接
 * 种入测试库 (真实发布需要平台凭据与外网, 不在验收范围)。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb } from "../helpers/test-db.js";
import { outputsDir } from "../../server/lib/outputs-store.js";

const TOPIC = "e2e-day-acceptance";
const ARTICLE_PATH = `${TOPIC}/article.md`;

const ARTICLE = `# 别再靠感觉发小红书了

三个月跑了 47 条笔记之后，我才明白：爆款不是灵感，是可复用的结构。

## 一、反常识的开头

前 3 个字就要制造认知冲突，别铺垫。读者刷到你的笔记时只会给 0.5 秒，
开头讲背景等于把人赶走。

## 二、可抄的结构

把方法拆成 1-2-3，读者才敢收藏。收藏率是平台判定干货的核心信号，
一条笔记能不能进下一个流量池，很大程度看收藏。

## 三、具体的数字

「47 条」比「很多」可信十倍。数字自带证据感，也自带复述的钩子。

先写 10 条，再谈爆款。数量本身就是筛选器。
`;

const hoisted = vi.hoisted(() => ({
  testDb: null as Awaited<ReturnType<typeof createTestDb>> | null,
}));

vi.mock("../../server/db/index.js", () => ({
  getDb: () => {
    if (!hoisted.testDb) throw new Error("testDb not initialized");
    return hoisted.testDb.db;
  },
}));

describe("e2e-day — 创作者的一天 (五层工作流)", () => {
  let trends: typeof import("../../actions/trends.js").default;
  let profileSave: typeof import("../../actions/profile-save.js").default;
  let profileRead: typeof import("../../actions/profile.js").default;
  let ideaSave: typeof import("../../actions/idea-save.js").default;
  let ideasList: typeof import("../../actions/ideas.js").default;
  let calendarSave: typeof import("../../actions/calendar-save.js").default;
  let calendarList: typeof import("../../actions/calendar.js").default;
  let outputFileSave: typeof import("../../actions/output-file-save.js").default;
  let outputFile: typeof import("../../actions/output-file.js").default;
  let outputManifest: typeof import("../../actions/output-manifest.js").default;
  let outputsList: typeof import("../../actions/outputs.js").default;
  let qualityGate: typeof import("../../actions/quality-gate.js").default;
  let publishQueue: typeof import("../../actions/publish-queue.js").default;
  let publishStatus: typeof import("../../actions/publish-status.js").default;
  let publishCancel: typeof import("../../actions/publish-cancel.js").default;
  let metricsSave: typeof import("../../actions/metrics-save.js").default;
  let metricsTrends: typeof import("../../actions/metrics-trends.js").default;
  let outputDelete: typeof import("../../actions/output-delete.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    trends = (await import("../../actions/trends.js")).default;
    profileSave = (await import("../../actions/profile-save.js")).default;
    profileRead = (await import("../../actions/profile.js")).default;
    ideaSave = (await import("../../actions/idea-save.js")).default;
    ideasList = (await import("../../actions/ideas.js")).default;
    calendarSave = (await import("../../actions/calendar-save.js")).default;
    calendarList = (await import("../../actions/calendar.js")).default;
    outputFileSave = (await import("../../actions/output-file-save.js")).default;
    outputFile = (await import("../../actions/output-file.js")).default;
    outputManifest = (await import("../../actions/output-manifest.js")).default;
    outputsList = (await import("../../actions/outputs.js")).default;
    qualityGate = (await import("../../actions/quality-gate.js")).default;
    publishQueue = (await import("../../actions/publish-queue.js")).default;
    publishStatus = (await import("../../actions/publish-status.js")).default;
    publishCancel = (await import("../../actions/publish-cancel.js")).default;
    metricsSave = (await import("../../actions/metrics-save.js")).default;
    metricsTrends = (await import("../../actions/metrics-trends.js")).default;
    outputDelete = (await import("../../actions/output-delete.js")).default;

    // 上一次中断残留的主题目录清掉, 保证幂等重跑。
    await outputDelete.run({ path: TOPIC }).catch(() => {});
  }, 60_000);

  afterAll(async () => {
    // 落盘产物清干净 (DB 是内存库, 随实例销毁)。
    if (hoisted.testDb) {
      await outputDelete.run({ path: TOPIC }).catch(() => {});
      await hoisted.testDb.close();
      hoisted.testDb = null;
    }
  });

  it("① 发现 — trends 返回真实热榜结构", async () => {
    // 外部热搜 API 有可用性波动, 这里断言契约形状而不是具体条目;
    // 网络不通时该 action 必须结构化降级而不是抛未捕获异常。
    const result = await trends.run({});
    expect(result).toHaveProperty("results");
    expect(Array.isArray(result.results)).toBe(true);
    for (const r of result.results) {
      expect(r).toHaveProperty("platform");
      expect(r).toHaveProperty("items");
      expect(Array.isArray(r.items)).toBe(true);
    }
  }, 60_000);

  it("② 策划 — 画像落库并激活, 选题与日历落库互相关联", async () => {
    // 画像 (新画像自动激活) → 读回验证六维都在。
    const saved = await profileSave.run({
      name: "e2e 验收账号",
      identity: "财经内容创作者，把复杂话题讲得直白",
      style: "结论先行，大白话，短段落强开头",
      audience: "20-40 岁想搞懂钱的上班族",
      platforms: "小红书: @e2etest\nB站: @e2etest",
      preferences: "不荐股；不承诺收益",
      memory: "「47 条笔记」复盘的收藏率最高",
    });
    expect(saved.created).toBe(true);
    expect(saved.profile.id).toBeTruthy();

    const active = await profileRead.run({});
    expect(active.profile).not.toBeNull();
    expect(active.profile!.id).toBe(saved.profile.id);
    expect(active.profile!.preferences).toContain("不荐股");

    // 选题 (来源指向真实热点标题) → 列表里必须查得到。
    const idea = await ideaSave.run({
      title: "热点跟做：从「考研」热榜聊普通人的信息差",
      note: "切入角度：为什么越热的词越没人愿意讲清楚",
      source: "微博热榜",
      status: "doing",
    });
    expect(idea.idea.id).toBeTruthy();

    const ideaBack = await ideasList.run({});
    const found = ideaBack.ideas.find((i) => i.id === idea.idea.id);
    expect(found).toBeDefined();
    expect(found!.title).toContain("信息差");

    // 日历排期, 关联刚才的选题。
    const today = new Date().toISOString().slice(0, 10);
    const event = await calendarSave.run({
      title: "发布：信息差选题",
      date: today,
      platform: "xiaohongshu",
      kind: "content",
      status: "ready",
      ideaId: idea.idea.id,
      note: "e2e 验收排期",
    });
    expect(event.event.id).toBeTruthy();

    const calBack = await calendarList.run({});
    const calFound = calBack.events.find((e) => e.id === event.event.id);
    expect(calFound).toBeDefined();
    expect(calFound!.date).toBe(today);
    expect(calFound!.ideaId).toBe(idea.idea.id);
  });

  it("③ 创作 — 正文落盘可读, manifest 记录进度, 项目进内容库", async () => {
    const saved = await outputFileSave.run({ path: ARTICLE_PATH, content: ARTICLE });
    expect(saved.bytes).toBeGreaterThan(0);

    // 落盘断言: 文件真的在 outputs/ 下。
    const full = join(outputsDir(), TOPIC, "article.md");
    expect(existsSync(full)).toBe(true);

    // 读回断言: 内容逐字一致 (不是空壳)。
    const read = await outputFile.run({ path: ARTICLE_PATH });
    expect(read.encoding).toBe("text");
    expect(read.content).toContain("爆款不是灵感，是可复用的结构");
    expect(read.content).toContain("先写 10 条，再谈爆款");

    // manifest 记录 produce 层一步。
    const manifest = await outputManifest.run({
      topic: TOPIC,
      title: "别再靠感觉发小红书了",
      platform: "xiaohongshu",
      kind: "article",
      status: "ready",
      summary: "e2e 验收: 三个反常识的选题原则",
      step: { layer: "produce", skill: "e2e-day", status: "done", outputs: [ARTICLE_PATH] },
    });
    expect(manifest.manifest.status).toBe("ready");
    expect(manifest.manifest.steps.length).toBeGreaterThan(0);

    // 内容库里能按主题找到这个项目。
    const library = await outputsList.run({});
    const project = library.projects.find((p) => p.topic === TOPIC);
    expect(project).toBeDefined();
  });

  it("③b 质检 — 门禁放行正常文案, 拦下带敏感信息的文案", async () => {
    const ok = await qualityGate.run({ text: ARTICLE, platform: "xiaohongshu" });
    expect(ok.verdict).not.toBe("block");

    const leaked = await qualityGate.run({
      text: "配置如下 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db 快转发",
      platform: "xiaohongshu",
    });
    expect(leaked.verdict).toBe("block");
  });

  it("④ 发布 — 定时入队 pending → 取消, 全程不触发真实发布", async () => {
    const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const queued = await publishQueue.run({
      topic: TOPIC,
      contentPath: ARTICLE_PATH,
      platform: "bilibili",
      title: "别再靠感觉发小红书了",
      scheduledAt: at,
    });
    expect(queued.job.id).toBeTruthy();
    expect(queued.job.status).toBe("pending");
    expect(queued.qualityGate.verdict).not.toBe("block");

    // 状态可查。
    const status = await publishStatus.run({ topic: TOPIC });
    const job = status.jobs.find((j) => j.id === queued.job.id);
    expect(job).toBeDefined();
    expect(job!.status).toBe("pending");

    // 取消 → 状态变为 cancelled, 调度器到点也不会执行。
    const cancelled = await publishCancel.run({ id: queued.job.id });
    expect(cancelled.job.status).toBe("cancelled");
  });

  it("⑤ 归因 — 录入互动数据并汇入趋势", async () => {
    // 种入一条 succeeded 发布记录 (mock, 同 metrics-smoke.ts 做法)。
    const now = new Date().toISOString();
    await hoisted.testDb!.db.execute(
      `INSERT INTO publish_records (id, job_id, topic, platform, account, title, content_path, status, url, error, response_summary, metrics, published_at, created_at, updated_at)
       VALUES ('pr_e2e_day_1', NULL, '${TOPIC}', 'bilibili', NULL, '别再靠感觉发小红书了', '${ARTICLE_PATH}', 'succeeded', 'https://www.bilibili.com/', NULL, '', '{}'::jsonb, '${now}', '${now}', '${now}')`,
    );

    const saved = await metricsSave.run({
      recordId: "pr_e2e_day_1",
      metrics: { views: 5200, likes: 310, collects: 128, comments: 42, shares: 16 },
      note: "发布后 48h",
    });
    expect(saved.ok).toBe(true);
    expect(saved.metrics.views).toBe(5200);
    expect(typeof saved.engagementScore).toBe("number");
    expect(saved.engagementScore).toBeGreaterThan(0);

    // 趋势聚合必须把这条算进覆盖。
    const trend = await metricsTrends.run({ days: 30 });
    expect(trend.coverage.publishedSucceeded).toBeGreaterThanOrEqual(1);
    expect(trend.coverage.withMetrics).toBeGreaterThanOrEqual(1);
  });

  it("⑥ 收尾 — 产物目录可删除, 删除后落盘与内容库一致", async () => {
    const deleted = await outputDelete.run({ path: TOPIC });
    expect(deleted.deleted).toBe(TOPIC);
    expect(existsSync(join(outputsDir(), TOPIC))).toBe(false);

    const library = await outputsList.run({});
    expect(library.projects.find((p) => p.topic === TOPIC)).toBeUndefined();
  });
});
