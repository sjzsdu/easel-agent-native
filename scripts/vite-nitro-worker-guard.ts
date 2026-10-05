import type { Plugin } from "vite";

/**
 * Nitro dev worker 防僵死守护。
 *
 * 现象（docs/FEEDBACK.md 2026-09-25「整应用 socket hang up 覆盖层」）：
 * Nitro dev worker 崩溃后若未成功重启，dev 代理仍向旧 worker 地址发
 * http.request，每条 SSR 路由稳定抛 "socket hang up"（Socket.socketOnEnd）。
 * Vite 把 SSR 错误渲染成全屏错误覆盖层，Esc / 点击外部 / 刷新都无法恢复。
 *
 * 两层修复：
 *  1. scripts/with-proxy.mjs 注入 NITRO_DEV_RUNNER=node-process，让 worker
 *     跑在独立子进程里，崩溃后锁 / fd 随进程退出而释放，Nitro 的自动重启
 *     才能真正拉起新 worker（治本）。
 *  2. 本插件兜底（治标）：worker 仍僵死时，把这类基础设施错误从 Vite 的
 *     500 错误文档（错误覆盖层）改写成带自动刷新脚本的 503 页面 —— worker
 *     被拉起后页面自愈，用户无需手动 Esc / 重启 dev。
 */

const INFRA_ERROR_PATTERNS: RegExp[] = [
  /^socket hang up$/i,
  /^read econnreset$/i,
  /^write econnreset$/i,
  /^econnreset$/i,
  /^econnrefused$/i,
  /dev server is unavailable/i,
];

const isWorkerInfraError = (message: string): boolean =>
  INFRA_ERROR_PATTERNS.some((re) => re.test(message.trim()));

const RETRY_PAGE = (detail: string): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dev server 重启中…</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.6 system-ui, sans-serif; background: #fafafa; color: #171717; }
      main { width: min(560px, calc(100vw - 48px)); }
      h1 { font-size: 1.2rem; margin: 0 0 8px; }
      p { margin: 0; color: #737373; }
      code { font-size: 0.85em; background: #f0f0f0; padding: 1px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Dev server 正在重启，页面会自动恢复…</h1>
      <p id="easel-retry-status">正在等待 dev server 就绪。</p>
      <p><code>${detail}</code></p>
    </main>
    <script>
      (() => {
        const status = document.getElementById("easel-retry-status");
        const startedAt = Date.now();
        let delayMs = 900;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const poll = async () => {
          while (true) {
            if (status && Date.now() - startedAt > 15000) {
              status.textContent = "仍在等待（首次启动可能需要一两分钟）…";
            }
            try {
              const res = await fetch(location.href, { cache: "no-store", headers: { Accept: "text/html" } });
              if (res.status !== 503) {
                location.reload();
                return;
              }
            } catch {
              // worker 尚未监听，连接被拒属预期，继续轮询。
            }
            await wait(delayMs);
            delayMs = Math.min(delayMs + 400, 4000);
          }
        };
        void poll();
      })();
    </script>
  </body>
</html>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Vite 把 SSR 错误转成错误覆盖层时会走一段 SSE：
 *   event: error
 *   data: {"message":"socket hang up","stack":...}
 * 透传前窥探流内容，命中 worker 基础设施错误时改写为 503 自恢复页面。
 */
export function nitroWorkerGuardPlugin(): Plugin {
  return {
    name: "easel-nitro-worker-guard",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // 只处理 HTML 文档请求：HMR / 数据请求保持 Vite 原生行为。
        const accept = req.headers.accept ?? "";
        if (!accept.includes("text/html")) {
          next();
          return;
        }

        // Vite 错误中间件在内部 pipe 一个 text/event-stream 响应；
        // 我们包一层 write()，在首块里识别该格式并改写。
        const chunks: Buffer[] = [];
        let sseDetected = false;
        let settled = false;

        const origWrite = res.write.bind(res) as (...writeArgs: unknown[]) => boolean;
        const origEnd = res.end.bind(res) as (...endArgs: unknown[]) => typeof res;

        res.write = ((chunk: unknown, ...rest: unknown[]) => {
          if (!settled) {
            const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : null;
            if (buffer) chunks.push(buffer);
            const seen = Buffer.concat(chunks).toString("utf8");
            if (!sseDetected) {
              // SSE 起始行只有两种可能；未命中说明是普通响应，恢复直通。
              if (/^\s*(event|retry|data|:)/.test(seen) && seen.length >= 6) {
                sseDetected = /^event:\s*error/.test(seen) || seen.includes('"type":"error"');
                if (!sseDetected && chunks.length > 4) {
                  settled = true; // 非错误 SSE / 普通流，停止窥探
                }
              } else {
                settled = true;
              }
            }
            if (sseDetected && seen.includes('"message"')) {
              settled = true;
              const message = extractSseErrorMessage(seen);
              if (message && isWorkerInfraError(message)) {
                res.write = origWrite as typeof res.write;
                res.end = origEnd as typeof res.end;
                res.removeHeader("content-type");
                res.removeHeader("content-length");
                res.statusCode = 503;
                res.setHeader("content-type", "text/html; charset=utf-8");
                res.setHeader("cache-control", "no-store");
                res.setHeader("refresh", "3");
                res.end(RETRY_PAGE(escapeHtml(message)));
                return true;
              }
            }
          }
          return origWrite(chunk, ...rest);
        }) as typeof res.write;

        res.end = ((...args: unknown[]) => {
          if (!settled) {
            // end() 直接带 body 的场景（无 chunked 中间块）。
            const last = args[0];
            const buffer = typeof last === "string" ? Buffer.from(last) : Buffer.isBuffer(last) ? last : null;
            if (buffer) {
              chunks.push(buffer);
              const seen = Buffer.concat(chunks).toString("utf8");
              const message = extractSseErrorMessage(seen);
              if (message && isWorkerInfraError(message)) {
                res.write = origWrite;
                res.end = origEnd as typeof res.end;
                res.statusCode = 503;
                res.removeHeader("content-type");
                res.removeHeader("content-length");
                res.setHeader("content-type", "text/html; charset=utf-8");
                res.setHeader("cache-control", "no-store");
                res.setHeader("refresh", "3");
                return (origEnd as (...endArgs: unknown[]) => typeof res)(RETRY_PAGE(escapeHtml(message)));
              }
            }
          }
          return (origEnd as (...endArgs: unknown[]) => typeof res)(...args);
        }) as typeof res.end;

        next();
      });
    },
  };
}

/** 从 Vite 错误 SSE / 错误 JSON 里抽取 message 字段。 */
function extractSseErrorMessage(text: string): string | null {
  const dataLine = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .find((line) => line.includes('"message"'));
  if (!dataLine) {
    const jsonMatch = text.match(/\{"message"[\s\S]*?"stack"/);
    if (!jsonMatch) return null;
    return parseErrorMessage(jsonMatch[0] + '"}');
  }
  return parseErrorMessage(dataLine);
}

function parseErrorMessage(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    const inline = json.match(/"message":"((?:[^"\\]|\\.)*)"/);
    return inline ? JSON.parse(`"${inline[1]}"`) as string : null;
  }
}
