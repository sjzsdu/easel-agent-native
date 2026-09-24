import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyPublishError,
  listPublishers,
  PublishNotSupportedError,
  resolvePublisher,
  type PublishContent,
  type Publisher,
} from "../../server/lib/publish/index.js";
import { PUBLISH_PLATFORMS, PLATFORM_LABELS } from "../../server/lib/publish/platforms.js";
import { retryDelayMs } from "../../server/lib/publish-worker.js";

describe("publish adapter registry", () => {
  it("declares all seven platforms", () => {
    expect(PUBLISH_PLATFORMS).toHaveLength(7);
    expect(resolvePublisher("xiaohongshu").platform).toBe("xiaohongshu");
    expect(resolvePublisher("wechat-channels").platform).toBe("wechat-channels");
  });

  it("publishers declare honest capabilities (3 connected, 4 not_implemented)", () => {
    const connected = ["bilibili", "weibo", "wechat-oa"] as const;
    for (const publisher of listPublishers()) {
      const caps = publisher.capabilities();
      expect(caps.authRequired).toBeDefined();
      expect(caps.howToConnect).toBeTruthy();
      if (connected.includes(publisher.platform as never)) {
        expect(caps.autoPublish).toBe(true);
      } else {
        expect(caps.autoPublish).toBe(false);
        expect(caps.note).toContain("暂不支持自动发布");
      }
    }
  });

  it("not_implemented publishers throw PublishNotSupportedError, never succeed", async () => {
    const publisher = resolvePublisher("xiaohongshu");
    const content: PublishContent = {
      topic: "t",
      title: "t",
      contentPath: "t/article.md",
      mediaPaths: [],
      tags: [],
    };
    await expect(publisher.publish(content, {})).rejects.toThrow(PublishNotSupportedError);
  });

  it("labels are human-readable Chinese names", () => {
    expect(PLATFORM_LABELS["wechat-oa"]).toBe("公众号");
    expect(PLATFORM_LABELS.bilibili).toBe("B站");
  });

  it("classifies errors by type", () => {
    expect(classifyPublishError(new PublishNotSupportedError("weibo", "x"))).toBe("not_supported");
    expect(classifyPublishError(new Error("boom"))).toBe("unknown");
  });
});

describe("retry backoff", () => {
  it("grows exponentially: 1min → 5min → 25min", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(3)).toBe(1_500_000);
  });
});

// ── worker 生命周期: 用注入的 mock publisher 走完整状态机 ──────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** 构造一个可切换成功/失败的 mock publisher, 替换注册表条目。 */
function makeMockPublisher(platform: string, mode: "ok" | "transient" | "permanent"): Publisher {
  return {
    platform: platform as Publisher["platform"],
    description: "mock",
    capabilities: () => ({
      autoPublish: true,
      browserAutomation: false,
      apiScheduling: false,
      media: false,
      note: "mock publisher for tests",
      authRequired: true,
      howToConnect: "mock",
    }),
    async publish() {
      if (mode === "ok") return { url: "https://example.com/p/1", raw: "ok" };
      if (mode === "transient") throw new (await import("../../server/lib/publish/index.js")).PublishTransientError(platform as never, "rate limited");
      throw new PublishNotSupportedError(platform as never, "not supported");
    },
  } as Mutable<Publisher> as Publisher;
}

// publish-worker 的 executePublishJob 直接接受 db 与 publisher — 但当前
// 实现从注册表取 publisher, 这里通过模块 mock 注入。
const registryState = vi.hoisted(() => ({ mock: undefined as Publisher | undefined }));

vi.mock("../../server/lib/publish/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/lib/publish/index.js")>();
  return {
    ...actual,
    resolvePublisher: (platform: string) =>
      registryState.mock ?? actual.resolvePublisher(platform as never),
  };
});

import { executePublishJob } from "../../server/lib/publish-worker.js";
import { createTestDb, type TestDb } from "../helpers/test-db.js";

describe("publish worker lifecycle", () => {
  let testDb: TestDb;
  let getDbSpy: ReturnType<typeof vi.spyOn> | undefined;
  let outputsTmp: string;
  const prevOutputsEnv = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — capture prior local path override for restore, not a credential

  beforeEach(async () => {
    testDb = await createTestDb();
    // worker 通过 getDb() 拿连接 — 指到测试实例。
    const dbModule = await import("../../server/db/index.js");
    getDbSpy = vi.spyOn(dbModule, "getDb").mockReturnValue(testDb.db as never);
    // 产物存在性校验走 outputsDir() — 指到临时目录并预置真实文件。
    // guard:allow-env-credential — EASEL_OUTPUTS_DIR is a local path override (documented in AGENTS.md), not a credential
    outputsTmp = mkdtempSync(join(tmpdir(), "easel-publish-test-"));
    mkdirSync(join(outputsTmp, "t"), { recursive: true });
    writeFileSync(join(outputsTmp, "t", "article.md"), "# 冒烟\n正文内容, 无敏感信息。\n");
    process.env.EASEL_OUTPUTS_DIR = outputsTmp; // guard:allow-env-credential — point outputsDir() at test fixture, not a credential
  });

  afterEach(async () => {
    getDbSpy?.mockRestore();
    registryState.mock = undefined;
    // guard:allow-env-credential — EASEL_OUTPUTS_DIR is a local path override (documented in AGENTS.md), not a credential
    // guard:allow-env-credential — restore in teardown: same local path override, not a credential read
    if (prevOutputsEnv === undefined) delete process.env.EASEL_OUTPUTS_DIR;
    else process.env.EASEL_OUTPUTS_DIR = prevOutputsEnv; // guard:allow-env-credential — restore local path override in test teardown, not a credential
    rmSync(outputsTmp, { recursive: true, force: true });
    await testDb.close();
  });

  async function seedJob(overrides?: Partial<{ attempts: number; maxAttempts: number }>) {
    const at = new Date().toISOString();
    const [job] = await testDb.db
      .insert(testDb.schema.publishJobs)
      .values({
        id: "pj_test1",
        topic: "t",
        contentPath: "t/article.md",
        mediaPaths: [],
        platform: "xiaohongshu",
        title: "冒烟",
        scheduledAt: at,
        status: "running",
        attempts: 0,
        maxAttempts: 3,
        qualityGate: { verdict: "pass", score: 100, checkedAt: at },
        createdAt: at,
        updatedAt: at,
        ...overrides,
      })
      .returning();
    return job!;
  }

  it("success: record + succeeded status + content_items published", async () => {
    registryState.mock = makeMockPublisher("xiaohongshu", "ok");
    const job = await seedJob();
    await testDb.db.insert(testDb.schema.contentItems).values({
      id: "t",
      topic: "t",
      title: "冒烟",
    });

    const outcome = await executePublishJob(job!);
    expect(outcome.ok).toBe(true);

    const records = await testDb.db.select().from(testDb.schema.publishRecords);
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe("succeeded");
    expect(records[0]!.url).toBe("https://example.com/p/1");
    expect(records[0]!.metrics).toEqual({}); // P3 归因预留

    const [updated] = await testDb.db
      .select()
      .from(testDb.schema.publishJobs);
    expect(updated!.status).toBe("succeeded");

    const [item] = await testDb.db.select().from(testDb.schema.contentItems);
    expect(item!.status).toBe("published");
  });

  it("permanent failure: failed record + failed job, no retry", async () => {
    registryState.mock = makeMockPublisher("xiaohongshu", "permanent");
    const job = await seedJob();

    const outcome = await executePublishJob(job!);
    expect(outcome.ok).toBe(false);

    const [updated] = await testDb.db.select().from(testDb.schema.publishJobs);
    expect(updated!.status).toBe("failed");
    const records = await testDb.db.select().from(testDb.schema.publishRecords);
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe("failed");
  });

  it("transient failure under maxAttempts: back to pending with future scheduledAt", async () => {
    registryState.mock = makeMockPublisher("xiaohongshu", "transient");
    const job = await seedJob({ maxAttempts: 3 });

    const outcome = await executePublishJob(job!);
    expect(outcome.ok).toBe(false);

    const [updated] = await testDb.db.select().from(testDb.schema.publishJobs);
    expect(updated!.status).toBe("pending");
    expect(updated!.attempts).toBe(1);
    expect(new Date(updated!.scheduledAt!).getTime()).toBeGreaterThan(Date.now());
    // 未到终态不留 failed 记录
    const records = await testDb.db.select().from(testDb.schema.publishRecords);
    expect(records).toHaveLength(0);
  });

  it("missing artifact file fails fast without calling the publisher", async () => {
    registryState.mock = makeMockPublisher("xiaohongshu", "ok");
    const job = await seedJob({ contentPath: "t/ghost.md" });

    const outcome = await executePublishJob(job!);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("产物文件不存在");
    const [updated] = await testDb.db.select().from(testDb.schema.publishJobs);
    expect(updated!.status).toBe("failed");
  });
});
