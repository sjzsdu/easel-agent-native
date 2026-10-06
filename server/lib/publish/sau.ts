/**
 * sau 发布通道 (social-auto-upload, github.com/dreammis/social-auto-upload)。
 *
 * sau 是浏览器自动化 + 账号 cookie 的 Python CLI — 不需要平台开放资质,
 * 适合个人创作者。本模块只封装「调 CLI、捕退出码/输出、超时控制」这一层,
 * 不解析 cookie 状态; 登录由用户在终端跑 `sau douyin login` 完成。
 *
 * 配置 (user-scoped secrets, 设置页 API keys 填写):
 * - SAU_EXECUTABLE     : sau 可执行文件路径; 缺省 "sau" (PATH 上)
 * - SAU_DOUYIN_ACCOUNT : `sau douyin login` 时登记的抖音账号名 (cookie 名)
 *
 * 架构扩展位: sau 官方还支持 B站/小红书/快手 等, 新平台接入时按 douyin
 * 的模式加一个 runSauUpload 的包装即可, 执行与错误分类复用本模块。
 */

import { execFile } from "node:child_process";

import {
  resolvePublishCredentials,
  type PublishOptions,
} from "./index.js";

/** sau 上传是 Playwright 全流程, 分钟级耗时; 15 分钟兜底防任务挂死。 */
export const SAU_UPLOAD_TIMEOUT_MS = 15 * 60_000;

/** `sau --version` 这类轻量探测的超时。 */
export const SAU_PROBE_TIMEOUT_MS = 20_000;

export interface SauConfig {
  /** sau 可执行文件 (路径或 PATH 上命令名)。 */
  executable: string;
  /** 抖音账号名 (cookie 标识); 未配置 = sau 通道未启用。 */
  douyinAccount: string | null;
}

export type SauUploadFailureKind =
  | "not_installed"
  | "not_logged_in"
  | "timeout"
  | "failed";

export type SauUploadOutcome =
  | { ok: true; log: string }
  | { ok: false; kind: SauUploadFailureKind; log: string };

/** 读取 sau 通道配置 (user-scoped secrets; 缺省可执行文件名 "sau")。 */
export async function resolveSauConfig(
  options?: Pick<PublishOptions, "userEmail" | "orgId">,
): Promise<SauConfig> {
  const creds = await resolvePublishCredentials(
    ["SAU_EXECUTABLE", "SAU_DOUYIN_ACCOUNT"],
    options,
  );
  return {
    executable: creds.SAU_EXECUTABLE?.trim() || "sau",
    douyinAccount: creds.SAU_DOUYIN_ACCOUNT?.trim() || null,
  };
}

/** 截取 CLI 输出尾部作为 publish record 的日志片段 (避免超长)。 */
export function logTail(output: string, maxChars = 2000): string {
  const trimmed = (output ?? "").trim();
  return trimmed.length <= maxChars
    ? trimmed
    : `…${trimmed.slice(-maxChars)}`;
}

/** 判定 CLI 输出是否指向登录/cookie 问题 (用于区分不可重试的凭据错误)。 */
export function looksLikeLoginProblem(output: string): boolean {
  return /not logged in|未登录|login required|cookie.*(过期|失效|invalid)|未找到.*cookie|账号未授权/i.test(
    output ?? "",
  );
}

interface ExecOutcome {
  code: number;
  stdout: string;
  stderr: string;
  killed: boolean;
  enoent: boolean;
}

function execSau(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        // error == null 表示退出码 0; 有 error 时 err.code 是数字退出码或
        // ENOENT 这类字符串 (非数字退出码归 1, 让调用方按「失败」处理)。
        const numericCode =
          err == null
            ? 0
            : typeof err.code === "number"
              ? err.code
              : 1;
        resolve({
          code: numericCode,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          killed: Boolean(err?.killed),
          enoent: err?.code === "ENOENT",
        });
      },
    );
  });
}

/**
 * 执行 `sau douyin upload-video`。不抛异常 — 结果以可区分的 outcome 返回,
 * 由调用方 (publisher) 映射成 PublishResult / Publish*Error。
 */
export async function runSauDouyinUpload(
  config: SauConfig,
  input: { file: string; title: string; desc?: string; timeoutMs?: number },
): Promise<SauUploadOutcome> {
  const args = [
    "douyin",
    "upload-video",
    "--account",
    config.douyinAccount ?? "",
    "--file",
    input.file,
    "--title",
    input.title,
  ];
  if (input.desc) args.push("--desc", input.desc);

  const outcome = await execSau(
    config.executable,
    args,
    input.timeoutMs ?? SAU_UPLOAD_TIMEOUT_MS,
  );
  const output = logTail(`${outcome.stdout}\n${outcome.stderr}`);

  if (outcome.enoent) {
    return { ok: false, kind: "not_installed", log: output };
  }
  if (outcome.killed) {
    return { ok: false, kind: "timeout", log: output };
  }
  if (outcome.code !== 0) {
    return {
      ok: false,
      kind: looksLikeLoginProblem(`${outcome.stdout}\n${outcome.stderr}`)
        ? "not_logged_in"
        : "failed",
      log: output,
    };
  }
  return { ok: true, log: output };
}
