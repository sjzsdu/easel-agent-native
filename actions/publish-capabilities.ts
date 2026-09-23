import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  PLATFORM_LABELS,
  summarizePublishers,
} from "../server/lib/publish/index.js";

/** 七平台自动发布能力声明 (真实状态, 不虚报)。 */
export default defineAction({
  title: "查询平台发布能力",
  description:
    "返回七平台 (小红书/抖音/B站/微博/知乎/公众号/视频号) 的自动发布能力声明: 哪些已接入 API、哪些暂不支持 (not_implemented) 及原因。安排发布计划、回答「能不能自动发」之前先调用, 如实告知用户。",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const publishers = summarizePublishers();
    return {
      platforms: publishers,
      labels: PLATFORM_LABELS,
      autoPublishReady: publishers
        .filter((p) => p.capabilities.autoPublish)
        .map((p) => p.platform),
      notImplemented: publishers
        .filter((p) => !p.capabilities.autoPublish)
        .map((p) => p.platform),
    };
  },
});
