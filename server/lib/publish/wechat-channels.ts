import { makeAssistedPublisher } from "./assisted.js";

/**
 * 视频号: 微信视频号助手 API 未对外开放 (发布仅在微信内/助手网页)
 * → 辅助发布 (assisted)。
 */
export const wechatChannelsPublisher = makeAssistedPublisher("wechat-channels", {
  label: "视频号",
  webEntry: "https://channels.weixin.qq.com/platform/post/create",
  mediaTypes: ["video"],
  tagStyle: "hash",
  titleLimit: 0, // 视频号是描述文案, 无独立标题字段
  bodyLimit: 1000,
  requiresMedia: true,
  howToConnect:
    "微信视频号助手 API 未对外开放, 视频发布仅能在视频号助手网页端或微信内完成。平台支持辅助发布: 队列到点生成描述/话题复制包并提醒上传视频文件, 打开助手网页粘贴完成发布。",
  note: "视频号助手 API 未对外开放, 已接入辅助发布 — 队列到点产出描述/话题复制包 + 助手网页入口, 人工粘贴并上传视频完成。",
});
