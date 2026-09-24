/**
 * 媒体依赖探测 (Easel 媒体引擎, Phase 3 前半).
 *
 * 纯本机只读探测: ffmpeg/ffprobe 走二进制版本命令, python 侧依赖
 * (edge-tts 命令 / faster-whisper / playwright 模块) 走 `python3 -c` 探测。
 * 探测失败绝不抛异常 — 一律返回结构化结果, 由上层把
 * "缺什么 + 怎么装" 如实交给 agent 转告用户。
 *
 * ── 为什么要显式解析解释器 ──────────────────────────────────────────
 * 开发机上通常同时存在多个 python3 (pyenv / python.org framework / Homebrew
 * / 系统自带), 裸 `python3` 只能走 PATH。问题是应用进程的 PATH 与用户登录
 * shell 的 PATH 并不一致: 实测同一台机器上 `pnpm dev` 起的服务解析到
 * python.org 3.11, 而依赖装在 pyenv 3.12.4 — 于是 "明明装好了却报缺失"。
 *
 * 因此这里显式解析解释器:
 *   1. `EASEL_PYTHON` 显式指定 → 直接采用 (最高优先级, 跳过扫描);
 *   2. 否则扫描候选解释器, 取「媒体依赖命中最多」的那个 (同分取候选靠前者);
 *   3. 全都不命中 → 回退 PATH 上的 python3, 让探测如实报缺。
 * 选中的解释器同时用于依赖探测与脚本执行 (见 scriptEnv), 两者必然一致;
 * 每个探测结果的 detail 都带上解释器绝对路径, agent 可据此向用户解释。
 *
 * 脚本自身用 `shutil.which("edge-tts")` / `which("ffmpeg")` 找工具, 属于
 * PATH 相对查找 — 所以 scriptEnv 会把「解释器自己的 bin 目录」和常见
 * 二进制目录前置到子进程 PATH, 否则即使模块装对了, CLI 也找不到。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

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

// ── 解释器解析 ──────────────────────────────────────────────────────

/** 常见二进制目录: ffmpeg/ffprobe 在 Homebrew 前缀下, 未必在应用进程 PATH 里。 */
const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** python 侧媒体依赖的描述: kind=bin 走 shutil.which, kind=mod 走 import 探测。 */
const PY_MEDIA_SPECS = [
  { kind: "bin", target: "edge-tts" },
  { kind: "mod", target: "faster_whisper" },
  { kind: "mod", target: "playwright" },
] as const;

/**
 * 候选解释器评分脚本: 单次子进程内用 find_spec / which 做结构性检查,
 * 不真正 import (避免 playwright/faster-whisper 的重依赖拖慢扫描)。
 * 最终对被选中的解释器才做真实 import 探测, 保证 detail 不说谎。
 */
const SCORE_SCRIPT = [
  "import importlib.util, json, shutil, sys",
  "out = {}",
  "for spec in sys.argv[1:]:",
  "    kind, _, target = spec.partition(':')",
  "    if kind == 'mod':",
  "        try:",
  "            out[target] = importlib.util.find_spec(target) is not None",
  "        except Exception:",
  "            out[target] = False",
  "    else:",
  "        out[target] = shutil.which(target) is not None",
  "print(json.dumps(out))",
].join("\n");

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** 在 PATH 上定位二进制 (用绝对路径的 which, 免得依赖 shell 内建)。 */
function whichOnPath(bin: string): string | null {
  const result = spawnSync("/usr/bin/which", [bin], { encoding: "utf8", timeout: 5_000 });
  const first = (result.stdout ?? "").split("\n")[0]?.trim() ?? "";
  return first && existsSync(first) ? first : null;
}

/**
 * 子进程环境: 把解释器自己的 bin 目录与常见二进制目录前置到 PATH。
 * 脚本内部用 `shutil.which` 找 edge-tts/ffmpeg, 依赖这条 PATH。
 */
export function scriptEnv(pythonPath: string): NodeJS.ProcessEnv {
  const dirs = [dirname(pythonPath), ...EXTRA_BIN_DIRS];
  const base = process.env.PATH ?? ""; // guard:allow-env-credential — 进程 PATH 拼接 (定位本机二进制, 非凭证; 见本文件顶部解释器解析说明)
  return { ...process.env, PATH: `${dirs.join(delimiter)}${delimiter}${base}` };
}

/** 显式指定的解释器 (EASEL_PYTHON); 未设置或不可执行时返回 null。 */
function pythonOverride(): string | null {
  const raw = process.env.EASEL_PYTHON; // guard:allow-env-credential — 本机 python 解释器路径配置 (非凭证; 见本文件顶部解释器解析说明)
  if (!raw) return null;
  return existsSync(raw) ? raw : null;
}

function pythonCandidates(): string[] {
  const list: string[] = [];
  const push = (path: string | null | undefined) => {
    if (path && !list.includes(path) && existsSync(path)) list.push(path);
  };

  push(pythonOverride());
  push(whichOnPath("python3"));

  const pyenvRoot = process.env.PYENV_ROOT || join(homedir(), ".pyenv"); // guard:allow-env-credential — pyenv 根目录 (用于枚举候选解释器, 非凭证)
  for (const version of readdirSafe(join(pyenvRoot, "versions")).sort().reverse()) {
    push(join(pyenvRoot, "versions", version, "bin", "python3"));
  }

  push("/opt/homebrew/bin/python3");
  push("/usr/local/bin/python3");

  const framework = "/Library/Frameworks/Python.framework/Versions";
  for (const version of readdirSafe(framework).sort().reverse()) {
    push(join(framework, version, "bin", "python3"));
  }

  push("/usr/bin/python3");
  return list;
}

/** 解释器命中多少条 python 侧媒体依赖 (0..PY_MEDIA_SPECS.length)。 */
function scoreInterpreter(pythonPath: string): number {
  const specs = PY_MEDIA_SPECS.map((spec) => `${spec.kind}:${spec.target}`);
  const result = spawnSync(pythonPath, ["-c", SCORE_SCRIPT, ...specs], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: scriptEnv(pythonPath),
  });
  const stdout = (result.stdout ?? "").trim();
  if (result.status !== 0 || !stdout) return 0;
  try {
    const parsed = JSON.parse(stdout) as Record<string, boolean>;
    return Object.values(parsed).filter(Boolean).length;
  } catch {
    return 0;
  }
}

let resolvedPython: string | null = null;

/**
 * 选定媒体脚本使用的 python3 解释器 (绝对路径)。
 * 结果进程内缓存 — 探测只读, 且解释器选择在进程生命周期内稳定。
 */
export function resolvePython(): string {
  if (resolvedPython) return resolvedPython;

  const override = pythonOverride();
  if (override) {
    resolvedPython = override;
    return resolvedPython;
  }

  const candidates = pythonCandidates();
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreInterpreter(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
    if (bestScore === PY_MEDIA_SPECS.length) break; // 满分, 无需继续扫
  }

  resolvedPython = best ?? candidates[0] ?? "python3";
  return resolvedPython;
}

/** 当前选定解释器上的依赖是否齐备 (供上层做 "为什么不可用" 的解释)。 */
export function pythonHasMediaDeps(): boolean {
  return scoreInterpreter(resolvePython()) === PY_MEDIA_SPECS.length;
}

// ── 子进程探测 ──────────────────────────────────────────────────────

function runProbe(
  command: string,
  args: string[],
  timeoutMs = 10_000,
  env?: NodeJS.ProcessEnv,
): { ok: boolean; detail: string } {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      ...(env ? { env } : {}),
    });
    if (result.error) return { ok: false, detail: result.error.message };
    const firstLine = (result.stdout || result.stderr || "").split("\n")[0]?.trim() ?? "";
    return { ok: result.status === 0, detail: firstLine || `exit ${result.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** 用选定的解释器跑一段 python, 环境与脚本执行完全一致。 */
function probePython(code: string, timeoutMs = 20_000): { ok: boolean; detail: string } {
  const python = resolvePython();
  return runProbe(python, ["-c", code], timeoutMs, scriptEnv(python));
}

/** 二进制探测: 连版本一起走同一条 PATH 前缀, 与应用实际执行环境一致。 */
function probeBinary(bin: string, args: string[]): { ok: boolean; detail: string } {
  return runProbe(bin, args, 10_000, scriptEnv(resolvePython()));
}

const PROBES: Probe[] = [
  {
    name: "python3",
    label: "Python 3",
    install: "安装 Python 3 (brew install python3)",
    check: () => {
      const python = resolvePython();
      const result = runProbe(python, ["--version"], 10_000, scriptEnv(python));
      const version = result.detail.replace(/^Python\s+/i, "");
      return { ok: result.ok, detail: result.ok ? `${version} @ ${python}` : result.detail };
    },
  },
  {
    name: "ffmpeg",
    label: "FFmpeg (音视频处理)",
    install: "brew install ffmpeg",
    check: () => probeBinary("ffmpeg", ["-version"]),
  },
  {
    name: "ffprobe",
    label: "ffprobe (时长/元信息探测, 随 ffmpeg 安装)",
    install: "brew install ffmpeg",
    check: () => probeBinary("ffprobe", ["-version"]),
  },
  {
    name: "edge-tts",
    label: "edge-tts (微软在线 TTS 命令)",
    install: "pip install edge-tts",
    check: () =>
      probePython(
        "import shutil, sys; p = shutil.which('edge-tts'); print(p or 'not-found'); sys.exit(0 if p else 1)",
      ),
  },
  {
    name: "faster-whisper",
    label: "faster-whisper (本地 ASR 模块)",
    install: "pip install faster-whisper",
    check: () =>
      probePython("import faster_whisper, importlib.metadata as m; print(m.version('faster-whisper'))"),
  },
  {
    name: "playwright",
    label: "playwright (HTML 截图渲染)",
    install: "pip install playwright && playwright install chromium",
    check: () =>
      probePython("import playwright, importlib.metadata as m; print(m.version('playwright'))"),
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

/**
 * 清空探测缓存 (解释器选择 + 各依赖结果)。
 * 供测试使用: 生产路径上解释器与依赖在进程生命周期内不会变; 用户在服务运行
 * 期间新装依赖, 需要重启服务 (或走 actions 的一次性进程) 才会被识别。
 */
export function resetMediaDepCache(): void {
  depCache.clear();
  resolvedPython = null;
}
