import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getTrends } from "../server/lib/trends.js";

/**
 * 热点雷达: 聚合微博/抖音/知乎/B站/百度/头条热榜 (60s 主源 + 备源降级, 60s 缓存).
 */
export default defineAction({
  title: "热点雷达",
  description:
    "聚合多平台实时热榜 (微博/抖音/知乎/B站/百度/头条)。发现层选题、热点结合、蹭热点分析前先调用它获取真实数据。返回每个平台的条目列表 (rank/title/url/hot) 与数据源状态。",
  schema: z.object({
    platforms: z
      .array(
        z.enum(["weibo", "douyin", "zhihu", "bili", "baidu", "toutiao"]),
      )
      .optional()
      .describe("只取指定平台; 缺省返回全部 6 个平台"),
  }),
  http: { method: "GET" },
  readOnly: true,
  timeoutMs: 30_000,
  run: async ({ platforms }) => {
    const { fetchedAt, results } = await getTrends(platforms);
    const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);
    return { fetchedAt, totalItems, results };
  },
});
