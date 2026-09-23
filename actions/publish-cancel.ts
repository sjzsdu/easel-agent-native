import { eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishJobs } from "../server/db/schema.js";
import { nowIso } from "../server/lib/ids.js";

/** 取消还在排队/等待重试的发布任务 (running 不可取消 — 已交给平台)。 */
export default defineAction({
  title: "取消发布任务",
  description:
    "取消一个 pending 状态的发布任务 (执行中的任务不可取消)。取消后状态置为 cancelled, 可在发布页看到。",
  schema: z.object({
    id: z.string().min(1).describe("publish_jobs.id"),
  }),
  run: async ({ id }) => {
    const db = getDb();
    const at = nowIso();

    const [row] = await db
      .update(publishJobs)
      .set({ status: "cancelled", finishedAt: at, updatedAt: at })
      .where(eq(publishJobs.id, id))
      .returning();

    if (!row) fail(`发布任务不存在: ${id}`, { statusCode: 404 });
    if (row.status !== "cancelled") {
      fail(
        `任务当前状态为 ${row.status}, 仅 pending 可取消 (执行中的任务已交给平台, 无法撤回)`,
        { statusCode: 409 },
      );
    }

    // 回读确认
    const [confirmed] = await db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, id));
    return { job: confirmed };
  },
});
