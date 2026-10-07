import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// 凭据解析依赖框架凭据存储 (需要 DB/auth schema); 本文件只验证我们自己的
// 逻辑 — 凭据缺失时诚实报错 — 所以 mock 成「永远查不到凭据」。
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: vi.fn(async () => undefined),
}));

import {
  PublishAssistedReadyError,
  PublishNotSupportedError,
} from "../../server/lib/publish/index.js";
import { makeAssistedPublisher } from "../../server/lib/publish/assisted.js";
import { douyinPublisher } from "../../server/lib/publish/douyin.js";

/**
 * 发布第二梯队 (第二梯队平台 + 辅助发布) 单元测试。
 *
 * 不发任何真实外部请求: assisted 包组装是纯本地逻辑;
 * douyin 凭据缺失路径在 secrets 未注册时 throw PublishCredentialError。
 * 需要 outputs 文件的用例经 EASEL_OUTPUTS_DIR 指向临时目录 (见 test-db guard)。
 */

const TEST_TOPIC = "publish-tier2-test";

// 与 publish-pipeline.test.ts 相同的模式: 每文件一个临时 outputs 目录。
const outputsTmp = mkdtempSync(join(tmpdir(), "easel-publish-tier2-"));

beforeEach(() => {
  // guard:allow-env-credential — EASEL_OUTPUTS_DIR is a local path override (documented in AGENTS.md), not a credential
  process.env.EASEL_OUTPUTS_DIR = outputsTmp;
  mkdirSync(join(outputsTmp, TEST_TOPIC), { recursive: true });
  writeFileSync(
    join(outputsTmp, TEST_TOPIC, "article.md"),
    "这是一篇用于辅助发布测试的正文, 内容超过二十字以满足小红书的最低要求。",
    "utf8",
  );
});

afterAll(() => {
  // guard:allow-env-credential — restore local path override in test teardown, not a credential
  delete process.env.EASEL_OUTPUTS_DIR;
  rmSync(outputsTmp, { recursive: true, force: true });
});

describe("assisted publisher (辅助发布工厂)", () => {
  const xhs = makeAssistedPublisher("xiaohongshu", {
    label: "小红书",
    webEntry: "https://creator.xiaohongshu.com/publish/publish",
    mediaTypes: ["image", "text"],
    tagStyle: "hash",
    titleLimit: 20,
    bodyLimit: 1000,
    requiresMedia: false,
    howToConnect: "test-connect",
    note: "test-note",
  });

  it("capabilities 如实声明 assisted 模式与媒体类型", () => {
    const caps = xhs.capabilities();
    expect(caps.autoPublish).toBe(false);
    expect(caps.mode).toBe("assisted");
    expect(caps.mediaTypes).toEqual(["image", "text"]);
    expect(caps.webEntry).toBe("https://creator.xiaohongshu.com/publish/publish");
    expect(caps.authRequired).toBe(false);
  });

  it("publish 组装复制包并抛 PublishAssistedReadyError (正常信号)", async () => {
    const promise = xhs.publish(
      {
        topic: TEST_TOPIC,
        title: "一个肯定超过二十个字的小红书标题需要被截断处理",
        contentPath: `outputs/${TEST_TOPIC}/article.md`,
        mediaPaths: [],
        tags: ["效率", "职场"],
      },
      {},
    );
    await expect(promise).rejects.toBeInstanceOf(PublishAssistedReadyError);
    try {
      await xhs.publish(
        {
          topic: TEST_TOPIC,
          title: "一个肯定超过二十个字的小红书标题需要被截断处理",
          contentPath: `outputs/${TEST_TOPIC}/article.md`,
          mediaPaths: [],
          tags: ["效率", "职场"],
        },
        {},
      );
      expect.unreachable("publish 应该 throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublishAssistedReadyError);
      const payload = (error as PublishAssistedReadyError).payload;
      expect(payload.label).toBe("小红书");
      expect(payload.title).toHaveLength(20); // 截断到平台上限
      expect(payload.copyText).toContain("#效率");
      expect(payload.copyText).toContain("辅助发布测试的正文");
      expect(payload.webEntry).toContain("creator.xiaohongshu.com");
      expect(payload.message).toContain("暂不支持自动发布");
    }
  });

  it("weibo 风格标签 (#标签#) 按平台习惯组装", async () => {
    const plat = makeAssistedPublisher("zhihu", {
      label: "知乎",
      webEntry: "https://zhuanlan.zhihu.com/write",
      mediaTypes: ["text"],
      tagStyle: "weibo",
      titleLimit: 0,
      bodyLimit: 0,
      requiresMedia: false,
      howToConnect: "test",
      note: "test",
    });
    try {
      await plat.publish(
        {
          topic: TEST_TOPIC,
          title: "知乎文章标题",
          contentPath: `outputs/${TEST_TOPIC}/article.md`,
          mediaPaths: [],
          tags: ["科技"],
        },
        {},
      );
      expect.unreachable("publish 应该 throw");
    } catch (error) {
      const payload = (error as PublishAssistedReadyError).payload;
      expect(payload.copyText).toContain("#科技#");
      expect(payload.copyText).toContain("知乎文章标题"); // 无独立标题时并入包
    }
  });

  it("正文文件缺失 → PublishNotSupportedError (终态失败, 不假装交付)", async () => {
    const promise = xhs.publish(
      {
        topic: TEST_TOPIC,
        title: "t",
        contentPath: "outputs/_missing_/nope.md",
        mediaPaths: [],
        tags: [],
      },
      {},
    );
    await expect(promise).rejects.toBeInstanceOf(PublishNotSupportedError);
  });

  it("requiresMedia 平台无媒体 → PublishNotSupportedError", async () => {
    const videoPlat = makeAssistedPublisher("wechat-channels", {
      label: "视频号",
      webEntry: "https://channels.weixin.qq.com/platform/post/create",
      mediaTypes: ["video"],
      tagStyle: "hash",
      titleLimit: 0,
      bodyLimit: 1000,
      requiresMedia: true,
      howToConnect: "test",
      note: "test",
    });
    const promise = videoPlat.publish(
      {
        topic: TEST_TOPIC,
        title: "t",
        contentPath: `outputs/${TEST_TOPIC}/article.md`,
        mediaPaths: [],
        tags: [],
      },
      {},
    );
    await expect(promise).rejects.toThrow(/仅支持视频/);
  });
});

describe("douyin publisher (sau 主通道 + API 备用)", () => {
  it("capabilities 声明 sau 模式 + 视频媒体 + 开通指引", () => {
    const caps = douyinPublisher.capabilities();
    expect(caps.autoPublish).toBe(true);
    expect(caps.mode).toBe("sau");
    expect(caps.mediaTypes).toEqual(["video"]);
    expect(caps.authRequired).toBe(true);
    expect(caps.howToConnect).toContain("developer.open-douyin.com");
    expect(caps.howToConnectKey).toBe("easel.settings.douyinGuide");
  });

  it("凭据未注册 → PublishCredentialError (不假装成功)", async () => {
    const { PublishCredentialError } = await import(
      "../../server/lib/publish/index.js"
    );
    const promise = douyinPublisher.publish(
      {
        topic: TEST_TOPIC,
        title: "t",
        contentPath: `outputs/${TEST_TOPIC}/article.md`,
        mediaPaths: ["_nonexistent_/video.mp4"],
        tags: [],
      },
      {},
    );
    // 凭据检查先于文件检查: secrets 里没有 DOUYIN_* 时必须抛凭据错误。
    await expect(promise).rejects.toBeInstanceOf(PublishCredentialError);
  });
});
