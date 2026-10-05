/**
 * 平台发布 adapter (Phase 2)。
 *
 * 统一 Publisher 契约: 每个平台一个 Publisher, 显式声明能力
 * (API 自动发布 / 浏览器自动化 / 定时 / 媒体)。上层 (publish-queue action
 * 与 publish-worker 调度器) 只依赖本目录导出的 `resolvePublisher` /
 * `listPublishers`, 绝不直接 import 具体平台。
 *
 * 铁律:
 * - 接入优先级: 官方开放平台 API 优先; 无内容发布 API 的平台走
 *   `assisted` 辅助发布 (产出复制包 + 网页入口, 用户人工粘贴完成),
 *   publish() 在需要人工完成时 throw PublishAssistedReadyError,
 *   由 worker 留 manual_assisted 记录 — 绝不假装已发成功。
 * - 凭据经 secrets (resolveCredential) 注册, 不读死值、不进 SQL/env。
 * - 媒体一律以 outputs/ 相对路径引用, 由 worker 读取, 不内联。
 */

import { resolveCredential } from "@agent-native/core/credentials";

import {
  PUBLISH_PLATFORMS,
  PLATFORM_LABELS,
  type PublishPlatform,
} from "./platforms.js";

export {
  PUBLISH_PLATFORMS,
  PLATFORM_LABELS,
  isPublishPlatform,
  type PublishPlatform,
} from "./platforms.js";

/** 发布内容载荷 — 正文与媒体全部以 outputs/ 相对路径引用. */
export interface PublishContent {
  topic: string;
  title: string;
  /** 相对 outputs/ 的正文文件路径. */
  contentPath: string;
  /** 相对 outputs/ 的媒体文件路径列表 (图片/视频). */
  mediaPaths: string[];
  /** 平台适配后的标签 (hashtag, 无 # 前缀). */
  tags: string[];
}

export interface PublishOptions {
  /** 目标账号标识 (多账号时区分; 单用户默认一个). */
  account?: string;
  /** 草稿模式: 内容进入平台草稿箱而不直接发出 (平台支持时). */
  dryRun?: boolean;
}

export interface PublishResult {
  url?: string;
  /** 平台原始响应的短摘要 (截断到 ~500 字, 只留可读信息, 不留凭证). */
  raw: string;
}

export interface Publisher {
  /** 平台键, 与 PublishPlatform 一致. */
  readonly platform: PublishPlatform;

  /**
   * 自动发布所需凭据键 (API 模式平台; assisted/manual 平台为空数组).
   * summarizePublishers 用它做真实存在性检查, 得出 connected 状态。
   */
  readonly credentialKeys: readonly string[];
  /** 人类可读的接入说明 (失败/未接入时向用户展示). */
  readonly description: string;
  /** 声明能力, 永不虚报. */
  capabilities(): PublisherCapabilities;
  /**
   * 执行发布。未接入 / 凭据缺失 / 依赖缺失时 throw `PublishNotSupportedError`
   * 或 `PublishTransientError`, 绝不静默成功。
   */
  publish(content: PublishContent, options: PublishOptions): Promise<PublishResult>;
}

/**
 * 接入模式 (能力声明的核心字段):
 * - api      : 官方开放平台 API, 凭据齐备即可全自动发布 (autoPublish=true)
 * - assisted : 辅助发布 — 无内容发布 API, 队列到点产出「一键复制包 + 网页
 *              发布入口」, 用户人工粘贴完成; publish_records 记 manual_assisted
 * - manual   : 仅人工发布, 应用不做任何自动化准备
 */
export type PublishMode = "api" | "assisted" | "manual";

/** 平台支持的媒体类型 (能力声明用, publish-capabilities 原样透出). */
export type PublishMediaType = "text" | "image" | "video";

export interface PublisherCapabilities {
  /** 平台是否支持自动发布通道 (静态能力声明, 与凭据是否已配置无关). */
  autoPublish: boolean;
  /** 是否支持浏览器自动化通道. */
  browserAutomation: boolean;
  /** 是否支持 API 级定时 (队列定时由应用侧保证, 与此无关). */
  apiScheduling: boolean;
  /** 是否支持携带媒体文件. */
  media: boolean;
  /** 接入模式 (缺省视为 manual — 历史 not_implemented 骨架未标注时). */
  mode?: PublishMode;
  /** 支持的媒体类型 (assisted/api 平台应给出). */
  mediaTypes?: PublishMediaType[];
  /** 平台网页发布/创作入口 (assisted/manual 平台的用户操作起点). */
  webEntry?: string;
  /** 未接入原因 / 接入通道说明. */
  note: string;
  /** 平台是否要求凭据 (静态声明; 凭据是否真的已配置见 PublisherSummary.connected). */
  authRequired: boolean;
  /** 引导文案: 告诉用户怎么开通此平台的自动发布. */
  howToConnect: string;
}

/**
 * 平台不支持自动发布 (未接入 / 无 API / 能力不符) — 永久性, 重试无意义.
 */
export class PublishNotSupportedError extends Error {
  readonly platform: PublishPlatform;
  constructor(platform: PublishPlatform, message: string) {
    super(message);
    this.name = "PublishNotSupportedError";
    this.platform = platform;
  }
}

/**
 * 可重试的瞬时失败 (网络抖动、平台限流) — 调度器按退避重试.
 */
export class PublishTransientError extends Error {
  readonly platform: PublishPlatform;
  constructor(platform: PublishPlatform, message: string) {
    super(message);
    this.name = "PublishTransientError";
    this.platform = platform;
  }
}

/**
 * 辅助发布就绪: publisher 已完成它该做的准备 (校验内容/生成复制包),
 * 剩余步骤需要用户在平台网页端人工完成。携带结构化 payload,
 * worker 据此留 manual_assisted 记录并原样透传给 UI。
 */
export class PublishAssistedReadyError extends Error {
  readonly platform: PublishPlatform;
  readonly payload: AssistedPublishPayload;
  constructor(platform: PublishPlatform, payload: AssistedPublishPayload) {
    super(payload.message);
    this.name = "PublishAssistedReadyError";
    this.platform = platform;
    this.payload = payload;
  }
}

/**
 * 辅助发布包: 从 outputs/ 产物文件现场组装, 供 UI 一键复制与
 * 用户在平台网页端粘贴。只含文本, 不含媒体文件本体。
 */
export interface AssistedPublishPayload {
  /** 平台展示名 (小红书/知乎/视频号). */
  label: string;
  /** 网页发布入口 URL. */
  webEntry: string;
  /** 复制包正文 (含标签), UI 一键复制用. */
  copyText: string;
  /** 标题 (单独复制用; 小红书 ≤20 字, 知乎文章长标题). */
  title: string;
  /** 平台标签 (带 # 或不带, 按平台习惯). */
  tags: string[];
  /** 媒体文件相对 outputs/ 路径 (用户需手动上传). */
  mediaPaths: string[];
  /** 人类可读的操作说明. */
  message: string;
}

/** 凭据缺失 — 提示用户到设置页/secrets 注册, 重试无意义. */
export class PublishCredentialError extends Error {
  readonly platform: PublishPlatform;
  readonly credentialKeys: string[];
  constructor(platform: PublishPlatform, credentialKeys: string[], message?: string) {
    super(
      message ??
        `平台 ${PLATFORM_LABELS[platform]} 缺少发布凭据 (${credentialKeys.join(", ")}) — 请先在设置页的 secrets 中注册对应密钥`,
    );
    this.name = "PublishCredentialError";
    this.platform = platform;
    this.credentialKeys = credentialKeys;
  }
}

/** 把任意错误归类为 not_supported / assisted_ready / transient / credential / unknown. */
export function classifyPublishError(
  error: unknown,
): "not_supported" | "assisted_ready" | "transient" | "credential" | "unknown" {
  if (error instanceof PublishNotSupportedError) return "not_supported";
  if (error instanceof PublishAssistedReadyError) return "assisted_ready";
  if (error instanceof PublishTransientError) return "transient";
  if (error instanceof PublishCredentialError) return "credential";
  return "unknown";
}

/**
 * 单用户工作台的凭据上下文: 没有请求上下文时用固定占位邮箱读
 * user-scoped secrets。多租户接入时这里必须改为真实请求身份。
 */
export async function resolvePublishCredential(
  key: string,
  ctx?: { userEmail?: string; orgId?: string | null },
): Promise<string | undefined> {
  return resolveCredential(key, {
    userEmail: ctx?.userEmail ?? "easel@local",
    orgId: ctx?.orgId ?? null,
  });
}

/**
 * 批量解析凭据: 返回 { key, value } 映射。缺失的 key 对应 value=undefined。
 * 调用方自行检查缺失并 throw PublishCredentialError。
 */
export async function resolvePublishCredentials(
  keys: string[],
  ctx?: { userEmail?: string; orgId?: string | null },
): Promise<Record<string, string | undefined>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await resolvePublishCredential(key, ctx)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * 检查凭据是否已设置（不返回值，只返回存在状态），用于 capabilities 声明。
 */
export async function checkPublishCredentials(
  keys: string[],
  ctx?: { userEmail?: string; orgId?: string | null },
): Promise<boolean> {
  const resolved = await resolvePublishCredentials(keys, ctx);
  return keys.every((key) => resolved[key] != null && resolved[key] !== "");
}

import { bilibiliPublisher } from "./bilibili.js";
import { douyinPublisher } from "./douyin.js";
import { wechatChannelsPublisher } from "./wechat-channels.js";
import { wechatOaPublisher } from "./wechat-oa.js";
import { weiboPublisher } from "./weibo.js";
import { xiaohongshuPublisher } from "./xiaohongshu.js";
import { zhihuPublisher } from "./zhihu.js";

const REGISTRY: Record<PublishPlatform, Publisher> = {
  xiaohongshu: xiaohongshuPublisher,
  douyin: douyinPublisher,
  bilibili: bilibiliPublisher,
  weibo: weiboPublisher,
  zhihu: zhihuPublisher,
  "wechat-oa": wechatOaPublisher,
  "wechat-channels": wechatChannelsPublisher,
};

export function resolvePublisher(platform: PublishPlatform): Publisher {
  return REGISTRY[platform];
}

export function listPublishers(): Publisher[] {
  return PUBLISH_PLATFORMS.map((platform) => REGISTRY[platform]);
}

export interface PublisherSummary {
  platform: PublishPlatform;
  label: string;
  description: string;
  capabilities: PublisherCapabilities;
  /**
   * 自动发布凭据是否真实存在 (逐键查 secrets, 非能力声明)。
   * assisted/manual 平台无凭据要求, 恒为 false — 它们本就不是 API 接入。
   * 设置页「发布账号」的连接徽标以本字段为准。
   */
  connected: boolean;
}

export async function summarizePublishers(): Promise<PublisherSummary[]> {
  return Promise.all(
    listPublishers().map(async (publisher) => ({
      platform: publisher.platform,
      label: PLATFORM_LABELS[publisher.platform],
      // 骨架 description 以「平台 <key>:」开头 — 换成人读的平台名。
      description: publisher.description.replace(
        /^平台 [a-z-]+/,
        PLATFORM_LABELS[publisher.platform],
      ),
      capabilities: publisher.capabilities(),
      // 无凭据要求的平台 (assisted/manual) 恒为 false — 它们不是 API 接入,
      // 不因「没有需要检查的键」而视作已连接。
      connected:
        publisher.credentialKeys.length > 0 &&
        (await checkPublishCredentials([...publisher.credentialKeys])),
    })),
  );
}
