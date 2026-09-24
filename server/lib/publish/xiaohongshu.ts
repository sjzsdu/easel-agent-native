import { makeAssistedPublisher } from "./assisted.js";

/**
 * 小红书: 开放平台 (open.xiaohongshu.com) 面向电商域, 无笔记内容发布 API;
 * 创作中心仅网页端 → 辅助发布 (assisted)。
 */
export const xiaohongshuPublisher = makeAssistedPublisher("xiaohongshu", {
  label: "小红书",
  webEntry: "https://creator.xiaohongshu.com/publish/publish",
  mediaTypes: ["image", "text"],
  tagStyle: "hash",
  titleLimit: 20,
  bodyLimit: 1000,
  requiresMedia: false,
  howToConnect:
    "小红书开放平台 (open.xiaohongshu.com) 仅开放电商域接口, 笔记发布无公开 API。平台支持辅助发布: 队列到点生成标题/正文/标签复制包, 打开创作中心网页粘贴即可完成发布。",
  note: "小红书无公开的笔记发布 API (开放平台仅电商域), 已接入辅助发布 — 队列到点产出复制包 + 创作中心入口, 人工粘贴完成。",
});
