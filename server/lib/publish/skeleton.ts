/**
 * 未接入平台的通用骨架: 显式 not_implemented, 绝不假装成功。
 *
 * 每个无开放 API 平台的 adapter 只有 ~30 行: 声明平台事实 (是否有开放 API、
 * 浏览器自动化脚本状态), publish() 一律 throw PublishNotSupportedError,
 * 让上层把「该平台暂不支持自动发布」如实带给用户。
 */

import {
  PublishNotSupportedError,
  type PublishContent,
  type PublishOptions,
  type PublishResult,
  type Publisher,
  type PublisherCapabilities,
  type PublishPlatform,
} from "./index.js";

export interface SkeletonPlatformFacts {
  /** 平台是否存在官方内容发布开放 API (事实陈述, 与是否接入无关). */
  officialApiExists: boolean;
  /**
   * 浏览器自动化通道状态: 仓库 .agents/shared/scripts/ 里有实验脚本但未
   * 产品化 (依赖本机 playwright 登录态), 当前不可作为可靠发布通道.
   */
  browserScriptAvailable: boolean;
}

export function notImplementedPublisher(
  platform: PublishPlatform,
  facts: SkeletonPlatformFacts,
): Publisher {
  // 平台标签由 index.ts 的 summarize 层补全 (那里持有 PLATFORM_LABELS);
  // 本模块不 import index 的运行时导出, 避免 dev HMR 下的循环 import 时序问题。
  const apiNote = facts.officialApiExists
    ? "平台有官方开放 API, 尚未申请/接入"
    : "平台无公开的内容发布 API";
  const note = `${apiNote}; 仓库内浏览器自动化脚本 (${facts.browserScriptAvailable ? "有" : "无"}) 属实验性质且依赖本机登录态, 未产品化。暂不支持自动发布。`;

  const capabilities: PublisherCapabilities = {
    autoPublish: false,
    browserAutomation: false,
    apiScheduling: false,
    media: false,
    note,
    authRequired: false,
    howToConnect: facts.officialApiExists
      ? "该平台有官方开放 API，但尚未申请接入。需要在平台开放平台后台申请开发者资质并获取凭据后，到设置页的 API keys 中配置。"
      : "该平台无公开的内容发布 API，暂不支持自动发布通道。可先用 platform-adapt 技能产出适配稿，手动发布。",
  };

  return {
    platform,
    description: `平台 ${platform}: ${note}`,
    capabilities: () => ({ ...capabilities }),
    async publish(_content: PublishContent, _options: PublishOptions): Promise<PublishResult> {
      throw new PublishNotSupportedError(
        platform,
        `平台 ${platform} 暂不支持自动发布 — ${note}`,
      );
    },
  };
}
