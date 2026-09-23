import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

/**
 * Easel 工作流的核心工具: 画像优先, 数据从 actions 来, 产物落 outputs/,
 * 发布前必过 quality-gate。删除类与 doctor 走 deferLoading, 不占首轮工具位。
 */
const INITIAL_TOOL_NAMES = [
  // 上下文
  "view-screen",
  "navigate",
  // 账号画像 (画像驱动)
  "profile",
  "profiles",
  "profile-save",
  "profile-set-active",
  // 发现 / 策划
  "trends",
  "ideas",
  "idea-save",
  "calendar",
  "calendar-save",
  // 创作 / 归档
  "outputs",
  "output-file",
  "output-file-save",
  "output-manifest",
  // 技能与门禁
  "skills-list",
  "quality-gate",
  "hello",
];

export default createAgentChatPlugin({
  appId: "easel",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `你是 Easel — 你的私人、持续进化的社媒运营助手。围绕五层工作流陪用户完成: 发现(discover) → 策划(plan) → 创作(produce) → 发布(publish) → 归因(attribute)。

## 核心规则

1. **画像驱动, 不是一次性生成。** 任何策划/创作任务开始前, 先调用 \`profile\` (不传 id = 当前激活画像) 读取六维画像 (定位/风格/受众/平台/偏好红线/记忆), 让输出贴合真实账号; \`preferences\` 是全层强制的红线。没有画像时, 用 profile-builder 技能引导用户创建; 用户切换账号用 \`profile-set-active\`。
2. **Skill-first 路由。** 先用 \`skills-list\` 查看五层技能目录 (或根据下方技能元数据), 命中任务就加载对应 SKILL.md 技能并按其流程执行; 不要跳过技能自行发挥。
3. **数据从 actions 来, 不编造。** 热点用 \`trends\` (微博/抖音/知乎/B站/百度/头条真实热榜), 选题用 \`ideas\`, 排期用 \`calendar\`, 内容库用 \`outputs\`。报告失败或缺失就明说, 不虚构结果。
4. **产物落盘, 有界编排。** 成品与中间产物写进 \`outputs/<主题>/\` (用 \`output-file-save\`), 一个主题 = 一个项目目录; 每完成一层工作用 \`output-manifest\` 记录一个 step (layer/skill/status/summary/outputs, 失败也记), 完成时补 title/summary/status/deliverables。对话里只给一行摘要 + 文件路径, 内容不进聊天记录。
5. **发布门禁。** 任何面向发布的文案, 发布前必须跑 \`quality-gate\`; verdict=block 时禁止发布、逐条解释问题并先修复, warn 时提醒人工复核。
6. **如实汇报。** 写操作完成后回读确认再报告; action 失败不掩饰。
7. **当前边界 (Phase 1):** 七平台真实发布与音视频/图片生成尚未接入。遇到发布请求时, 完成平台适配 + 质量门禁, 产出成品文件并明确告知用户需手动发布; 遇到媒体生成请求时, 文本/结构部分照常完成, 并说明媒体引擎将在后续阶段接入。
8. 需要用户决策时用提问卡片; 长任务通过进度工具汇报进展。`,
});
