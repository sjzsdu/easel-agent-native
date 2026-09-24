/**
 * B站 Publisher (B站专栏 API 接入)。
 *
 * 认证: Cookie (SESSDATA + bili_jct + DedeUserID)
 * 发布流程:
 *   POST /api/v0/article/add_draft → 文章草稿
 *
 * 凭据经 secrets 注册: BILI_SESSDATA / BILI_BILI_JCT / BILI_DEDEUSERID
 * 绝不在日志/错误信息中输出凭据明文。
 */
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

const BILI_API_BASE = "https://api.bilibili.com";

const CREDENTIAL_KEYS = ["BILI_SESSDATA", "BILI_BILI_JCT", "BILI_DEDEUSERID"] as const;

async function submitArticleDraft(
  sessdata: string,
  biliJct: string,
  dedeUserId: string,
  content: PublishContent,
): Promise<{ id: string; raw: string }> {
  const { readOutputFile } = await import("../outputs-store.js");
  const articleText = readOutputFile(content.contentPath).content ?? "";

  // B站专栏用 Markdown 格式提交
  const body = new URLSearchParams({
    title: content.title,
    content: articleText,
    summary: articleText.slice(0, 200),
    words: String(articleText.length),
    category: "0",
    listID: "0",
    tid: "0",
    reprint: "0",
    tags: content.tags.join(","),
    image_urls: "",
    origin_image_urls: "",
    csrf: biliJct,
  });

  const res = await fetch(`${BILI_API_BASE}/api/v0/article/add_draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `SESSDATA=${sessdata}; bili_jct=${biliJct}; DedeUserID=${dedeUserId}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new PublishTransientError(
      "bilibili",
      `B站专栏 API 网络失败 (HTTP ${res.status})`,
    );
  }

  const data = await res.json() as {
    code?: number;
    message?: string;
    data?: { id?: string };
  };

  if (data.code !== 0) {
    const code = data.code ?? -1;
    const msg = data.message ?? "未知错误";
    // -101: 未登录 → 凭据问题; -111 → CSRF 失败
    if (code === -101 || code === -111) {
      throw new PublishCredentialError(
        "bilibili",
        [...CREDENTIAL_KEYS],
        `B站专栏 API 认证失败 (code ${code}): ${msg}`,
      );
    }
    throw new PublishTransientError(
      "bilibili",
      `B站专栏草稿提交失败 (code ${code}): ${msg}`,
    );
  }

  const articleId = data.data?.id ?? "unknown";
  return {
    id: articleId,
    raw: `B站专栏草稿已创建 (id: ${articleId})`,
  };
}

export const bilibiliPublisher: Publisher = {
  platform: "bilibili",
  description: "B站: 专栏草稿 API (Cookie 认证)，凭据经 secrets 注册后可提交文章草稿。",

  capabilities(): PublisherCapabilities {
    return {
      autoPublish: true,
      browserAutomation: false,
      apiScheduling: false,
      media: false,
      note: "B站专栏 API 已接入 (草稿提交)。需要 SESSDATA + bili_jct + DedeUserID 三个 Cookie 凭据。仅支持草稿模式，正式发布需在 B站创作中心手动操作。",
      authRequired: true,
      howToConnect:
        "1. 在浏览器登录 B站 (bilibili.com)。2. 打开开发者工具 → Application → Cookies，复制 SESSDATA、bili_jct、DedeUserID 三个 Cookie 值。3. 到本应用的设置页 API keys 中分别填入 BILI_SESSDATA、BILI_BILI_JCT、BILI_DEDEUSERID。",
    };
  },

  async publish(
    content: PublishContent,
    _options: PublishOptions,
  ): Promise<PublishResult> {
    const creds = await resolvePublishCredentials([...CREDENTIAL_KEYS]);
    const sessdata = creds["BILI_SESSDATA"];
    const biliJct = creds["BILI_BILI_JCT"];
    const dedeUserId = creds["BILI_DEDEUSERID"];
    if (!sessdata || !biliJct || !dedeUserId) {
      throw new PublishCredentialError("bilibili", [...CREDENTIAL_KEYS]);
    }

    const result = await submitArticleDraft(
      sessdata,
      biliJct,
      dedeUserId,
      content,
    );

    return {
      url: result.id !== "unknown" ? `https://www.bilibili.com/read/cv${result.id}` : undefined,
      raw: result.raw,
    };
  },
};
