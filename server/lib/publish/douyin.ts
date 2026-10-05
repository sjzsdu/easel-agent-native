/**
 * 抖音 Publisher (抖音开放平台视频发布 API 接入)。
 *
 * 官方通道: https://developer.open-douyin.com — video.create.bind 权限包
 * 认证: OAuth2 (access_token 有效期 ~15 天, refresh_token ~30 天, 经 secrets 提供换好的 token)
 * 发布流程:
 *   1. 分片上传视频 (POST /open/api/video/upload_video/, header access-token)
 *      → 返回 video.video_id
 *   2. 创建发布 (POST /open/api/video/create_video/, query open_id,
 *      body video_id + text) → 返回 item_id
 *
 * 凭据经 secrets 注册: DOUYIN_ACCESS_TOKEN / DOUYIN_OPEN_ID
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

export const douyinPublisher: Publisher = {
  platform: "douyin",
  credentialKeys: [...CREDENTIAL_KEYS],
  description: "抖音: 开放平台视频发布 API (OAuth + 视频直传)，凭据经 secrets 注册后可自动发布。",

  capabilities(): PublisherCapabilities {
    return {
      autoPublish: true,
      browserAutomation: false,
      apiScheduling: false,
      media: true,
      mode: "api",
      mediaTypes: ["video"],
      note: "抖音开放平台视频发布 API 已接入 (upload_video → create_video)。需要 OAuth access_token + open_id 凭据; 仅支持视频内容, 需应用申请 video.create 权限包。",
      authRequired: true,
      howToConnect:
        "1. 到抖音开放平台 (developer.open-douyin.com) 创建应用, 完成「视频发布与管理」(video.create.bind) 权限申请。2. 完成用户 OAuth 授权后获取 access_token (有效期约 15 天, 注意到期前用 refresh_token 换新) 与授权用户的 open_id。3. 到本应用的设置页 API keys 中填入 DOUYIN_ACCESS_TOKEN 和 DOUYIN_OPEN_ID。",
      webEntry: "https://creator.douyin.com/creator-micro/content/upload",
    };
  },

  async publish(content, _options: PublishOptions): Promise<PublishResult> {
    const creds = await resolvePublishCredentials([...CREDENTIAL_KEYS]);
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
