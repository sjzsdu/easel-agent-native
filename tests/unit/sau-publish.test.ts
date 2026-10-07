/**
 * sau 发布通道集成测试 — 用 stub 可执行文件替代真实 sau CLI。
 *
 * 真实链路依赖抖音扫码登录 (sau douyin login), CI/本地自动化跑不了;
 * 每个场景生成一个行为内联的 stub 脚本 (退出码/输出写死在脚本里,
 * 不碰 process.env — doctor 的 no-env-credentials 守卫要求凭据类环境
 * 读取走 resolveCredential, 测试 stub 与凭据无关但也无需环境变量),
 * 覆盖: 成功 / 上传失败 / 未安装 / 未登录 / 超时 五条路径 + 参数组装。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PublishCredentialError,
  PublishTransientError,
} from "../../server/lib/publish/index.js";
import {
  logTail,
  looksLikeLoginProblem,
  runSauDouyinUpload,
  type SauConfig,
} from "../../server/lib/publish/sau.js";

let stubDir: string | undefined;

/** 生成一个行为内联的 stub: 退出码/输出写死在脚本里 (每用例独立临时目录按需创建)。 */
function makeStub(name: string, body: string): string {
  stubDir ??= mkdtempSync(join(tmpdir(), "sau-stub-"));
  const path = join(stubDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("runSauDouyinUpload — stub 集成", () => {
  it("success: exit 0 → ok + 输出片段", async () => {
    const stub = makeStub(
      "sau-ok",
      `printf '%s\\n' "upload success, video_id=123"
exit 0`,
    );

    const outcome = await runSauDouyinUpload(
      { executable: stub, douyinAccount: "我的抖音号" },
      { file: "/tmp/v.mp4", title: "测试标题", desc: "测试描述", timeoutMs: 10_000 },
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.log).toContain("video_id=123");
  });

  it("组装的参数包含 account/file/title/desc", async () => {
    const logPath = join(stubDir ?? "", "args.log");
    const argStub = makeStub(
      "sau-args",
      `printf '%s\\n' "$@" > "${logPath}"
exit 0`,
    );

    const outcome = await runSauDouyinUpload(
      { executable: argStub, douyinAccount: "acc1" },
      { file: "/tmp/x.mp4", title: "T1", desc: "D1", timeoutMs: 10_000 },
    );
    expect(outcome.ok).toBe(true);

    const args = execFileSync("cat", [logPath], { encoding: "utf8" }).split("\n");
    expect(args).toContain("douyin");
    expect(args).toContain("upload-video");
    expect(args.indexOf("--account") + 1).toBe(args.indexOf("acc1"));
    expect(args.indexOf("--file") + 1).toBe(args.indexOf("/tmp/x.mp4"));
    expect(args.indexOf("--title") + 1).toBe(args.indexOf("T1"));
    expect(args.indexOf("--desc") + 1).toBe(args.indexOf("D1"));
  });

  it("upload failure: exit 1 且无登录特征 → kind=failed", async () => {
    const stub = makeStub(
      "sau-fail",
      `printf '%s\\n' "platform error 500" >&2
exit 1`,
    );

    const outcome = await runSauDouyinUpload(
      { executable: stub, douyinAccount: "a" },
      { file: "/tmp/v.mp4", title: "t", timeoutMs: 10_000 },
    );

    expect(outcome).toMatchObject({ ok: false, kind: "failed" });
  });

  it("not logged in: 登录特征输出 → kind=not_logged_in", async () => {
    const stub = makeStub(
      "sau-nologin",
      `printf '%s\\n' "douyin account not logged in, cookie missing" >&2
exit 2`,
    );

    const outcome = await runSauDouyinUpload(
      { executable: stub, douyinAccount: "a" },
      { file: "/tmp/v.mp4", title: "t", timeoutMs: 10_000 },
    );

    expect(outcome).toMatchObject({ ok: false, kind: "not_logged_in" });
  });

  it("not installed: 可执行文件不存在 → kind=not_installed", async () => {
    const outcome = await runSauDouyinUpload(
      { executable: join(stubDir ?? "", "no-such-sau"), douyinAccount: "a" },
      { file: "/tmp/v.mp4", title: "t", timeoutMs: 10_000 },
    );

    expect(outcome).toMatchObject({ ok: false, kind: "not_installed" });
  });

  it("timeout: 超时被杀 → kind=timeout", async () => {
    const slowStub = makeStub("sau-slow", "sleep 5\necho done");

    const outcome = await runSauDouyinUpload(
      { executable: slowStub, douyinAccount: "a" },
      { file: "/tmp/v.mp4", title: "t", timeoutMs: 200 },
    );

    expect(outcome).toMatchObject({ ok: false, kind: "timeout" });
  });
});

describe("sau 输出处理与错误分类", () => {
  it("logTail 截断超长输出", () => {
    expect(logTail("ab")).toBe("ab");
    const long = "x".repeat(3000);
    const tail = logTail(long, 2000);
    expect(tail.length).toBe(2001); // "…" + 2000
    expect(tail.startsWith("…")).toBe(true);
  });

  it("looksLikeLoginProblem 覆盖中英常见提示", () => {
    expect(looksLikeLoginProblem("账号未登录")).toBe(true);
    expect(looksLikeLoginProblem("cookie 已失效")).toBe(true);
    expect(looksLikeLoginProblem("Not logged in")).toBe(true);
    expect(looksLikeLoginProblem("upload ok")).toBe(false);
  });

  it("credential 错误分类不重试 (PublishCredentialError)", () => {
    const err = new PublishCredentialError("douyin", ["SAU_DOUYIN_ACCOUNT"]);
    expect(err.name).toBe("PublishCredentialError");
    expect(err.platform).toBe("douyin");
  });

  it("瞬时错误分类 (PublishTransientError) 可重试", () => {
    const err = new PublishTransientError("douyin", "sau 上传失败");
    expect(err.name).toBe("PublishTransientError");
  });
});
