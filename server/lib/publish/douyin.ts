/**
 * 抖音 Publisher — 双通道:
 *
 * 1. sau (主通道, 个人创作者): social-auto-upload CLI, 浏览器自动化 +
 *    账号 cookie, 不需要开放平台资质。凭据: SAU_DOUYIN_ACCOUNT
 *    (可选 SAU_EXECUTABLE), 见 ./sau.ts。
 * 2. 开放平台 API (备用, 需企业资质 + video.create.bind 权限包):
 *    DOUYIN_ACCESS_TOKEN / DOUYIN_OPEN_ID。
 *
 * 配置了 SAU_DOUYIN_ACCOUNT 走 sau; 否则回落开放平台 API (凭据缺失时
 * 如实报 PublishCredentialError)。
 * 绝不在日志/错误信息中输出凭据明文。
 */
import { createReadStream } from "node:fs";
import { statSync } from "node:fs";
import { extname } from "node:path";

import {
  PublishCredentialError,
  PublishTransientError,
  resolvePublishCredentials,
  type PublishContent,
  type PublishOptions,
  type PublishResult,
  type Publisher,
  type PublisherCapabilities,
} from "./index.js";
import { resolveSauConfig, runSauDouyinUpload, type SauConfig } from "./sau.js";

const DOUYIN_API_BASE = "https://open.douyin.com";

const CREDENTIAL_KEYS = ["DOUYIN_ACCESS_TOKEN", "DOUYIN_OPEN_ID"] as const;

/** 平台对视频格式的事实约束 (来自开放平台文档, 用于执行前快速失败). */
const SUPPORTED_VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 文档上限 4GB

/** 读取 outputs/ 相对路径文件 (与其他 publisher 相同的延迟 import 模式). */
async function readVideoPath(relPath: string): Promise<string> {
  const { outputsDir } = await import("../outputs-store.js");
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new PublishTransientError("douyin", `非法媒体路径: ${relPath}`);
  }
  return `${outputsDir()}/${normalized}`;
}

/**
 * 分片/单请求上传视频文件, 返回 video_id。
 * 单请求直传 (<64MB 时更简单); 更大文件开放平台支持分片, 这里走单请求
 * 并在超限时明确报错 — 个人量级视频几乎不会触达。
 */
async function uploadVideo(
  accessToken: string,
  videoAbsPath: string,
): Promise<string> {
  const stat = statSync(videoAbsPath, { throwIfNoEntry: false });
  if (!stat) {
    throw new PublishTransientError("douyin", `视频文件不存在: ${videoAbsPath}`);
  }
  if (stat.size > MAX_VIDEO_BYTES) {
    throw new PublishTransientError(
      "douyin",
      `视频超过平台 4GB 上限 (${Math.round(stat.size / 1024 / 1024)}MB), 未上传`,
    );
  }

  const form = new FormData();
  form.append(
    "video",
    new Blob([createReadStream(videoAbsPath) as unknown as BlobPart]),
    videoAbsPath.split("/").pop() ?? "video.mp4",
  );

  const res = await fetch(`${DOUYIN_API_BASE}/open/api/video/upload_video/`, {
    method: "POST",
    headers: { "access-token": accessToken },
    body: form,
  });
  if (!res.ok) {
    throw new PublishTransientError("douyin", `视频上传网络失败 (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    data?: { video?: { video_id?: string } };
    extra?: { error_code?: number; description?: string };
  };
  const errorCode = data.extra?.error_code ?? 0;
  const videoId = data.data?.video?.video_id;
  if (errorCode !== 0 || !videoId) {
    // 2190005: access_token 无效/过期 → 凭据问题
    if (errorCode === 2190005 || errorCode === 2190008) {
      throw new PublishCredentialError(
        "douyin",
        [...CREDENTIAL_KEYS],
        `视频上传认证失败 (error_code ${errorCode}): ${data.extra?.description ?? "未知错误"}`,
      );
    }
    throw new PublishTransientError(
      "douyin",
      `视频上传失败 (error_code ${errorCode}): ${data.extra?.description ?? "未知错误"}`,
    );
  }
  return videoId;
}

/** create_video 创建发布, 返回 item_id (最终可在抖音 App 内看到该视频). */
async function createVideo(
  accessToken: string,
  openId: string,
  videoId: string,
  content: PublishContent,
): Promise<{ itemId: string; raw: string }> {
  const text = [
    content.title,
    content.tags.length > 0
      ? content.tags.map((t) => `#${t}`).join(" ")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(
    `${DOUYIN_API_BASE}/open/api/video/create_video/?open_id=${encodeURIComponent(openId)}`,
    {
      method: "POST",
      headers: {
        "access-token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ video_id: videoId, text }),
    },
  );
  if (!res.ok) {
    throw new PublishTransientError("douyin", `创建发布网络失败 (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    data?: { item_id?: string; item?: { item_id?: string } };
    extra?: { error_code?: number; description?: string };
  };
  const errorCode = data.extra?.error_code ?? 0;
  const itemId = data.data?.item_id ?? data.data?.item?.item_id;
  if (errorCode !== 0 || !itemId) {
    if (errorCode === 2190005 || errorCode === 2190008) {
      throw new PublishCredentialError(
        "douyin",
        [...CREDENTIAL_KEYS],
        `创建发布认证失败 (error_code ${errorCode}): ${data.extra?.description ?? "未知错误"}`,
      );
    }
    throw new PublishTransientError(
      "douyin",
      `创建发布失败 (error_code ${errorCode}): ${data.extra?.description ?? "未知错误"}`,
    );
  }

  return {
    itemId,
    raw: `抖音视频已提交发布 (item_id: ${itemId})，视频经平台审核后出现在主页`,
  };
}

/**
 * sau 通道发布 (浏览器自动化): 组装 `sau douyin upload-video` 参数并执行,
 * 退出码/输出如实回写 publish record — 上传的成败只认 CLI 的退出结果。
 * 描述缺省用正文文件内容截断 (sau --desc 支持长文本, 但给个保护上限)。
 */
async function publishViaSau(
  content: PublishContent,
  sau: SauConfig,
): Promise<PublishResult> {
  const videoRelPath = content.mediaPaths[0];
  if (!videoRelPath) {
    throw new PublishTransientError(
      "douyin",
      "抖音发布需要视频文件 — 任务未携带 mediaPaths, 请改用视频成品后重试",
    );
  }
  const ext = extname(videoRelPath).toLowerCase();
  if (!SUPPORTED_VIDEO_EXTS.has(ext)) {
    throw new PublishTransientError(
      "douyin",
      `平台仅支持视频 (${[...SUPPORTED_VIDEO_EXTS].join("/")}), 收到 ${ext}`,
    );
  }

  const absPath = await readVideoPath(videoRelPath);
  const descSource = content.tags.length ? content.tags.join(" ") : undefined;

  const outcome = await runSauDouyinUpload(sau, {
    file: absPath,
    title: content.title || content.topic,
    desc: descSource,
  });

  if (outcome.ok) {
    return {
      url: undefined,
      raw: `sau 上传完成 (account: ${sau.douyinAccount})\n${outcome.log}`,
    };
  }

  if (outcome.kind === "not_installed") {
    throw new PublishCredentialError(
      "douyin",
      ["SAU_DOUYIN_ACCOUNT", "SAU_EXECUTABLE"],
      `sau 未安装或不可执行 — 安装 social-auto-upload 后重试 (输出: ${outcome.log || "executable not found"})`,
    );
  }
  if (outcome.kind === "not_logged_in") {
    throw new PublishCredentialError(
      "douyin",
      ["SAU_DOUYIN_ACCOUNT"],
      `sau 报告抖音账号未登录/cookie 失效 — 终端运行 \`sau douyin login\` 重新扫码后再试 (输出: ${outcome.log})`,
    );
  }
  if (outcome.kind === "timeout") {
    throw new PublishTransientError(
      "douyin",
      `sau 上传超时 (15 分钟) — 网络慢或视频过大时可重试 (输出: ${outcome.log})`,
    );
  }
  throw new PublishTransientError(
    "douyin",
    `sau 上传失败 (退出码非 0) — 输出: ${outcome.log}`,
  );
}

export const douyinPublisher: Publisher = {
  platform: "douyin",
  credentialKeys: [...CREDENTIAL_KEYS],
  description:
    "抖音: 主通道 sau (social-auto-upload 浏览器自动化 + 账号 cookie, 无需开放资质); 备用开放平台 API (OAuth + 视频直传, 需企业资质)。",

  capabilities(): PublisherCapabilities {
    return {
      autoPublish: true,
      browserAutomation: true,
      apiScheduling: false,
      media: true,
      mode: "sau",
      mediaTypes: ["video"],
      note: "个人创作者主通道: sau (social-auto-upload) 浏览器自动化, 账号 cookie 登录, 无需开放平台资质; 备用: 开放平台 API (需企业资质 + video.create.bind)。仅支持视频内容。",
      authRequired: true,
      howToConnectKey: "easel.settings.douyinGuide",
      howToConnect:
        "个人创作者 (推荐): 1. 安装 sau (github.com/dreammis/social-auto-upload, 需 Python/uv)。2. 终端运行 `sau douyin login` 扫码登录抖音账号。3. 到设置页 API keys 填入 SAU_DOUYIN_ACCOUNT (登录时的账号名); sau 不在 PATH 上时再填 SAU_EXECUTABLE。备用: 到抖音开放平台 (developer.open-douyin.com) 创建应用并申请「视频发布与管理」权限 (需企业资质), OAuth 后填入 DOUYIN_ACCESS_TOKEN 和 DOUYIN_OPEN_ID。",
      webEntry: "https://creator.douyin.com/creator-micro/content/upload",
    };
  },

  /**
   * connected = sau 通道 (SAU_DOUYIN_ACCOUNT) 或开放平台 API 凭据
   * 任一配置即可 — 两条发布路径是备选关系。
   */
  async checkConnected(ctx?): Promise<boolean> {
    const sau = await resolveSauConfig(ctx);
    if (sau.douyinAccount) return true;
    const creds = await resolvePublishCredentials([...CREDENTIAL_KEYS], ctx);
    return [...CREDENTIAL_KEYS].every((key) => {
      const value = creds[key];
      return value != null && value !== "";
    });
  },

  async publish(content, options: PublishOptions): Promise<PublishResult> {
    const sau = await resolveSauConfig(options);
    if (sau.douyinAccount) {
      return publishViaSau(content, sau);
    }

    const creds = await resolvePublishCredentials([...CREDENTIAL_KEYS], options);
    const accessToken = creds["DOUYIN_ACCESS_TOKEN"];
    const openId = creds["DOUYIN_OPEN_ID"];
    if (!accessToken || !openId) {
      throw new PublishCredentialError("douyin", [...CREDENTIAL_KEYS]);
    }

    const videoPath = content.mediaPaths[0];
    if (!videoPath) {
      throw new PublishTransientError(
        "douyin",
        "抖音发布需要视频文件 — 任务未携带 mediaPaths, 请改用视频成品后重试",
      );
    }
    const ext = extname(videoPath).toLowerCase();
    if (!SUPPORTED_VIDEO_EXTS.has(ext)) {
      throw new PublishTransientError(
        "douyin",
        `平台仅支持视频 (${[...SUPPORTED_VIDEO_EXTS].join("/")}), 收到 ${ext}`,
      );
    }

    const absPath = await readVideoPath(videoPath);
    const videoId = await uploadVideo(accessToken, absPath);
    const { itemId, raw } = await createVideo(accessToken, openId, videoId, content);

    return { url: undefined, raw: `${raw} (video_id: ${videoId})` };
  },
};
