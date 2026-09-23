import { notImplementedPublisher } from "./skeleton.js";

/** B站: biliup/bilibili API 需登录态 cookie, 未接入; not_implemented 骨架. */
export const bilibiliPublisher = notImplementedPublisher("bilibili", {
  officialApiExists: true,
  browserScriptAvailable: true,
});
