/**
 * Easel 媒体作业服务 — 包装 .agents/shared/scripts/ 下的确定性 Python 脚本。
 *
 * 设计约束 (AGENTS.md Easel Domain):
 * - 依赖缺失 → 结构化 unavailable (缺什么 + 怎么装), 绝不崩溃、绝不假装成功。
 * - 输入输出一律限定在 outputs/ 内 (与 output-file-save 同一目录契约),
 *   大文件只落文件系统, 进 SQL 的只有路径/URL。
 * - actions 运行在 Node.js 里可以自由 fs/path; 本模块仅供 actions/ 使用。
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { outputsDir } from "../outputs-store.js";
import { missingDeps, resolvePython, scriptEnv, type MediaDep, type MediaDepName } from "./deps.js";

// ── 结果类型 ────────────────────────────────────────────────────────

export interface MediaFile {
  /** 相对 outputs/ 的路径, 如 「我的主题/card.png」 */
  path: string;
  /** 页面预览 URL (走 /outputs 媒体路由) */
  previewUrl: string;
  bytes: number;
}

export type MediaResult =
  | { ok: true; status: "done"; files: MediaFile[]; log: string }
  | {
      ok: false;
      status: "unavailable";
      message: string;
      missing: Array<{ name: string; label: string; install: string }>;
    }
  | { ok: false; status: "failed"; message: string };

// ── 路径安全 (与 outputs-store 同规则) ──────────────────────────────

/** 把相对 outputs/ 的路径解析为绝对路径; 拒绝绝对路径、`..`、越界与 `_` 系统目录。 */
export function resolveMediaPath(relPath: string, what: string): string {
  if (!relPath || isAbsolute(relPath)) {
    throw new Error(`${what} 必须是相对 outputs/ 的路径: ${relPath}`);
  }
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (segments.includes("..")) {
    throw new Error(`${what} 不允许包含 "..": ${relPath}`);
  }
  if (segments[0].startsWith("_") || segments[0].startsWith(".")) {
    throw new Error(`${what} 不允许落在系统目录: ${relPath}`);
  }
  const base = outputsDir();
  const full = resolve(base, normalized);
  if (!full.startsWith(base + sep)) {
    throw new Error(`${what} 越出 outputs 目录: ${relPath}`);
  }
  return full;
}

function toMediaFile(fullPath: string): MediaFile | null {
  if (!existsSync(fullPath)) return null;
  const stat = statSync(fullPath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size === 0) return null;
  const base = outputsDir();
  const rel = relative(base, fullPath).split(sep).join("/");
  if (rel.startsWith("..")) return null;
  return { path: rel, previewUrl: `/outputs/${rel}`, bytes: stat.size };
}

// ── 脚本执行 ────────────────────────────────────────────────────────

const SCRIPTS_DIR = resolve(process.cwd(), ".agents", "shared", "scripts");

export interface ScriptRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runScript(script: string, args: string[], timeoutMs: number): ScriptRun {
  // 用解析出的解释器 (可能是 pyenv/Homebrew, 而非 PATH 上的 python3), 并把
  // 它的 bin 目录前置到 PATH — 脚本内部用 shutil.which 找 edge-tts/ffmpeg。
  const python = resolvePython();
  const result = spawnSync(python, [join(SCRIPTS_DIR, script), ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...scriptEnv(python), PYTHONIOENCODING: "utf8" },
  });
  if (result.error) {
    const message = result.error.message;
    return { code: -1, stdout: result.stdout ?? "", stderr: `${result.stderr ?? ""}\n${message}` };
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v", ".ts", ".wmv"]);
export function isVideoFile(path: string): boolean {
  return VIDEO_EXTS.has(extname(path).toLowerCase());
}

function unavailable(missing: MediaDep[]): MediaResult {
  return {
    ok: false,
    status: "unavailable",
    message: `媒体依赖缺失: ${missing.map((d) => d.label).join(", ")}。安装后重试。`,
    missing: missing.map((d) => ({ name: d.name, label: d.label, install: d.install })),
  };
}

function failed(script: string, run: ScriptRun): MediaResult {
  const tail = `${run.stderr}\n${run.stdout}`.trim().split("\n").slice(-12).join("\n");
  return {
    ok: false,
    status: "failed",
    message: `${script} 执行失败 (exit ${run.code}):\n${tail || "(无输出)"}`,
  };
}

function assertDepArgs(names: MediaDepName[]): void {
  // 保留给调用方文档用; 实际探测统一走 guardDeps。
}

/** 探测依赖, 缺失时返回结构化 unavailable。 */
function guardDeps(names: MediaDepName[]): MediaResult | null {
  const missing = missingDeps(names);
  return missing.length ? unavailable(missing) : null;
}

// ── 1. render_card.py — HTML → 图片 ────────────────────────────────

export interface RenderCardOptions {
  htmlRel: string;
  outRel?: string;
  outDirRel?: string;
  selector?: string;
  all?: string;
  prefix?: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  scale?: number;
  format?: "png" | "jpeg";
  quality?: number;
  wait?: number;
  navTimeout?: number;
}

export function renderCard(opts: RenderCardOptions): MediaResult {
  const guard = guardDeps(["python3", "playwright"]);
  if (guard) return guard;

  let htmlFull: string;
  try {
    htmlFull = resolveMediaPath(opts.htmlRel, "html 路径");
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
  if (!existsSync(htmlFull)) {
    return { ok: false, status: "failed", message: `HTML 文件不存在: ${opts.htmlRel}` };
  }

  const args = ["--html", htmlFull, "--format", opts.format ?? "png"];
  const expected: string[] = [];
  try {
    if (opts.all) {
      if (!opts.outDirRel) {
        return { ok: false, status: "failed", message: "批量模式 (--all) 需要 outDir 提供输出目录" };
      }
      const outDirFull = resolveMediaPath(opts.outDirRel, "outDir 路径");
      args.push("--all", opts.all, "--out-dir", outDirFull, "--prefix", opts.prefix ?? "card");
      // 批量产物数量运行时才知道; 渲染后按 outDir 扫描收集。
    } else {
      const outRel = opts.outRel ?? `${opts.htmlRel.replace(/\.[^.]+$/, "")}.${opts.format ?? "png"}`;
      const outFull = resolveMediaPath(outRel, "out 路径");
      args.push("--out", outFull);
      expected.push(outFull);
    }
    if (opts.selector && !opts.all) args.push("--selector", opts.selector);
    if (opts.fullPage && !opts.all) args.push("--full-page");
    if (opts.width) args.push("--width", String(opts.width));
    if (opts.height) args.push("--height", String(opts.height));
    if (opts.scale) args.push("--scale", String(opts.scale));
    if (opts.quality) args.push("--quality", String(opts.quality));
    if (opts.wait) args.push("--wait", String(opts.wait));
    if (opts.navTimeout) args.push("--nav-timeout", String(opts.navTimeout));
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }

  const run = runScript("render_card.py", args, 180_000);
  if (run.code !== 0) return failed("render_card.py", run);

  const files = expected
    .map(toMediaFile)
    .filter((f): f is MediaFile => f !== null);
  if (files.length > 0) return { ok: true, status: "done", files, log: run.stdout.trim() };

  // 批量模式: 从脚本输出 ("✅ <绝对路径> (…KB)") 收集产物。
  const batchFiles: MediaFile[] = [];
  for (const line of run.stdout.split("\n")) {
    const m = line.match(/✅\s+(\S+)\s+\(/);
    if (!m) continue;
    const file = toMediaFile(m[1]);
    if (file) batchFiles.push(file);
  }
  if (batchFiles.length === 0) {
    return {
      ok: false,
      status: "failed",
      message: `render_card.py 退出码为 0 但未收集到产物。输出:\n${run.stdout.trim().slice(-500)}`,
    };
  }
  return { ok: true, status: "done", files: batchFiles, log: run.stdout.trim() };
}

// ── 2. tts.py — 文字转语音 ─────────────────────────────────────────

export interface SpeakOptions {
  text?: string;
  fileRel?: string;
  outRel: string;
  voice?: string;
  engine?: "auto" | "closed" | "edge";
  rate?: string;
  volume?: string;
  pitch?: string;
  subtitleRel?: string;
  format?: "auto" | "mp3" | "wav" | "m4a";
}

export function speak(opts: SpeakOptions): MediaResult {
  const required: MediaDepName[] = ["python3", "edge-tts"];
  // 非 mp3 输出需要 ffmpeg 转码; wav/m4a 显式指定或由扩展名决定。
  const fmt = opts.format ?? "auto";
  const extFmt = fmt === "auto" ? extname(opts.outRel).toLowerCase().replace(".", "") : fmt;
  if (extFmt === "wav" || extFmt === "m4a") required.push("ffmpeg");
  const guard = guardDeps(required);
  if (guard) return guard;

  let outFull: string;
  const args = ["speak"];
  try {
    outFull = resolveMediaPath(opts.outRel, "输出路径");
    args.push("--output", outFull);
    if (opts.text) args.push("--text", opts.text);
    if (opts.fileRel) {
      const fileFull = resolveMediaPath(opts.fileRel, "文本文件路径");
      if (!existsSync(fileFull)) {
        return { ok: false, status: "failed", message: `文本文件不存在: ${opts.fileRel}` };
      }
      args.push("--file", fileFull);
    }
    if (!opts.text && !opts.fileRel) {
      return { ok: false, status: "failed", message: "text 与 file 至少提供一个" };
    }
    if (opts.voice) args.push("--voice", opts.voice);
    if (opts.engine) args.push("--engine", opts.engine);
    if (opts.rate) args.push(`--rate=${opts.rate}`);
    if (opts.volume) args.push(`--volume=${opts.volume}`);
    if (opts.pitch) args.push(`--pitch=${opts.pitch}`);
    if (opts.subtitleRel) args.push("--subtitle", resolveMediaPath(opts.subtitleRel, "字幕路径"));
    if (fmt !== "auto") args.push("--format", fmt);
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }

  const run = runScript("tts.py", args, 330_000);
  if (run.code !== 0) return failed("tts.py", run);

  const files: MediaFile[] = [];
  const audioFile = toMediaFile(outFull);
  if (audioFile) files.push(audioFile);
  if (opts.subtitleRel) {
    const subFile = toMediaFile(resolveMediaPath(opts.subtitleRel, "字幕路径"));
    if (subFile) files.push(subFile);
  }
  if (!audioFile) {
    return {
      ok: false,
      status: "failed",
      message: `tts.py 退出码为 0 但未找到音频产物: ${opts.outRel}\n${run.stdout.trim().slice(-400)}`,
    };
  }
  return { ok: true, status: "done", files, log: run.stdout.trim() };
}

// ── 3. asr.py — 语音转字幕 ─────────────────────────────────────────

export interface TranscribeOptions {
  inputRel: string;
  outRel?: string;
  format?: "srt" | "ass" | "txt" | "json";
  model?: string;
  language?: string;
  maxLineChars?: number;
  beamSize?: number;
}

export function transcribe(opts: TranscribeOptions): MediaResult {
  const required: MediaDepName[] = ["python3", "faster-whisper"];
  if (isVideoFile(opts.inputRel)) required.push("ffmpeg"); // 视频输入需先提取音轨
  const guard = guardDeps(required);
  if (guard) return guard;

  let inputFull: string;
  let outRel: string;
  try {
    inputFull = resolveMediaPath(opts.inputRel, "输入路径");
    if (!existsSync(inputFull)) {
      return { ok: false, status: "failed", message: `输入文件不存在: ${opts.inputRel}` };
    }
    const fmt = opts.format ?? "srt";
    outRel =
      opts.outRel ?? `${opts.inputRel.replace(/\.[^.]+$/, "")}.${fmt}`;
    resolveMediaPath(outRel, "输出路径"); // 只做校验
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }

  const args = [
    "transcribe",
    "--input", inputFull,
    "--output", resolveMediaPath(outRel, "输出路径"),
    "--format", opts.format ?? "srt",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.language) args.push("--language", opts.language);
  if (opts.maxLineChars) args.push("--max-line-chars", String(opts.maxLineChars));
  if (opts.beamSize) args.push("--beam-size", String(opts.beamSize));

  // 首次运行会从 HuggingFace 下载模型, 给足超时。
  const run = runScript("asr.py", args, 3_600_000);
  if (run.code !== 0) return failed("asr.py", run);

  const file = toMediaFile(resolveMediaPath(outRel, "输出路径"));
  if (!file) {
    return {
      ok: false,
      status: "failed",
      message: `asr.py 退出码为 0 但未找到字幕产物: ${outRel}\n${run.stdout.trim().slice(-400)}`,
    };
  }
  return { ok: true, status: "done", files: [file], log: run.stdout.trim() };
}

// ── 4. subtitle_ops.py — 字幕处理 ──────────────────────────────────

export type SubtitleOp = "parse" | "extract" | "merge" | "build" | "convert" | "burn";

export interface SubtitleOptions {
  op: SubtitleOp;
  inputRel?: string;
  jsonRel?: string;
  transRel?: string;
  outRel?: string;
  format?: "srt" | "vtt" | "ass";
  order?: "orig-top" | "trans-top";
  transOnly?: boolean;
  soft?: boolean;
  forceStyle?: string;
}

const SUBTITLE_DEPS: Record<SubtitleOp, MediaDepName[]> = {
  parse: ["python3"],
  extract: ["python3"],
  merge: ["python3"],
  build: ["python3"],
  convert: ["python3"],
  burn: ["python3", "ffmpeg"],
};

export function subtitle(opts: SubtitleOptions): MediaResult {
  const guard = guardDeps(SUBTITLE_DEPS[opts.op]);
  if (guard) return guard;

  const args: string[] = [opts.op];
  try {
    if (opts.op === "build") {
      if (!opts.jsonRel) return { ok: false, status: "failed", message: "build 操作需要 json 输入" };
      args.push("--json", resolveMediaPath(opts.jsonRel, "JSON 路径"));
    } else {
      if (!opts.inputRel) return { ok: false, status: "failed", message: `${opts.op} 操作需要 input 输入` };
      args.push("--input", resolveMediaPath(opts.inputRel, "输入路径"));
    }
    if (opts.transRel) args.push("--trans", resolveMediaPath(opts.transRel, "译文路径"));
    if (opts.outRel) args.push("--output", resolveMediaPath(opts.outRel, "输出路径"));
    if (opts.format) args.push("--format", opts.format);
    if (opts.order) args.push("--order", opts.order);
    if (opts.transOnly) args.push("--trans-only");
    if (opts.soft) args.push("--soft");
    if (opts.forceStyle) args.push("--force-style", opts.forceStyle);
  } catch (error) {
    return { ok: false, status: "failed", message: error instanceof Error ? error.message : String(error) };
  }

  // burn 要重新编码视频, 可能较慢; parse/extract 秒级。
  const timeout = opts.op === "burn" ? 900_000 : 120_000;
  const run = runScript("subtitle_ops.py", args, timeout);
  if (run.code !== 0) return failed("subtitle_ops.py", run);

  // parse/extract 省略 -o 时结果走 stdout (文本量小, 直接返回)。
  if (!opts.outRel && (opts.op === "parse" || opts.op === "extract")) {
    return { ok: true, status: "done", files: [], log: run.stdout.trim() };
  }
  if (!opts.outRel) {
    return { ok: false, status: "failed", message: `${opts.op} 操作需要 out 提供输出路径` };
  }

  const file = toMediaFile(resolveMediaPath(opts.outRel, "输出路径"));
  if (!file) {
    return {
      ok: false,
      status: "failed",
      message: `subtitle_ops.py 退出码为 0 但未找到产物: ${opts.outRel}\n${run.stdout.trim().slice(-400)}`,
    };
  }
  return { ok: true, status: "done", files: [file], log: run.stdout.trim() };
}
