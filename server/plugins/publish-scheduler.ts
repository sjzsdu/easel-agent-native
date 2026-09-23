import { startIntervalJob, type IntervalJobHandle } from "@agent-native/core/server/interval-job";
import { recordChange } from "@agent-native/core/server/poll";
import { defineNitroPlugin } from "@agent-native/core/server";
import { getDb } from "../db/index.js";
import { processPendingPublishJobs } from "../lib/publish-worker.js";

/**
 * 发布调度器 (Phase 2): 进程内定时轮询 publish_jobs, 到点执行 + 退避重试。
 *
 * - 60s tick, 与 real-time-sync 技能描述的框架同步链路一致: worker 的每次
 *   DB 状态变更通过 recordChange 广播, UI 的 useDbSync/useChangeVersions
 *   立即看到; 框架的 poll fallback 兜底跨进程写入。
 * - startIntervalJob 自带 overlap 保护 (上一 tick 未结束不会并发)。
 * - PGlite 单写者: 本插件与 actions 同进程, 无跨进程锁问题。
 */
let handle: IntervalJobHandle | undefined;

export default defineNitroPlugin(async () => {
  // 延迟 15s 启动首个 tick, 避开启动期迁移窗口。
  handle = startIntervalJob(
    async () => {
      const result = await processPendingPublishJobs();
      if (result.claimed > 0) {
        // 每次状态变更广播给 UI (source=publish 供页面精准失效)。
        recordChange({ source: "publish", type: "jobs-processed" });
      }
    },
    { intervalMs: 60_000, leading: true, timeoutMs: 120_000 },
  );

  // 确认 DB 可用后再放开 (迁移由 db.ts 插件完成; 失败不阻断应用启动)。
  try {
    await getDb().execute("select 1");
  } catch (error) {
    console.error(
      "[publish-scheduler] database unavailable at startup, scheduler will retry:",
      error instanceof Error ? error.message : error,
    );
  }
});
