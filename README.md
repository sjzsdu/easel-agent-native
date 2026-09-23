# Easel — 你的私人社媒运营工作台

Easel is a local-first social-media operations workbench built on the
[Agent-Native](https://agent-native.com) framework (chat 模板骨架). One agent
chat orchestrates the whole loop: 发现 → 策划 → 创作 → 发布 → 归因.

> **Phase 1 (当前范围)**: 核心工作台 — 对话、画像、热点、选题、日历、技能库、
> 内容库、文字创作、质量门禁、Dashboard、设置。七平台真实发布与媒体生成尚未
> 接入：遇到发布请求只做平台适配 + 质量门禁 + 产出成品文件，并告知用户手动发布。

## What's inside

- **Agent chat** — 五层 system prompt（画像驱动 / skill-first 路由 / 数据从
  actions 来 / 产物落 `outputs/` / 发布前必过 `quality-gate`）+ 全部 actions
  作为工具页注册。
- **17 skills** in `.agents/skills/easel-*` covering the discover / plan /
  produce layers, with shared knowledge & scripts in `.agents/shared/`
  (热榜 API、支柱与频率基线、评分维度、render_card、TTS/ASR 等)。
- **8 screens** (`/dashboard`, `/trends`, `/ideas`, `/calendar`, `/skills`,
  `/outputs`, `/profile`, `/quality`) for durable workflow state — data in SQL,
  actions for operations, application state for navigation.
- **Real trending data** via the `trends` action (微博 / 抖音 / 知乎 / B站 /
  百度 / 头条 热榜, 60s 缓存)。

## Develop locally

```bash
pnpm install
pnpm dev
```

Guarded verification (run before calling work done):

```bash
pnpm typecheck
pnpm agent-native:doctor
pnpm test
```

Project conventions and domain rules live in `AGENTS.md`.
