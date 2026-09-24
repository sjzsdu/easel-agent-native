import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  PublishAssistedReadyError,
  resolvePublisher,
  type AssistedPublishPayload,
  type PublishContent,
} from "../server/lib/publish/index.js";
import { readManifest } from "../server/lib/outputs-store.js";

/**
 * 辅助发布包 (assisted 平台): 队列到点前也可让 agent / UI 按需获取
 * 「标题 + 正文 + 标签」复制包与网页发布入口。
 *
 * 仅服务 assisted 模式平台; api 模式平台请走 publish-queue 全自动链路。
 * 包内容从 outputs/ 产物文件现场组装, 与 worker 队列执行时的产物一致。
 */
export default defineAction({
  title: "生成辅助发布包",
  description:
    "为辅助发布 (assisted) 平台 — 小红书/知乎/视频号 — 生成发布复制包: 标题、正文、平台格式标签、媒体文件清单与网页发布入口, 供用户一键复制后到平台网页端粘贴发布。API 平台 (公众号/B站/微博/抖音) 不适用本 action, 应走 publish-queue 自动发布。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>), 用于读 manifest.tags"),
    contentPath: z
      .string()
      .min(1)
      .describe("正文文件相对 outputs/ 的路径, 如 outputs/<主题>/article.md"),
    platform: z
      .string()
      .min(1)
      .describe("目标平台 (xiaohongshu/zhihu/wechat-channels)"),
    title: z.string().optional().describe("发布标题; 缺省读 manifest.title"),
    mediaPaths: z
      .array(z.string())
      .optional()
      .describe("媒体文件相对 outputs/ 路径列表 (图片/视频)"),
  }),
  run: async (args) => {
    if (!["xiaohongshu", "zhihu", "wechat-channels"].includes(args.platform)) {
      fail(
        `平台「${args.platform}」不是辅助发布平台 (assisted 仅: xiaohongshu/zhihu/wechat-channels) — api 平台请用 publish-queue`,
        { statusCode: 400 },
      );
    }

    const publisher = resolvePublisher(
      args.platform as "xiaohongshu" | "zhihu" | "wechat-channels",
    );
    const caps = publisher.capabilities();
    if (caps.mode !== "assisted") {
      fail(`平台「${args.platform}」当前不是 assisted 模式 — ${caps.note}`, {
        statusCode: 400,
      });
    }

    const manifest = readManifest(args.topic);
    const content: PublishContent = {
      topic: args.topic,
      title: args.title || manifest?.title || args.topic,
      contentPath: args.contentPath,
      mediaPaths: args.mediaPaths ?? [],
      tags: Array.isArray(manifest?.tags) ? manifest.tags : [],
    };

    try {
      // assisted publisher 在校验通过后 throw PublishAssistedReadyError
      // (这是「包已就绪」的正常信号, 不是错误)。
      await publisher.publish(content, {});
      fail("辅助发布包生成失败: publisher 未返回结果", { statusCode: 500 });
    } catch (error) {
      if (error instanceof PublishAssistedReadyError) {
        const p: AssistedPublishPayload = error.payload;
        return {
          ok: true,
          platform: args.platform,
          label: p.label,
          webEntry: p.webEntry,
          copyText: p.copyText,
          title: p.title,
          tags: p.tags,
          mediaPaths: p.mediaPaths,
          message: p.message,
          note: "复制包由 outputs/ 产物现场组装; 媒体文件需在平台网页端手动上传",
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      fail(`辅助发布包生成失败: ${message}`, { statusCode: 400 });
    }
  },
});
