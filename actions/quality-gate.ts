import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { PLATFORM_LIMITS, runQualityGate } from "../server/lib/quality-rules.js";

export default defineAction({
  title: "发布质量门禁",
  description:
    "对一段待发布文案做确定性质检: 敏感信息 (密钥/内网地址/本地路径) 判 block 硬拦, AI 味措辞/开头套话/通用劝告/收藏型 CTA/绝对化用语/超平台字数判 warn。任何真实发布前必须先跑它, verdict=block 时禁止发布并说明问题。",
  schema: z.object({
    text: z.string().describe("待检查的文案全文"),
    platform: z
      .enum(["xiaohongshu", "weibo", "douyin", "bilibili", "zhihu", "kuaishou", "wechat-channels", "wechat-oa"])
      .optional()
      .describe("目标平台; 提供后校验字数限制"),
  }),
  http: { method: "POST" },
  readOnly: true,
  run: async ({ text, platform }) => {
    const result = runQualityGate({ text, platform });
    return {
      ...result,
      allowedToPublish: result.verdict !== "block",
      platforms: platform ? undefined : PLATFORM_LIMITS,
    };
  },
});
