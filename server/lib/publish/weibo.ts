/**
 * 微博 Publisher (微博开放平台 OAuth2 API 接入)。
 *
 * 认证: OAuth2 Access Token
 * 发布流程:
 *   POST /2/statuses/update.json → 发布文字动态
 *   POST /2/statuses/upload_url_text.json → 带图发布
 *
 * 凭据经 secrets 注册: WEIBO_ACCESS_TOKEN
 * 绝不在日志/错误信息中输出凭据明文。
 */
import { join } from "node:path";

import { existsSync } from "node:fs";

import {
  PublishCredentialError,
  PublishNotSupportedError,
  PublishTransientError,
  resolvePublishCredentials,
  type PublishContent,
  type PublishOptions,
  type PublishResult,
  type Publisher,
  type PublisherCapabilities,
} from "./index.js";
import { outputsDir } from "../outputs-store.js";

const WEIBO_API_BASE = "https://api.weibo.com/2";

const CREDENTIAL_KEYS = ["WEIBO_ACCESS_TOKEN"] as const;

async function postStatus(
  accessToken: string,
  content: PublishContent,
  hasMedia: boolean,
): Promise<{ id: string; url: string; raw: string }> {
  const { readOutputFile } = await import("../outputs-store.js");
  const articleText = readOutputFile(content.contentPath).content ?? "";

  // 微博正文限制 140 字（普通接口）；超长截断
  const status =
    articleText.length > 140
      ? `${articleText.slice(0, 137)}...`
      : articleText;

  const body = new URLSearchParams({
    access_token: accessToken,
    status,
  });

  // 带图发布用 upload_url_text 接口
  const endpoint = hasMedia
    ? `${WEIBO_API_BASE}/statuses/upload_url_text.json`
    : `${WEIBO_API_BASE}/statuses/update.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new PublishTransientError(
      "weibo",
      `微博 API 网络失败 (HTTP ${res.status})`,
    );
  }

  const data = await res.json() as {
    id?: number;
    idstr?: string;
    text?: string;
    error?: string;
    error_code?: number;
  };

  // 微博 API 错误格式: { error: "...", error_code: 213XX }
  if (data.error) {
    const code = data.error_code ?? -1;
    const msg = data.error;
    // 21327: token 过期 → 凭据问题
    if (code === 21327 || code === 21332 || code === 21314) {
      throw new PublishCredentialError(
        "weibo",
        [...CREDENTIAL_KEYS],
        `微博 API 认证失败 (code ${code}): ${msg}`,
      );
    }
    throw new PublishTransientError(
      "weibo",
      `微博发布失败 (code ${code}): ${msg}`,
    );
  }

  const postId = data.idstr ?? String(data.id ?? "");
  return {
    id: postId,
    url: postId ? `https://weibo.com/${postId}` : "",
    raw: `微博已发布 (id: ${postId})`,
  };
}

export const weiboPublisher: Publisher = {
  platform: "weibo",
  description: "微博: 开放平台 OAuth2 API，凭据经 secrets 注册后可发布文字动态。",

  capabilities(): PublisherCapabilities {
    return {
      autoPublish: true,
      browserAutomation: false,
      apiScheduling: false,
      media: false,
      note: "微博 API 已接入 (statuses/update)。需要 OAuth2 Access Token。仅支持纯文字发布，图片上传需在开放平台额外申请权限。",
      authRequired: true,
      howToConnect:
        "1. 登录微博开放平台 (open.weibo.com)，创建应用并审核通过。2. 在应用管理中获取 Access Token。3. 到本应用的设置页 API keys 中填入 WEIBO_ACCESS_TOKEN。注意: 微博对新应用的内容发布授权审核较严，需确保应用已获得相关权限。",
    };
  },

  async publish(
    content: PublishContent,
    _options: PublishOptions,
  ): Promise<PublishResult> {
    const creds = await resolvePublishCredentials([...CREDENTIAL_KEYS]);
    const accessToken = creds["WEIBO_ACCESS_TOKEN"];
    if (!accessToken) {
      throw new PublishCredentialError("weibo", [...CREDENTIAL_KEYS]);
    }

    const hasMedia = content.mediaPaths.length > 0;
    const result = await postStatus(accessToken, content, hasMedia);

    return {
      url: result.url || undefined,
      raw: result.raw,
    };
  },
};
