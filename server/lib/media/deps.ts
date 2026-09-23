/**
 * 媒体依赖探测 (Easel 媒体引擎, Phase 3 前半).
 *
 * 纯本机只读探测: ffmpeg/ffprobe 走二进制版本命令, python 侧依赖
 * (edge-tts 命令 / faster-whisper / playwright 模块) 走 `python3 -c` 探测。
 * 探测失败绝不抛异常 — 一律返回结构化结果, 由上层把
 * "缺什么 + 怎么装" 如实交给 agent 转告用户。
 */

import { spawnSync } from "node:child_process";

export type MediaDepName =
  | "python3"
  | "ffmpeg"
  | "ffprobe"
  | "edge-tts"
  | "faster-whisper"
  | "playwright";

export interface MediaDep {
  name: MediaDepName;
  label: string;
  ok: boolean;
  detail: string;
  install: string;
}

interface Probe {
  name: MediaDepName;
  label: string;
  install: string;
  check: () => { ok: boolean; detail: string };
}

function runProbe(command: string, args: string[], timeoutMs = 10_000): { ok: boolean; detail: string } {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) return { ok: false, detail: result.error.message };
    const firstLine = (result.stdout || result.stderr || "").split("\n")[0]?.trim() ?? "";
    return { ok: result.status === 0, detail: firstLine || `exit ${result.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** 单条 python 表达式探测 (import / shutil.which), 10s 超时。 */
function probePython(code: string): { ok: boolean; detail: string } {
  return runProbe("python3", ["-c", code]);
}

const PROBES: Probe[] = [
  {
    name: "python3",
    label: "Python 3",
    install: "安装 Python 3 (brew install python3)",
    check: () => runProbe("python3", ["--version"]),
  },
  {
    name: "ffmpeg",
    label: "FFmpeg (音视频处理)",
    install: "brew install ffmpeg",
    check: () => runProbe("ffmpeg", ["-version"]),
  },
  {
    name: "ffprobe",
    label: "ffprobe (时长/元信息探测, 随 ffmpeg 安装)",
    install: "brew install ffmpeg",
    check: () => runProbe("ffprobe", ["-version"]),
  },
  {
    name: "edge-tts",
    label: "edge-tts (微软在线 TTS 命令)",
    install: "pip install edge-tts",
    check: () =>
      probePython("import shutil, sys; p = shutil.which('edge-tts'); print(p or 'not-found'); sys.exit(0 if p else 1)"),
  },
  {
    name: "faster-whisper",
    label: "faster-whisper (本地 ASR 模块)",
    install: "pip install faster-whisper",
    check: () => probePython("import faster_whisper"),
  },
  {
    name: "playwright",
    label: "playwright (HTML 截图渲染)",
    install: "pip install playwright && playwright install chromium",
    check: () => probePython("import playwright"),
  },
];

const probeByName = new Map(PROBES.map((p) => [p.name, p]));

const depCache = new Map<MediaDepName, MediaDep>();

/** 探测单个依赖 (进程内缓存 — 探测只读且结果在进程生命周期内稳定)。 */
export function probeDep(name: MediaDepName): MediaDep {
  const cached = depCache.get(name);
  if (cached) return cached;
  const probe = probeByName.get(name);
  if (!probe) throw new Error(`未知媒体依赖: ${name}`);
  const result = probe.check();
  const dep: MediaDep = {
    name: probe.name,
    label: probe.label,
    ok: result.ok,
    detail: result.ok ? result.detail : "未检测到",
    install: probe.install,
  };
  depCache.set(name, dep);
  return dep;
}

/** 批量探测; 返回全部依赖的探测结果 (含可用的)。 */
export function probeDeps(names: MediaDepName[]): MediaDep[] {
  return names.map(probeDep);
}

/** 缺失依赖列表; 全部可用时返回空数组。 */
export function missingDeps(names: MediaDepName[]): MediaDep[] {
  return probeDeps(names).filter((dep) => !dep.ok);
}
