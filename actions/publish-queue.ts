import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { publishJobs } from "../server/db/schema.js";
import { newId, nowIso } from "../server/lib/ids.js";
import {
  isPublishPlatform,
  resolvePublisher,
} from "../server/lib/publish/index.js";
import { outputsDir, readManifest } from "../server/lib/outputs-store.js";
import { runQualityGate } from "../server/lib/quality-rules.js";

/**
 * 发布入队 (Phase 2 发布链路唯一入口)。
 *
 * 硬约束: 发布前必须先跑 quality-gate, verdict=block 直接拒绝入队。
 * 平台按能力分层: api 模式全自动发布; assisted 模式 (小红书/知乎/视频号)
 * 队列到点产出复制包 + 网页入口, 用户粘贴完成 (留 manual_assisted 记录);
 * 均不可用时拒绝入队 — 如实告知, 绝不假装排期成功。
 */
export default defineAction({
  title: "发布入队",
  description:
    "把一个成品内容排入发布队列 (立即或定时)。要求: 产物文件已存在于 outputs/、quality-gate 通过 (verdict != block)。平台按模式分层: api 模式 (公众号/B站/微博/抖音) 全自动发布, assisted 模式 (小红书/知乎/视频号) 队列到点产出复制包与网页入口由用户粘贴完成 — 均在入队时如实告知。入队后由调度器到点执行, 状态经 publish-status 查询。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>)"),
    contentPath: z
      .string()
      .min(1)
      .describe("正文文件相对 outputs/ 的路径, 如 outputs/<主题>/article.md"),
    platform: z
      .string()
      .min(1)
      .describe("目标平台 (xiaohongshu/douyin/bilibili/weibo/zhihu/wechat-oa/wechat-channels)"),
    title: z.string().optional().describe("发布标题; 缺省读 manifest.title"),
    mediaPaths: z
      .array(z.string())
      .optional()
      .describe("媒体文件相对 outputs/ 路径列表 (图片/视频)"),
    account: z.string().optional().describe("目标账号标识; 单用户可省略"),
    scheduledAt: z
      .string()
      .optional()
      .describe("计划发布时间 ISO 8601; 缺省立即执行"),
    text: z.string().optional().describe("正文文本; 缺省时从 contentPath 读取"),
    maxAttempts: z.number().int().min(1).max(5).optional().describe("最大尝试次数; 缺省 3"),
  }),
  run: async (args) => {
    if (!isPublishPlatform(args.platform)) {
      fail(
        `未知平台: ${args.platform} — 支持: xiaohongshu/douyin/bilibili/weibo/zhihu/wechat-oa/wechat-channels`,
        { statusCode: 400 },
      );
    }
    const platform = args.platform;

    // ── 1. 平台能力检查 (先于一切) ─────────────────────────────
    const publisher = resolvePublisher(platform);
    const caps = publisher.capabilities();
    const mode = caps.mode ?? "manual";
    if (!caps.autoPublish && mode !== "assisted") {
      fail(
        `平台「${platform}」暂不支持发布 (mode: ${mode})，未入队 — ${caps.note} 可先用 platform-adapt 产出适配稿并人工发布; 自动发布接入进展可用 publish-capabilities 查询。`,
        { statusCode: 400 },
      );
    }
    // assisted 平台: 媒体/正文要求在队列到点时由 publisher 现场校验, 入队时提示即可。

    // ── 1.5 产物存在性校验 (contentPath + mediaPaths, 相对 outputs/) ──
    // 归一化: 剥掉可选的 outputs/ 前缀 (文档示例带前缀, 库内路径不带),
    // 入队后 worker 与各平台 publisher 拿到的都是一致形式。
    const normalizeRel = (p: string) =>
      p.replace(/\\/g, "/").replace(/^outputs\//, "").replace(/^\/+/, "");
    const manifest = readManifest(args.topic);
    const title = args.title || manifest?.title || args.topic;

    const { existsSync } = await import("node:fs");
    const contentPath = normalizeRel(args.contentPath);
    const mediaPaths = (args.mediaPaths ?? []).map(normalizeRel);
    const missing = [contentPath, ...mediaPaths].filter((p) => {
      if (!p || p.split("/").includes("..")) return true;
      return !existsSync(join(outputsDir(), p));
    });
    if (missing.length > 0) {
      fail(`产物文件不存在: ${missing.join(", ")} — 先用 output-file-save 写入成品`, {
        statusCode: 400,
      });
    }

    // ── 3. quality-gate 硬门禁: block 禁止入队 ────────────────
    let text = args.text ?? "";
    if (!text) {
      try {
        const { readOutputFile } = await import("../server/lib/outputs-store.js");
        text = readOutputFile(contentPath).content ?? "";
      } catch {
        text = "";
      }
    }
    const gate = runQualityGate({ text, platform });
    if (gate.verdict === "block") {
      const blockers = gate.issues
        .filter((i) => i.level === "block")
        .map((i) => `${i.rule}: ${i.message}`)
        .join("; ");
      fail(`质量门禁 verdict=block, 禁止入队 — ${blockers}`, { statusCode: 400 });
    }

    // ── 4. 入队 ───────────────────────────────────────────────
    const db = getDb();
    const at = nowIso();
    const id = newId("pj");
    const [row] = await db
      .insert(publishJobs)
      .values({
        id,
        topic: args.topic,
        contentPath,
        mediaPaths,
        platform,
        account: args.account ?? null,
        title,
        scheduledAt: args.scheduledAt ?? at,
        status: "pending",
        attempts: 0,
        maxAttempts: args.maxAttempts ?? 3,
        lastError: null,
        qualityGate: {
          verdict: gate.verdict,
          score: gate.score,
          checkedAt: gate.checkedAt,
        },
        createdAt: at,
        updatedAt: at,
      })
      .returning();

    if (!row) fail("发布任务写入数据库失败", { statusCode: 500 });

    // ── 5. 回读确认再返回 ────────────────────────────────────
    const [confirmed] = await db
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, id));
    if (!confirmed || confirmed.status !== "pending") {
      fail("入队后回读校验失败, 请重试", { statusCode: 500 });
    }

    return {
      job: confirmed,
      qualityGate: gate,
      warnIssues: gate.issues.filter((i) => i.level === "warn"),
    };
  },
});
