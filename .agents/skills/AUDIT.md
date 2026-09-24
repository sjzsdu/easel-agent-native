# Easel 技能实战审计基线

> 审计日期 2026-09-24。方法：每个技能走一个真实小任务——机器可执行环节（脚本 CLI、action 调用、落盘校验）全部真跑双跑比对，LLM 侧环节按 SKILL.md 字面流程走查；无模型 key，端到端对话留待有 key 时回归。
> 修复文件共 7 个：`wordcount.py`（Python 3.9 兼容）、6 个 SKILL/references 文档。死引用终检：全部 17 技能引用可解析（EASEL-META 除外）。

| # | 技能 | 层 | 状态 | 实测摘要 | 修复项 | 遗留风险 |
|---|------|----|------|----------|--------|----------|
| 1 | easel-trending-topics | discover | 通过 | `trends` action 真跑：6 平台实时返回；枚举与 hotlist-apis 降级链路真实 | 无 | 外部热搜 API 可用性波动，已有双源降级兜底 |
| 2 | easel-topic-evaluator | plan | 通过 | 阈值（≥70/50-69/<50）与 `shared/scoring-dimensions.md` 逐字一致；纯 LLM 流程无脚本依赖 | 无 | 打分主观波动，靠统一标尺收敛，建议回归时同题双跑 |
| 3 | easel-content-calendar | plan | 通过 | `calendar_ops.py context` 真跑正常；落盘路径过 `output_paths.py` 校验 | SKILL 示例 `python`→`python3` | 写回日历底座依赖用户确认，首次运行无数据可读 |
| 4 | easel-audience-profiler | plan | 通过 | profile-save 六维写入→profile 回读→测试数据清理，全链路真跑 | 无 | audience 维度为自由文本，结构化程度依赖模型遵循度 |
| 5 | easel-competitor-analysis | discover | 通过 | 引用文件全存在；web_fetch 依赖外网，反爬降级路径已文档化 | data-collection.md 死引用 `../../shared/`→`../../../shared/` | 平台反爬导致画像数据常缺，SKILL 已要求标"无公开数据" |
| 6 | easel-content-postmortem | attribute | 通过 | `aggregate.py` 真实数据聚合/交叉/样本警告正常，双跑逐字节一致 | 无 | 模式 B 依赖用户数据 JSON 结构，畸形输入容错未测 |
| 7 | easel-hook-generator | plan | 通过 | 六公式名与 hook-formulas.md 一致；wordcount 校验链路修复后可用 | 连带修复 `wordcount.py` Python 3.9 崩溃（PEP 604 语法） | 字数硬校验依赖模型逐行喂脚本，漏喂则降级为肉眼数 |
| 8 | easel-social-copy | produce | 通过 | shared 公共源（copy-frameworks / hook-title-formulas）+ 本地 3 个 references 全存在且口径一致 | 无 | 未接 quality-gate（营销文案靠 wordcount 字数门 + deai-rewrite 门禁兜底） |
| 9 | easel-xhs-note | produce | 通过 | validate_meta（18 项校验）/normalize_slug 真跑且双跑一致；按 meta-schema 修正合成数据后通过 | 工具依赖段补 card_audit 需 numpy + 缺依赖降级说明 | 本机未装 playwright，html_card 渲染路径无法本地实跑（诚实降级 exit 3） |
| 10 | easel-card-design | produce | 通过 | card_audit 缺依赖时 exit 1 + selftest 正确失败，门禁不可绕过 | 无 | 本机无 Pillow/numpy，视觉门禁在本机不可执行，需 `pip install pillow numpy` |
| 11 | easel-video-script | produce | 通过 | wordcount check（整数 target + ±10% 容差）真跑；retention 指南引用可解析 | SKILL 的 `--target` 用法补"四舍五入取整"说明（int 参数 + 小数目标会导致模型跳过校验） | 时长↔字数换算依赖模型执行，脚本只兜底不阻断 |
| 12 | easel-long-form | produce | 通过 | quality-gate 真跑双跑一致（仅时间戳差异，判定确定）；契约 text+平台 slug 实测确认 | SKILL 补 quality-gate 平台枚举 slug 说明（传中文名会被参数校验拒绝） | 大纲搜索环节依赖 WebSearch，无 key 环境降级路径未文档化 |
| 13 | easel-deai-rewrite | produce | 通过 | 六个 references 全存在；作为权威源被 social-copy/xhs-note/long-form 引用正常 | 无 | 两道门（≥45/50、≥35/50）为纯 LLM 自评，无脚本兜底 |
| 14 | easel-profile-builder | general | 通过 | profiles/profile-save/profile-delete/profile-set-active 全链路真跑（契约为 id 而非 name，实测确认） | social-link-analysis.md 死引用 `../../shared/`→`../../../shared/` | 社媒链接分析依赖外网可抓性，SKILL 已有降级为用户自述的路径 |
| 15 | easel-publish-checklist | publish | 范围外 | 发布链路由 Phase 2 发布工作流（server/lib/publish/ + publish-* actions）维护，本审计未触碰 | — | 归 Phase 2 回归 |
| 16 | easel-platform-adapt | publish | 范围外 | 同上，发布相关段落归 Phase 2 发布工作流，本审计未触碰 | — | 归 Phase 2 回归 |
| 17 | easel-paper-explainer | produce | 范围外 | 同上，本审计未触碰其任何段落 | — | 归 Phase 2 回归 |

## 回归建议

1. 装模型 key 后优先回归：topic-evaluator 同题双跑、hook-generator 逐行喂 wordcount 的遵循度、xhs-note Step 0→8 全流程。
2. 装 `pillow numpy playwright` 后回归：xhs-note html_card 渲染 + card_audit 硬门禁的完整管线（本机此前不可执行）。
3. 每次改 shared 公共源（scoring-dimensions / hook-title-formulas / copy-frameworks / hotlist-apis）后，grep 引用它的技能并复跑本表第 2/7/8/9/12 行。
