# Easel 端到端验收结论

> 验收日期 2026-09-24 · 视角：真实用户「创作者的一天」
> 方法：脚本化端到端验收（隔离内存 PGlite + 真实落盘）+ 9494 端口 dev server
> 逐页走查（Playwright 实拍 14 个路由）+ action 冒烟双跑。
> 本文档只记录验收事实与遗留风险；部署相关见 [DEPLOY.md](DEPLOY.md)。

## 1. 验收链总览

| 检查 | 结果 |
|------|------|
| `pnpm typecheck` | ✅ Clean（exit 0） |
| `pnpm agent-native:doctor` | ✅ Clean — no findings（12 项守卫） |
| `pnpm test` | ✅ 246/246 通过（13 个测试文件），含下述 e2e-day 验收 |
| e2e-day 验收 | ✅ 7/7（`tests/integration/e2e-day.test.ts`，6.0s） |
| dev server 全路由 | ✅ 13 条 Easel 路由 + agent + settings 子路径全部 200；已删模板路由 404 |
| 残留模板页 | ✅ 清零（详见 §3） |

## 2. 「创作者的一天」逐层验收

数据落库用隔离内存 PGlite（`createTestDb`），不碰用户真实数据；落盘产物用
独立主题目录并在收尾双向确认删除。以下每层都有断言与实测证据。

### ① 发现 — ✅ 通过
- `trends` action 真跑：6 平台实时返回（实测 230 条，60s 缓存命中标注 `cache`），
  外部 API 波动时结构化降级而非抛异常（热榜 API 双源兜底）。
- 页面 `/trends` 热榜渲染正常：排名/标题/外链/「转选题」按钮/时间戳/平台过滤。

### ② 策划 — ✅ 通过
- `profile-save` 创建六维画像并自动激活 → `profile`（无 id）读回激活画像，
  preferences 红线逐字一致。
- `idea-save` → `ideas` 列表按 id 查得；`calendar-save` 关联 `ideaId` →
  `calendar` 查得且日期/关联一致。

### ③ 创作 — ✅ 通过
- `output-file-save` → 磁盘真实存在（`outputs/<主题>/article.md`）→
  `output-file` 逐字读回 → `output-manifest` 记录 produce 层进度 →
  `outputs` 内容库按主题可见。
- 媒体预览实测：PNG（3 张 2160×2880 卡片）、MP3（16.3s 配音，ffprobe 校验
  codec/时长）、MP4（1080×1440 h264+aac 7.6s，`slideshow.py` 图+BGM 合成）
  三类产物在 `/outputs` 页面全部真实加载（`naturalWidth` 2160 / HTTP 200）。
- `quality-gate` 双向：正常文案放行；含 `DATABASE_URL` 的文案 `verdict=block`。

### ④ 发布 — ✅ 通过（链路级）
- `publish-capabilities` 如实分层：api（公众号/B站/微博/抖音）、
  assisted（小红书/知乎/视频号）。
- `publish-queue`（+1h 定时）→ `publish-status` pending → `publish-cancel`
  → cancelled；测试进程无调度器，真实发布永不触发。
- `/publish` 页面：平台能力卡、队列看板、记录时间线、空状态引导齐备。
- 质检 block 硬拒入队（publish-queue 内再跑一次 quality-gate，见 action 源码
  L99-L106）。

### ⑤ 归因 — ✅ 通过
- `metrics-save`：键白名单校验、互动分计算、写后回读确认；只接受
  succeeded / manual_assisted 记录。
- `metrics-trends`：覆盖度（publishedSucceeded / withMetrics）正确计入。
- `/metrics` 页面空状态与「手动录入、平台 API 尚未回流、缺失不补零」的
  诚实提示齐备，样本量 <5 时给出警告。

## 3. 模板残留清理结论

以 AGENTS.md「屏幕只在工作流需要持久 UI 处存在」为准，逐一 grep 应用代码与
框架 dist 确认无入链后处理：

| 处理 | 对象 | 依据 |
|------|------|------|
| 删除 | `team.tsx` | `/team` 零入链（`STANDARD_APP_ROUTES.team`/`buildTeamRoute` 在已安装包内零调用）；单用户产品无需组织管理 |
| 删除 | `database.tsx` | 框架 DB 管理页，非创作工作流屏幕，且无入链 |
| 删除 | `observability.tsx` | 框架 LLM 追踪页，非创作工作流屏幕，且无入链 |
| 删除 | `extensions.*` ×4 | 框架扩展查看器家族；`ExtensionsSidebarSection` 等在已安装包内零引用，扩展列表实为 settings 内嵌渲染，不依赖这些路由 |
| 保留 | `agent.tsx` | 框架自带 legacy 别名，指向真实在用的 `/settings/agent` |
| 保留 | `_index.tsx` | 已是 Easel 语义落地页 |
| 修改 | `settings.tsx` | 移除 `team`/`teamLabel`（Organization 标签页）；`/settings/organization` 深链仍由 `settings.$.tsx` 兜底，不会 404 |
| 同步 | Header / Layout / use-navigation-state / e2e-smoke.sh | 清掉指向已删路由的死引用 |

**导航闭环修复**：新增 `app/lib/workspace-screens.ts` 作为屏幕清单唯一真源，
侧边栏与 agent 导航（`use-navigation-state`）共用。修复前 agent 侧只认
chat/settings —— 用户说「去热点页」跳不过去，agent 也感知不到用户当前所在层。

## 4. 走查发现并已就地修复的问题

1. **`/outputs` 媒体预览全部挂掉**（P1）：`listMediaFiles` 返回项目内相对路径，
   页面却拼成 `/outputs/<path>`，丢了主题目录 → img 全部 404。修复为
   `mediaUrl(topic, file)` 并逐段 URL 编码（中文主题名不编码部分代理会 400）。
2. **登录页与 `/home` 文案是框架模板**：按 AGENTS.md「plugin 配置对齐产品品牌」
   重写 `server/plugins/auth.ts` marketing 与 `home.tsx` SEO meta。
3. **测试数据残留**：清理 `probe-test` / `smoke-media-test` / `_smoke-media`。

## 5. 遗留风险清单

| # | 风险 | 影响 | 建议 |
|---|------|------|------|
| 1 | 平台**自动发布未用真实凭据端到端验证**（需 secrets 注册 + 外网），验收覆盖到入队/取消/留痕链路 | 真发成功率未知 | 有凭据环境跑一次灰度：单平台、低风险文案 |
| 2 | `/trends` 冷启动约 15s（6 平台顺序抓取），期间只有骨架屏 | 首次打开体验 | `actions/trends.ts` 并行化抓取或按平台渐进渲染 |
| 3 | 本机 ffmpeg 8.0.1 编译**未含 freetype → 无 drawtext 滤镜**：`slideshow.py --captions`、`video_ops.py text` 不可用；`slideshow.py` 的 CJK 字体自动探测在 macOS 失败，需 `--font "/System/Library/Fonts/Hiragino Sans GB.ttc"` | 带字幕视频合成不可用 | 重装含 libfreetype 的 ffmpeg；脚本侧可补 macOS 字体探测路径 |
| 4 | 登录页左侧截图仍是框架素材（`chat.webp`）+ 「FREE & OPEN SOURCE」徽标 | 品牌观感 | 换成真实工作台截图（README 已留占位） |
| 5 | 对话首屏无可见工具清单；`INITIAL_TOOL_NAMES` 32 个工具已核实全部可解析（39 个 action 中其余 7 个为删除类/doctor/run 走 deferLoading），但**视觉可读性未验收** | 新用户可发现性 | 接模型 key 后人工回归首屏与工具面板 |
| 6 | 内容库「全部 / 草稿」计数可能不一致（`total` 来自 outputs 目录，`statusCounts` 来自 SQL `content_items`，孤儿数据会拉开差距） | 轻微困惑 | outputs action 内以单一数据源派生两者 |
| 7 | i18n 目录仍保留 `observability` / `databaseTitle` 等已删页面的键（框架共享目录） | 无运行时影响 | 随框架升级自然收敛 |
| 8 | 本机多 Python（pyenv 3.12.4 / python.org 3.11 / Homebrew / WorkBuddy 3.13）导致依赖探测与进程 PATH 相关；媒体服务已改为显式解析（依赖命中最多者，`EASEL_PYTHON` 可覆盖） | 换机器部署需重新确认 | 文档已写入 README FAQ；探测结果 detail 带解释器路径便于排查 |

## 6. 可复现命令

```bash
pnpm typecheck && pnpm agent-native:doctor && pnpm test
# e2e-day 单跑
./node_modules/.bin/vitest --run tests/integration/e2e-day.test.ts
# 路由扫描（13 条）
PORT=9494 ./scripts/e2e-smoke.sh
# action 冒烟示例
pnpm action trends '{}'
pnpm action publish-capabilities '{}'
# 卡片视觉门禁（依赖 pillow + numpy，已装）
python3 .agents/skills/easel-card-design/scripts/card_audit.py audit \
  -f "outputs/<主题>/card_*.png"
```
