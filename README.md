# Easel — 你的私人社媒运营工作台

Easel is a local-first social-media operations workbench built on the
[Agent-Native](https://agent-native.com) framework (chat 模板骨架). One agent
chat orchestrates the whole loop: 发现 → 策划 → 创作 → 发布 → 归因.

> **Phase 2 (当前范围)**: 核心工作台 + 发布链路 — 对话、画像、热点、选题、日历、技能库、
> 内容库、文字创作、质量门禁、发布队列 (/publish)、Dashboard、设置。发布走
> `publish-queue`：过 `quality-gate` 后入队，调度器到点执行，成功留痕并自动回写内容库/日历状态；
> 暂未接入官方发布 API 的平台如实标注 not_implemented 并给出人工发布路径。

## What's inside

- **Agent chat** — 五层 system prompt（画像驱动 / skill-first 路由 / 数据从
  actions 来 / 产物落 `outputs/` / 发布前必过 `quality-gate`）+ 全部 actions
  作为工具页注册。
- **17 skills** in `.agents/skills/easel-*` covering the discover / plan /
  produce / publish layers, with shared knowledge & scripts in `.agents/shared/`
  (热榜 API、支柱与频率基线、评分维度、render_card、TTS/ASR 等)。
- **Publish pipeline (Phase 2)** — `publish-queue` 入队 (质量门禁硬约束) →
  进程内调度器到点执行 (退避重试) → `publish-records` 留痕 + 内容库/日历状态回写；
  `/publish` 页面提供队列看板、记录时间线与取消/重试。平台能力如实声明，
  未接入的平台不假装发布成功。
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
