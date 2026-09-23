import { notImplementedPublisher } from "./skeleton.js";

/**
 * 微博: 开放平台 API 存在但内容发布接口对新应用基本停发授权;
 * not_implemented 骨架.
 */
export const weiboPublisher = notImplementedPublisher("weibo", {
  officialApiExists: true,
  browserScriptAvailable: false,
});
