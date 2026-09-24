import { makeAssistedPublisher } from "./assisted.js";

/**
 * 知乎: 开放平台仅数据接口 (无内容发布 API); 文章/回答仅站内编辑器
 * → 辅助发布 (assisted)。
 */
export const zhihuPublisher = makeAssistedPublisher("zhihu", {
  label: "知乎",
  webEntry: "https://zhuanlan.zhihu.com/write",
  mediaTypes: ["text", "image"],
  tagStyle: "hash",
  titleLimit: 100,
  bodyLimit: 0, // 知乎文章无硬性字数上限
  requiresMedia: false,
  howToConnect:
    "知乎开放平台仅开放数据接口, 文章发布无公开 API。平台支持辅助发布: 队列到点生成标题/正文/话题复制包, 打开知乎专栏创作页粘贴即可完成发布。",
  note: "知乎无公开的内容发布 API (开放平台仅数据接口), 已接入辅助发布 — 队列到点产出复制包 + 专栏创作页入口, 人工粘贴完成。",
});
