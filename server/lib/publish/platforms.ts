/** 平台清单与展示名 (Phase 2)。独立模块: 不含注册表逻辑, 供 adapter 与 index 共用。 */

export type PublishPlatform =
  | "xiaohongshu"
  | "douyin"
  | "bilibili"
  | "weibo"
  | "zhihu"
  | "wechat-oa"
  | "wechat-channels";

/** 平台展示名 (与 quality-rules / 日历平台键保持一致). */
export const PLATFORM_LABELS: Record<PublishPlatform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  "wechat-oa": "公众号",
  "wechat-channels": "视频号",
};

export const PUBLISH_PLATFORMS = Object.keys(PLATFORM_LABELS) as PublishPlatform[];

export function isPublishPlatform(value: string): value is PublishPlatform {
  return (PUBLISH_PLATFORMS as string[]).includes(value);
}
