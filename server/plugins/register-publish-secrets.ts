/**
 * 发布凭据注册 — 通过框架 secrets 能力声明各平台凭据，
 * 自动出现在 sidebar settings UI 中。不硬编码任何值。
 *
 * 第一梯队（已接入 API）：公众号、B站、微博
 * 其余平台暂无凭据注册，保持 not_implemented。
 */
import { defineNitroPlugin } from "@agent-native/core/server";
import { registerRequiredSecret } from "@agent-native/core/secrets";

export default defineNitroPlugin(() => {
  // ── 公众号 ──────────────────────────────────────────────
  registerRequiredSecret({
    key: "WECHAT_OA_APP_ID",
    label: "公众号 AppID",
    description: "微信公众平台的 AppID，用于 API 自动发布（草稿/发布接口）。",
    docsUrl: "https://mp.weixin.qq.com/",
    scope: "user",
    kind: "api-key",
    required: false,
  });
  registerRequiredSecret({
    key: "WECHAT_OA_APP_SECRET",
    label: "公众号 AppSecret",
    description: "微信公众平台的 AppSecret，与 AppID 配对使用。",
    docsUrl: "https://mp.weixin.qq.com/",
    scope: "user",
    kind: "api-key",
    required: false,
  });

  // ── B站 ────────────────────────────────────────────────
  registerRequiredSecret({
    key: "BILI_SESSDATA",
    label: "B站 SESSDATA Cookie",
    description: "B站登录态 Cookie SESSDATA，用于专栏草稿 API。",
    docsUrl: "https://passport.bilibili.com/",
    scope: "user",
    kind: "api-key",
    required: false,
  });
  registerRequiredSecret({
    key: "BILI_BILI_JCT",
    label: "B站 bili_jct CSRF Token",
    description: "B站登录态 Cookie bili_jct（CSRF Token），用于提交 POST 请求。",
    docsUrl: "https://passport.bilibili.com/",
    scope: "user",
    kind: "api-key",
    required: false,
  });
  registerRequiredSecret({
    key: "BILI_DEDEUSERID",
    label: "B站 DedeUserID",
    description: "B站登录用户 ID（DedeUserID Cookie），用于标识账号。",
    docsUrl: "https://passport.bilibili.com/",
    scope: "user",
    kind: "api-key",
    required: false,
  });

  // ── 微博 ────────────────────────────────────────────────
  registerRequiredSecret({
    key: "WEIBO_ACCESS_TOKEN",
    label: "微博 Access Token",
    description: "微博开放平台 OAuth2 Access Token，用于 statuses/update API。",
    docsUrl: "https://open.weibo.com/",
    scope: "user",
    kind: "api-key",
    required: false,
  });
});
