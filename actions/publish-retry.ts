import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishJobs } from "../server/db/schema.js";
import { nowIso } from "../server/lib/ids.js";
import { isPublishPlatform, resolvePublisher } from "../server/lib/publish/index.js";

/**
 * 失败重试: failed/cancelled 任务重新入队。attempts 保留历史计数,
 * 但重排 scheduled_at 为立即执行; 平台能力 (api/assisted) 重新校验,
 * 均不可用时如实报错。
 */
export default defineAction({
  title: "重试发布任务",
  description:
    "把 failed 或 cancelled 的发布任务重新入队 (立即执行)。重试前会再次校验平台能力 — api/assisted 模式可重试, 平台不可用时明确报错, 不会假装重试成功。",
  schema: z.object({
    id: z.string().min(1).describe("publish_jobs.id"),
    scheduledAt: z.string().optional().describe("重试计划时间; 缺省立即"),
  }),
  run: async ({ id, scheduledAt }) => {
    const db = getDb();
    const at = nowIso();

    const [existing] = await db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, id));
    if (!existing) fail(`发布任务不存在: ${id}`, { statusCode: 404 });
    if (existing.status === "pending" || existing.status === "running") {
      fail(`任务已在队列中 (状态 ${existing.status}), 无需重试`, { statusCode: 409 });
    }
    if (!isPublishPlatform(existing.platform)) {
      fail(`任务平台无效: ${existing.platform}`, { statusCode: 400 });
    }

    const caps = resolvePublisher(existing.platform).capabilities();
    const mode = caps.mode ?? "manual";
    if (!caps.autoPublish && mode !== "assisted") {
      fail(`平台「${existing.platform}」暂不支持发布 (mode: ${mode}) — ${caps.note}`, {
        statusCode: 400,
      });
    }

    const [row] = await db
      .update(publishJobs)
      .set({
        status: "pending",
        scheduledAt: scheduledAt ?? at,
        lastError: null,
        claimedAt: null,
        finishedAt: null,
        updatedAt: at,
      })
      .where(eq(publishJobs.id, id))
      .returning();

    if (!row) fail("重试更新失败", { statusCode: 500 });

    // 回读确认
    const [confirmed] = await db.select().from(publishJobs).where(eq(publishJobs.id, id));
    return { job: confirmed };
  },
});
