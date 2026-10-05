/**
 * 公众号 Publisher (微信公众平台 API 接入)。
 *
 * 认证: AppID + AppSecret → access_token (2h TTL, 内存缓存)
 * 发布流程:
 *   1. 获取 access_token (GET /cgi-bin/token)
 *   2. 新建草稿 (POST /cgi-bin/draft/add) → media_id
 *   3. 发布 (POST /cgi-bin/freepublish/submit) 或仅保留草稿 (dryRun)
 *
 * 凭据经 secrets 注册: WECHAT_OA_APP_ID / WECHAT_OA_APP_SECRET
 * 绝不在日志/错误信息中输出凭据明文。
 */
import { join } from "node:path";

import {
  PublishCredentialError,
  PublishNotSupportedError,
  PublishTransientError,
  resolvePublishCredentials,
  checkPublishCredentials,
  type PublishContent,
  type PublishOptions,
  type PublishResult,
  type Publisher,
  type PublisherCapabilities,
} from "./index.js";
import { outputsDir } from "../outputs-store.js";

const WECHAT_API_BASE = "https://api.weixin.qq.com/cgi-bin";

const CREDENTIAL_KEYS = ["WECHAT_OA_APP_ID", "WECHAT_OA_APP_SECRET"] as const;

/** access_token 内存缓存 (2h TTL, 进程级). */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const url = `${WECHAT_API_BASE}/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new PublishTransientError(
      "wechat-oa",
      `获取 access_token 网络失败 (HTTP ${res.status})`,
    );
  }
  const data = await res.json() as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (data.errcode || !data.access_token) {
    throw new PublishCredentialError(
      "wechat-oa",
      [...CREDENTIAL_KEYS],
      `获取 access_token 失败: ${data.errcode ?? "?"} ${data.errmsg ?? "未知错误"}`,
    );
  }

  cachedToken = {
    value: data.access_token,
    // 提前 5 分钟过期, 避免边界问题
    expiresAt: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000,
  };
  return cachedToken.value;
}

async function addDraft(
  token: string,
  content: PublishContent,
): Promise<string> {
  const { readOutputFile } = await import("../outputs-store.js");
  const articleText = readOutputFile(content.contentPath).content ?? "";

  // 公众号文章用 HTML 格式; 这里把 Markdown 正文做最简转义
  const htmlContent = articleText
    .split("\n")
    .map((line) => (line.trim() ? `<p>${line}</p>` : ""))
    .join("");

  const body = {
    articles: [
      {
        title: content.title,
        author: "Easel",
        digest: articleText.slice(0, 120),
        content: htmlContent,
        content_source: articleText,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  };

  const res = await fetch(`${WECHAT_API_BASE}/draft/add?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new PublishTransientError(
      "wechat-oa",
      `新建草稿网络失败 (HTTP ${res.status})`,
    );
  }

  const data = await res.json() as {
    media_id?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode || !data.media_id) {
    const code = data.errcode ?? "?";
    const msg = data.errmsg ?? "未知错误";
    // 40001: access_token 无效 → 凭据问题; 其他视为瞬时
    if (code === 40001 || code === 40163) {
      throw new PublishCredentialError(
        "wechat-oa",
        [...CREDENTIAL_KEYS],
        `新建草稿失败 (errcode ${code}): ${msg}`,
      );
    }
    throw new PublishTransientError(
      "wechat-oa",
      `新建草稿失败 (errcode ${code}): ${msg}`,
    );
  }

  return data.media_id;
}

async function publishDraft(
  token: string,
  mediaId: string,
): Promise<void> {
  const res = await fetch(`${WECHAT_API_BASE}/freepublish/submit?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });

  if (!res.ok) {
    throw new PublishTransientError(
      "wechat-oa",
      `发布操作网络失败 (HTTP ${res.status})`,
    );
  }

  const data = await res.json() as {
    errcode?: number;
    errmsg?: string;
    publish_id?: string;
  };

  if (data.errcode && data.errcode !== 0) {
    const code = data.errcode;
    const msg = data.errmsg ?? "未知错误";
    if (code === 40001) {
      throw new PublishCredentialError(
        "wechat-oa",
        [...CREDENTIAL_KEYS],
        `发布失败 (errcode ${code}): ${msg}`,
      );
    }
    throw new PublishTransientError(
      "wechat-oa",
      `发布失败 (errcode ${code}): ${msg}`,
    );
  }
}

export const wechatOaPublisher: Publisher = {
  platform: "wechat-oa",
  credentialKeys: [...CREDENTIAL_KEYS],
  description: "公众号: 微信公众平台 API，凭据经 secrets 注册后可自动发布草稿与正式内容。",

  capabilities(): PublisherCapabilities {
    return {
      autoPublish: true,
      browserAutomation: false,
      apiScheduling: false,
      media: false,
      mode: "api",
      mediaTypes: ["text"],
      webEntry: "https://mp.weixin.qq.com",
      note: "公众号 API 已接入 (草稿/发布接口)。需要 AppID + AppSecret 凭据。",
      authRequired: true,
      howToConnect:
        "1. 登录微信公众平台 (mp.weixin.qq.com)，在「设置与开发 → 基本配置」获取 AppID 和 AppSecret。2. 将服务器的 IP 加入 IP 白名单。3. 到本应用的设置页 API keys 中填入 WECHAT_OA_APP_ID 和 WECHAT_OA_APP_SECRET。",
    };
  },

  async publish(
    content: PublishContent,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const creds = await resolvePublishCredentials([...CREDENTIAL_KEYS]);
    const appId = creds["WECHAT_OA_APP_ID"];
    const appSecret = creds["WECHAT_OA_APP_SECRET"];
    if (!appId || !appSecret) {
      throw new PublishCredentialError("wechat-oa", [...CREDENTIAL_KEYS]);
    }

    const token = await getAccessToken(appId, appSecret);
    const mediaId = await addDraft(token, content);

    if (options.dryRun) {
      return {
        url: undefined,
        raw: `草稿已创建 (media_id: ${mediaId})，未正式发布`,
      };
    }

    await publishDraft(token, mediaId);

    return {
      url: undefined,
      raw: `发布已提交 (media_id: ${mediaId})，公众号文章发布为异步操作，可在公众号后台查看`,
    };
  },
};
