import { notImplementedPublisher } from "./skeleton.js";

/**
 * 公众号: 微信公众平台有「新建草稿/发布」API (需要 AppID/AppSecret 白名单
 * IP)。凭据经 secrets 注册后即可接入真实通道; 当前尚未接入 — not_implemented
 * 骨架, 平台事实已按官方 API 存在记录。
 */
export const wechatOaPublisher = notImplementedPublisher("wechat-oa", {
  officialApiExists: true,
  browserScriptAvailable: true,
});
