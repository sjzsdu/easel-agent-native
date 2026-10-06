/**
 * sau 发布通道集成测试 — 用 stub 可执行文件替代真实 sau CLI。
 *
 * 真实链路依赖抖音扫码登录 (sau douyin login), CI/本地自动化跑不了;
 * stub 校验参数形状、按环境变量返回可控退出码/输出/耗时, 覆盖:
 * 成功 / 上传失败 / 未安装 / 未登录 / 超时 五条路径 + 参数组装。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

let stubDir: string;
let stubPath: string;

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "sau-stub-"));
  stubPath = join(stubDir, "sau");
  writeFileSync(
    stubPath,
    `#!/bin/sh
# sau stub — 行为由环境变量控制
if [ -n "$SAU_STUB_STDERR" ]; then
  printf '%s\\n' "$SAU_STUB_STDERR" >&2
fi
printf '%s\\n' "$SAU_STUB_STDOUT"
exit "\${SAU_STUB_EXIT:-0}"
`,
  );
  chmodSync(stubPath, 0o755);
});

afterEach(() => {
  delete process.env.SAU_STUB_EXIT;
  delete process.env.SAU_STUB_STDOUT;
  delete process.env.SAU_STUB_STDERR;
});

const config: SauConfig = { executable: "", douyinAccount: "我的抖音号" };

describe("runSauDouyinUpload — stub 集成", () => {
  it("success: exit 0 → ok + 输出片段", async () => {
    config.executable = stubPath;
    process.env.SAU_STUB_STDOUT = "upload success, video_id=123";
    process.env.SAU_STUB_EXIT = "0";

    const outcome = await runSauDouyinUpload(config, {
      file: "/tmp/v.mp4",
      title: "测试标题",
      desc: "测试描述",
      timeoutMs: 10_000,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.log).toContain("video_id=123");
  });

  it("组装的参数包含 account/file/title/desc", async () => {
    const logPath = join(stubDir, "args.log");
    config.executable = stubPath;
    // stub 已把 "$@" 之外的内容打出去; 这里直接用另一个 stub 记录参数
    const argStub = join(stubDir, "sau-args");
    writeFileSync(
      argStub,
      `#!/bin/sh
printf '%s\\n' "$@" > "${logPath}"
exit 0
`,
    );
    chmodSync(argStub, 0o755);

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
    config.executable = stubPath;
    process.env.SAU_STUB_EXIT = "1";
    process.env.SAU_STUB_STDERR = "platform error 500";

    const outcome = await runSauDouyinUpload(config, {
      file: "/tmp/v.mp4",
      title: "t",
      timeoutMs: 10_000,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "failed" });
  });

  it("not logged in: 登录特征输出 → kind=not_logged_in", async () => {
    config.executable = stubPath;
    process.env.SAU_STUB_EXIT = "2";
    process.env.SAU_STUB_STDERR = "douyin account not logged in, cookie missing";

    const outcome = await runSauDouyinUpload(config, {
      file: "/tmp/v.mp4",
      title: "t",
      timeoutMs: 10_000,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "not_logged_in" });
  });

  it("not installed: 可执行文件不存在 → kind=not_installed", async () => {
    config.executable = join(stubDir, "no-such-sau");

    const outcome = await runSauDouyinUpload(config, {
      file: "/tmp/v.mp4",
      title: "t",
      timeoutMs: 10_000,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "not_installed" });
  });

  it("timeout: 超时被杀 → kind=timeout", async () => {
    const slowStub = join(stubDir, "sau-slow");
    writeFileSync(
      slowStub,
      "#!/bin/sh\nsleep 5\necho done\n",
    );
    chmodSync(slowStub, 0o755);

    const outcome = await runSauDouyinUpload(
      { executable: slowStub, douyinAccount: "a" },
      { file: "/tmp/v.mp4", title: "t", timeoutMs: 200 },
    );

    expect(outcome).toMatchObject({ ok: false, kind: "timeout" });
  });
});

describe("douyin sau 通道错误映射 (publishViaSau 路径)", () => {
  // publishViaSau 未单独导出 — 通过模块内的错误分类约定间接验证:
  // not_installed / not_logged_in → PublishCredentialError (不重试);
  // timeout / failed → PublishTransientError (worker 按重试策略处理)。
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
