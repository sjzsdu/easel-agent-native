/**
 * 辅助发布 (assisted) 通用实现: 平台无内容发布 API 时的诚实通道。
 *
 * 与旧 not_implemented 骨架的区别: publish() 不再一律 throw
 * PublishNotSupportedError, 而是现场校验产物 → 从 outputs/ 组装
 * 「标题 + 正文 + 标签」复制包 → throw PublishAssistedReadyError。
 * worker 捕获后: publish_records 留 manual_assisted 记录 + 任务终态
 * succeeded (交付完成, 剩余动作是用户粘贴, 非发布失败), 绝不假装已发。
 *
 * 平台 adapter 只需提供平台事实 (入口/限制/标签习惯) — ~40 行/平台。
 */

import {
  PublishAssistedReadyError,
  PublishNotSupportedError,
  type AssistedPublishPayload,
  type PublishContent,
  type PublishOptions,
  type PublishResult,
  type Publisher,
  type PublisherCapabilities,
  type PublishPlatform,
} from "./index.js";

export interface AssistedPlatformFacts {
  /** 平台展示名 (复制包/错误文案用). */
  label: string;
  /** 网页发布/创作入口 (用户粘贴的起点). */
  webEntry: string;
  /** 支持的媒体类型 (决定「无媒体文件」时是否阻塞). */
  mediaTypes: Array<"text" | "image" | "video">;
  /** 标签格式: xhs/知乎话题用「#标签 」内联, weibo 用「#标签#」. */
  tagStyle: "hash" | "weibo";
  /** 标题上限 (超限截断; 0 = 无独立标题概念). */
  titleLimit: number;
  /** 正文上限 (超限截断并在包内注明; 0 = 不限制). */
  bodyLimit: number;
  /** 需要媒体文件才可发布 (视频平台 true). */
  requiresMedia: boolean;
  /** 开通/自动发布引导 (能力声明 howToConnect 用). */
  howToConnect: string;
  /** note 文案 (能力声明, 如实说明现状). */
  note: string;
}

/** 把正文裁到上限并标注 (截断一定显式可见, 不静默吞内容). */
function fitBody(text: string, limit: number): string {
  if (limit <= 0 || text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[超出平台 ${limit} 字上限, 已截断 — 请核对后补全]`;
}

/** 归一化 outputs/ 相对路径 (与 worker fileExists 同规则; 任务可能带 outputs/ 前缀). */
function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^outputs\//, "").replace(/^\/+/, "");
}

export function makeAssistedPublisher(
  platform: PublishPlatform,
  facts: AssistedPlatformFacts,
): Publisher {
  const capabilities: PublisherCapabilities = {
    autoPublish: false,
    browserAutomation: false,
    apiScheduling: false,
    media: facts.mediaTypes.some((t) => t !== "text"),
    mode: "assisted",
    mediaTypes: [...facts.mediaTypes],
    webEntry: facts.webEntry,
    note: facts.note,
    authRequired: false,
    howToConnect: facts.howToConnect,
  };

  return {
    platform,
    // assisted 平台无自动发布凭据要求 — connected 恒为 false。
    credentialKeys: [],
    description: `${facts.label}: 辅助发布 (assisted) — 无内容发布 API, 队列到点产出复制包与网页入口, 用户人工粘贴完成。`,

    capabilities: () => ({ ...capabilities }),

    async publish(
      content: PublishContent,
      _options: PublishOptions,
    ): Promise<PublishResult> {
      // 现场读产物文件 (publish-queue 已校验存在, worker 执行时可能已被移动)。
      const { readOutputFile } = await import("../outputs-store.js");
      let bodyText = "";
      try {
        bodyText = readOutputFile(normalizeRelPath(content.contentPath)).content ?? "";
      } catch {
        throw new PublishNotSupportedError(
          platform,
          `产物文件读取失败: ${content.contentPath} — 请在内容库确认文件仍在`,
        );
      }

      // 视频平台无媒体文件 → 阻塞 (转为终态失败, 引导用户补视频)。
      if (facts.requiresMedia && content.mediaPaths.length === 0) {
        throw new PublishNotSupportedError(
          platform,
          `${facts.label}仅支持视频内容 — 任务未携带视频文件, 请补 mediaPaths 后重新入队`,
        );
      }

      // 文本平台正文为空 → 同样阻塞。
      if (!facts.requiresMedia && !bodyText.trim()) {
        throw new PublishNotSupportedError(
          platform,
          `正文文件为空: ${content.contentPath} — 请先在内容库补充正文`,
        );
      }

      // 组装复制包 (标题/正文/标签按平台习惯)。
      const tagText =
        facts.tagStyle === "weibo"
          ? content.tags.map((t) => `#${t}#`).join(" ")
          : content.tags.map((t) => `#${t}`).join(" ");
      const title =
        facts.titleLimit > 0
          ? content.title.slice(0, facts.titleLimit)
          : content.title;
      const body = fitBody(bodyText, facts.bodyLimit);

      const copyText = [
        facts.titleLimit > 0 ? "" : title,
        body,
        tagText,
      ]
        .filter(Boolean)
        .join("\n\n");

      const payload: AssistedPublishPayload = {
        label: facts.label,
        webEntry: facts.webEntry,
        copyText,
        title,
        tags: content.tags,
        mediaPaths: content.mediaPaths,
        message: `${facts.label}暂不支持自动发布 (无内容发布 API) — 已生成辅助发布包, 请打开 ${facts.webEntry} 粘贴完成发布`,
      };

      throw new PublishAssistedReadyError(platform, payload);
    },
  };
}
