/**
 * outputs/ 内容项目文件仓 (Easel 产物归档契约).
 *
 * 仅供 actions/ 使用 — actions 运行在 Node.js 中, 可以自由使用 fs/path;
 * server routes 与 plugins 禁止 (可移植性约束).
 *
 * 布局 (与原 Easel 一致):
 *   outputs/<主题>/            项目目录: 成品放根, 中间件进 assets/
 *   outputs/<主题>/.easel.json  唯一元数据 (manifest)
 *   outputs/_(前缀目录)         `_` 前缀系统目录, 不出现在内容库
 *   (即 `_` 开头的目录被跳过)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve, sep } from "node:path";

export interface EaselManifestStep {
  layer?: string;
  skill?: string;
  at?: string;
  status?: string;
  outputs?: string[];
  upstream?: string[];
  summary?: string;
}

export interface EaselManifest {
  topic?: string;
  profile?: string;
  created?: string;
  updated?: string;
  title?: string;
  summary?: string;
  platform?: string;
  kind?: string;
  status?: string;
  tags?: string[];
  cover?: string;
  deliverables?: string[];
  steps?: EaselManifestStep[];
}

export interface OutputProject {
  topic: string;
  path: string;
  manifest: EaselManifest;
  fileCount: number;
  hasManifest: boolean;
}

// ── 媒体预览 (Phase 3 前半): /outputs 页 <img>/<audio>/<video> 用 ──

export type MediaKind = "image" | "audio" | "video";

const MEDIA_EXTENSIONS: Record<MediaKind, Set<string>> = {
  image: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]),
  audio: new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac"]),
  video: new Set([".mp4", ".webm", ".mov"]),
};

export interface MediaPreviewFile {
  /** 相对 outputs/ 的路径 (预览 URL = /outputs/<path>) */
  path: string;
  name: string;
  kind: MediaKind;
  bytes: number;
}

function collectMediaFiles(
  dir: string,
  relBase: string,
  depth: number,
  out: MediaPreviewFile[],
): void {
  if (depth > 3 || out.length >= 24) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= 24) return;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const full = join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectMediaFiles(full, rel, depth + 1, out);
      continue;
    }
    const kind = (Object.keys(MEDIA_EXTENSIONS) as MediaKind[]).find((k) =>
      MEDIA_EXTENSIONS[k].has(extname(entry.name).toLowerCase()),
    );
    if (!kind) continue;
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) continue;
    out.push({
      path: rel,
      name: entry.name,
      kind,
      bytes: stat.size,
    });
  }
}

/** 列出项目下可预览的媒体文件 (图片/音频/视频, 最多 24 个), 供 /outputs 页预览。 */
export function listMediaFiles(topic: string): MediaPreviewFile[] {
  const dir = resolve(outputsDir(), topic);
  if (!existsSync(dir)) return [];
  const files: MediaPreviewFile[] = [];
  collectMediaFiles(dir, "", 0, files);
  return files;
}

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".csv", ".tsv", ".html", ".htm", ".css",
  ".js", ".ts", ".tsx", ".py", ".yaml", ".yml", ".toml", ".xml",
  ".srt", ".ass", ".vtt", ".log",
]);

export function outputsDir(): string {
  return process.env.EASEL_OUTPUTS_DIR || resolve(process.cwd(), "outputs"); // guard:allow-env-credential — app-level outputs dir override (local path config, not a credential; see AGENTS.md Easel Domain)
}

function safeResolve(relPath: string): string {
  const base = outputsDir();
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").includes("..")) {
    throw new Error(`路径不允许包含 "..": ${relPath}`);
  }
  const full = resolve(base, normalized);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`路径越出 outputs 目录: ${relPath}`);
  }
  return full;
}

export function ensureOutputsDir(): void {
  mkdirSync(outputsDir(), { recursive: true });
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 4) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) count += countFiles(join(dir, entry.name), depth + 1);
    else count += 1;
  }
  return count;
}

export function readManifest(topic: string): EaselManifest | null {
  const file = safeResolve(join(topic, ".easel.json"));
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as EaselManifest;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeManifest(topic: string, manifest: EaselManifest): EaselManifest {
  const dir = safeResolve(topic);
  mkdirSync(dir, { recursive: true });
  const next: EaselManifest = {
    ...manifest,
    topic: manifest.topic || topic,
    updated: new Date().toISOString(),
    created: manifest.created || new Date().toISOString(),
  };
  writeFileSync(join(dir, ".easel.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** 扫描 outputs/ 下的项目目录 (跳过 `_` 系统目录与隐藏目录). */
export function listProjects(): OutputProject[] {
  ensureOutputsDir();
  const projects: OutputProject[] = [];
  for (const entry of readdirSync(outputsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const manifest = readManifest(entry.name);
    projects.push({
      topic: entry.name,
      path: `outputs/${entry.name}`,
      manifest: manifest ?? { topic: entry.name, status: "draft", kind: "other" },
      fileCount: countFiles(join(outputsDir(), entry.name)),
      hasManifest: manifest !== null,
    });
  }
  return projects;
}

export interface OutputFileResult {
  path: string;
  encoding: "text" | "binary";
  size: number;
  content?: string;
  previewUrl?: string;
}

/** 读取 outputs/ 下文件; 文本返回内容, 二进制返回可预览 URL. */
export function readOutputFile(relPath: string): OutputFileResult {
  const full = safeResolve(relPath);
  const stat = statSync(full, { throwIfNoEntry: false });
  if (!stat) throw new Error(`文件不存在: ${relPath}`);
  if (!stat.isFile()) throw new Error(`不是文件: ${relPath}`);

  const ext = extname(full).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return {
      path: relPath.replace(/\\/g, "/"),
      encoding: "text",
      size: stat.size,
      content: readFileSync(full, "utf8"),
    };
  }
  return {
    path: relPath.replace(/\\/g, "/"),
    encoding: "binary",
    size: stat.size,
    previewUrl: `/outputs/${relPath.replace(/\\/g, "/").replace(/^\/+/, "")}`,
  };
}

export function writeOutputFile(relPath: string, content: string): { path: string; bytes: number } {
  if (isAbsolute(relPath)) throw new Error(`只允许相对 outputs 的路径: ${relPath}`);
  const full = safeResolve(relPath);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return { path: relPath.replace(/\\/g, "/"), bytes: Buffer.byteLength(content, "utf8") };
}

/** 删除文件或项目目录; 拒绝触碰 `_` 系统目录与 outputs 根. */
export function deleteOutputPath(relPath: string): { deleted: string } {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const topSegment = normalized.split("/")[0] ?? "";
  if (!topSegment || topSegment === "." || topSegment.startsWith("_")) {
    throw new Error(`不允许删除系统路径: ${relPath}`);
  }
  const full = safeResolve(normalized);
  if (full === outputsDir()) throw new Error("不允许删除 outputs 根目录");
  if (!existsSync(full)) throw new Error(`路径不存在: ${relPath}`);
  rmSync(full, { recursive: true, force: true });
  return { deleted: normalized };
}
