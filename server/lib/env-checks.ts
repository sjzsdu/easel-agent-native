/**
 * 环境体检 (easel doctor 的 TS 对应物).
 * 纯本机探测, 不修改任何状态.
 */

import { spawnSync } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";

import { outputsDir } from "./outputs-store.js";
import { listEaselSkills } from "./skill-catalog.js";

export interface DoctorCheck {
  name: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

function probeCommand(command: string, args: string[]): { ok: boolean; detail: string } {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 8_000 });
    if (result.error) return { ok: false, detail: result.error.message };
    const firstLine = (result.stdout || result.stderr || "").split("\n")[0]?.trim() ?? "";
    return { ok: result.status === 0, detail: firstLine || `exit ${result.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function runDoctor(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const [major, minor] = process.versions.node.split(".").map(Number);
  const nodeOk = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 22);
  checks.push({
    name: "node",
    label: "Node.js ≥ 22.22",
    ok: nodeOk,
    required: true,
    detail: `v${process.versions.node}`,
  });

  const ffmpeg = probeCommand("ffmpeg", ["-version"]);
  checks.push({
    name: "ffmpeg",
    label: "FFmpeg (音视频处理)",
    ok: ffmpeg.ok,
    required: false,
    detail: ffmpeg.ok ? ffmpeg.detail : "未安装 — Phase 1 文本工作流不受影响",
  });

  const python = probeCommand("python3", ["--version"]);
  checks.push({
    name: "python",
    label: "Python 3 (兼容原 Easel 脚本, 可选)",
    ok: python.ok,
    required: false,
    detail: python.ok ? python.detail : "未安装",
  });

  let outputsOk = false;
  let outputsDetail = "";
  try {
    const dir = outputsDir();
    if (!existsSync(dir)) {
      outputsDetail = `${dir} 尚不存在 (首次写入时自动创建)`;
      outputsOk = true;
    } else {
      accessSync(dir, constants.W_OK);
      outputsDetail = dir;
      outputsOk = true;
    }
  } catch (error) {
    outputsDetail = error instanceof Error ? error.message : String(error);
  }
  checks.push({
    name: "outputs",
    label: "内容归档目录 outputs/ 可写",
    ok: outputsOk,
    required: true,
    detail: outputsDetail,
  });

  const skillCount = listEaselSkills().length;
  checks.push({
    name: "skills",
    label: "Easel 工作流技能已安装",
    ok: skillCount > 0,
    required: true,
    detail: `${skillCount} 个技能 (.agents/skills)`,
  });

  const databaseUrl = process.env.DATABASE_URL || "pglite:./data/pglite (默认)";
  checks.push({
    name: "database",
    label: "数据库连接 DATABASE_URL",
    ok: true,
    required: true,
    detail: databaseUrl.startsWith("pglite:")
      ? `本地 PGlite — ${databaseUrl}`
      : `PostgreSQL — ${databaseUrl.replace(/\/\/[^@]*@/, "//***@")}`,
  });

  const configuredKeys = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "EASEL_LLM_API_KEY",
  ].filter((key) => Boolean(process.env[key])); // guard:allow-env-credential — presence probe only (boolean check for the settings page; values are never read, real LLM credentials go through resolveCredential/secrets)
  checks.push({
    name: "llm",
    label: "LLM 凭证",
    ok: configuredKeys.length > 0,
    required: false,
    detail: configuredKeys.length
      ? `已配置 ${configuredKeys.join(", ")}`
      : "未在环境变量中检测到 (可在设置页连接)",
  });

  return checks;
}

export function projectRoot(): string {
  return resolve(process.cwd());
}
