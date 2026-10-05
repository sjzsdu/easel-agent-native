#!/usr/bin/env node
/**
 * `pnpm dev` 入口包装: 注入本地代理环境后再启动 agent-native.
 *
 * 为什么需要包装 (bug: agent 聊天 Connect Timeout to api.openai.com):
 * Node 的 `NODE_USE_ENV_PROXY` / `HTTPS_PROXY` 必须在进程启动时就存在,
 * 运行中后补无效 (undici 全局 dispatcher 在 bootstrap 阶段按当时环境创建);
 * 而 `agent-native dev` CLI 自身不加载 .env, 所以代理变量必须在 spawn 时
 * 带进子进程环境 — vite / Nitro dev server / LLM 调用全部继承该环境.
 *
 * 代理来源与 .agents/shared/scripts/*.py 的约定一致 (EASEL_PROXY, 不设则不走代理):
 *   1. shell 环境 EASEL_PROXY (最高优先)
 *   2. .env.local / .env 里的 EASEL_PROXY
 *   3. shell 环境 HTTPS_PROXY / https_proxy
 * 启动时先探测代理可达性 (TCP connect, 800ms):
 *   可达   → 子进程带 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY/HTTP_PROXY, 并保证
 *            NO_PROXY 覆盖回环地址 (dev 自请求 / SSR 不走代理);
 *   未配置或不可达 → 直连启动, 与未包装时行为一致.
 *
 * 另注入 NITRO_DEV_RUNNER=node-process: Nitro dev worker 默认跑在 vite 进程内的
 * worker thread 里, 崩溃后其 PGlite 单实例锁 / 端口 fd 不会随线程退出而释放,
 * 内置 3 次重试全部复用同一个已僵死的线程位置 → 每条 SSR 路由稳定报
 * "socket hang up" (Vite 全屏覆盖层, Esc/刷新都救不回来), 只能整体重启 dev.
 * 改用 node-process runner 后 worker 跑在独立子进程, 崩溃即释放锁与 fd,
 * Nitro 的自动重启 ("Restarting dev worker...") 才能真正拉起新 worker.
 *
 * 用法与 `agent-native` 一致, 只是参数原样透传:
 *   node scripts/with-proxy.mjs dev --open
 *   node scripts/with-proxy.mjs agent "列出可用 actions"
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBE_TIMEOUT_MS = 800;
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

/** 从 .env.local / .env 文本里读 EASEL_PROXY (不整文件载入 process.env). */
function readEaselProxyFromFile() {
  for (const name of [".env.local", ".env"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?EASEL_PROXY\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  return "";
}

/** shell 优先, 其次 .env.local, 最后 .env (与 loadEnv 约定一致). */
function readProxySource() {
  return (
    // guard:allow-env-credential — 本机代理地址是网络路由配置, 非用户凭据 (shell 覆盖)
    (process.env.EASEL_PROXY || "").trim() ||
    readEaselProxyFromFile() ||
    // guard:allow-env-credential — 本机代理地址是网络路由配置, 非用户凭据 (shell 回退)
    (process.env.HTTPS_PROXY || "").trim() ||
    (process.env.https_proxy || "").trim()
  );
}

function probeProxy(proxyUrl) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(proxyUrl.includes("://") ? proxyUrl : `http://${proxyUrl}`);
    } catch {
      resolve(false);
      return;
    }
    const socket = net.connect({
      host: target.hostname || "127.0.0.1",
      port: Number(target.port) || 80,
    });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** 保证 NO_PROXY 含回环, 否则 dev 进程的自身请求/SSR 回环也会走代理. */
function ensureLoopbackNoProxy(env) {
  const entries = (env.NO_PROXY || env.no_proxy || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const host of LOOPBACK) {
    if (!entries.includes(host)) entries.push(host);
  }
  env.NO_PROXY = entries.join(",");
}

async function main() {
  const env = { ...process.env };
  const proxy = readProxySource();

  if (proxy) {
    if (await probeProxy(proxy)) {
      env.NODE_USE_ENV_PROXY = "1";
      env.HTTPS_PROXY = proxy;
      env.HTTP_PROXY = proxy;
      ensureLoopbackNoProxy(env);
      console.log(`[with-proxy] 代理已启用: ${proxy} (agent 聊天经代理访问外网)`);
    } else {
      console.warn(
        `[with-proxy] 代理不可达, 直连启动: ${proxy}\n` +
          "[with-proxy] 直连下 agent 聊天访问 api.openai.com 可能超时; 启动代理后重试 pnpm dev.",
      );
    }
  }

  // Nitro dev worker 独立子进程化 (见文件头注释): 崩溃可自愈, 不再
  // 出现整应用 "socket hang up" 覆盖层. 用户显式设置时不覆盖.
  env.NITRO_DEV_RUNNER = env.NITRO_DEV_RUNNER ?? "node-process";

  const shim = join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "agent-native.cmd" : "agent-native",
  );
  if (!existsSync(shim)) {
    console.error(`[with-proxy] 未找到 ${shim}, 请先执行 pnpm install.`);
    process.exit(1);
  }

  const child = spawn(shim, process.argv.slice(2), {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
  child.on("error", (error) => {
    console.error(`[with-proxy] 启动 agent-native 失败: ${error.message}`);
    process.exit(1);
  });
}

await main();
