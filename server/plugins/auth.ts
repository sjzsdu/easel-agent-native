import { createAuthPlugin } from "@agent-native/core/server";

const rawAppTitle = "Easel";
const appTitle = rawAppTitle === "{" + "{APP_TITLE}}" ? "Chat" : rawAppTitle;

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  // "/" 归 Easel 自己的落地页 (_index.tsx, marketing surface) — 不让框架的
  // marketing 登录文档接管根路径; 签录页 (/sign-in) 仍用下面的 marketing 文案。
  rootAuth: false,
  marketing: {
    appName: appTitle,
    // 截图仍是框架模板的 chat.webp, 换成真实工作台截图前先占位 (见 docs/ACCEPTANCE.md)
    screenshotPath: "/auth-marketing/chat.webp",
    screenshotWidth: 914,
    screenshotHeight: 818,
    tagline: "从热点发现到内容归因，把社媒运营的五步流程收进一个工作台。",
    features: [
      "Agent 对话驱动：发现 → 策划 → 创作 → 发布 → 归因，全程在侧边栏完成",
      "多平台热点雷达、选题库与内容日历，数据落在本地，随时可查",
      "产物归档到内容库，发布前必过质量门禁，发布留痕可复盘",
    ],
  },
});
