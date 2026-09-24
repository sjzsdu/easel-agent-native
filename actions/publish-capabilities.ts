import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  PLATFORM_LABELS,
  summarizePublishers,
} from "../server/lib/publish/index.js";

/**
 * 七平台发布能力与开通指引 (真实状态, 不虚报)。
 *
 * 每平台透出: mode (api/assisted/manual) + 支持媒体类型 + 凭据要求
 * (authRequired) + 开通引导 (howToConnect) + 网页发布入口 (webEntry)。
 * agent 安排发布计划、回答「能不能自动发」「怎么开通」前先调用本 action,
 * 按平台 mode 如实告知用户。
 */
export default defineAction({
  title: "查询平台发布能力",
  description:
    "返回七平台 (小红书/抖音/B站/微博/知乎/公众号/视频号) 的发布能力与开通指引: 每平台的接入模式 (api=凭据齐备即可全自动发布 / assisted=辅助发布, 队列产出复制包+网页入口由用户粘贴完成 / manual=仅人工)、支持的媒体类型、凭据要求 (authRequired)、开通引导 (howToConnect) 与网页发布入口。安排发布计划、回答「能不能自动发」「怎么开通」之前先调用, 按 mode 如实告知用户。",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const publishers = summarizePublishers();
    const modeOf = (p: (typeof publishers)[number]) =>
      p.capabilities.mode ?? "manual";

    return {
      platforms: publishers,
      labels: PLATFORM_LABELS,
      apiReady: publishers
        .filter((p) => p.capabilities.autoPublish && modeOf(p) === "api")
        .map((p) => p.platform),
      assisted: publishers
        .filter((p) => modeOf(p) === "assisted")
        .map((p) => p.platform),
      manualOnly: publishers
        .filter((p) => modeOf(p) === "manual")
        .map((p) => p.platform),
    };
  },
});
