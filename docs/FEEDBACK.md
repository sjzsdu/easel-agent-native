# 一周试用反馈（试用期：2026-09-24 ~ 2026-10-01）

试用期间随手记，一行一条：`日期 | 页面/技能 | 现象 | 期望`。
攒满一周后按「出现次数 × 影响」排序，决定下一批修复。

## 待办决策（试用结束时三选一）

- [x] ~~**【首修】AgentKit run 频繁"非正常终止"（ended without a terminal event）→ 重连 → 整应用进 Error / Vite "socket hang up" 覆盖层无法恢复**~~ **2026-09-28 已定位并修复，见下方「根因与修复」**
- [ ] **【2026-09-26 复测·阻塞】dev 重启改用 `scripts/with-proxy.mjs` 后，所有 agent 请求 403（Anthropic 格式 `{"error":{"type":"forbidden","message":"Request not allowed"}}`）——trends、查画像等全部失败，核心 AI 功能整体不可用。代理端口 7897 可达、经代理访问外网正常（401/200），属 LLM 上游经代理被拒，需排查代理/凭据路由**（阻塞所有后续复测）
- [ ] **【2026-09-26 复测】quality-cliches 新测试 3/40 失败**：generic-opening 正则漏掉"你有没有发现，…？"（问号前有逗号）；generic-advice 正则漏掉"所以大家一定要坚持，不要放弃"（断言前是逗号非句界）→ 常见真实句式的套话仍漏判
- [ ] 修 `/trends` 冷启动慢（实测约 41s，远超文档 ~15s；且返回无 B站 数据、出现文档未列的"百度"、知乎走缓存）
- [ ] quality-gate 加「套话 warn」启发式（现为纯合规门禁，实测 100/100 通过但 agent 自述"有几处略像套话"）
- [ ] 真实凭据单平台灰度（公众号或 B站，低风险文案一次，验证 publish 真发成功率）

## 反馈记录

| 日期 | 页面/技能 | 现象 | 期望 |
|------|-----------|------|------|
| 2026-09-26 | 全局（复测） | dev 重启后用 `with-proxy.mjs`，所有 agent 请求 403 "Request not allowed"（Anthropic 格式）——trends×2、查画像全部失败，AI 功能整体不可用；代理端口与外网均正常 | 修复代理/凭据路由；阻塞解除后才有条件复测其余项 |
| 2026-09-26 | quality-gate（复测） | 新增 quality-cliches 测试 3/40 失败："你有没有发现，身边做副业的人越来越多了？"（逗号在问号前）和"所以大家一定要坚持，不要放弃"（断言前为逗号）未被 generic-opening/generic-advice 正则命中 | 正则放宽常见真实句式；测试须全绿 |
| 2026-09-25 | 全局（多次） | AgentKit run 频繁报 "Run failed … ended without a terminal event"，随后出现 Reconnect 按钮，甚至整页变 Error + Vite "socket hang up" 覆盖层，刷新/Esc/点外部都无法恢复 | 运行应正常收尾；失败给明确原因；有稳定的恢复路径，不把整个工作台卡死 |
| 2026-09-25 | 全局 | 每个 agent 操作耗时几十秒~数分钟：trends 41s、选题评估 4m38s、竞品 3m21s、卡片生成 4m23s、日历 1m58s、一稿多发 1m26s，多数时间静默无进度 | 重操作给进度/渐进渲染/中途可反馈，减少"一直 Thinking"的无反馈等待 |
| 2026-09-25 | /calendar | 排期 agent 答复写 "20:00/20:30"，日历页却显示 "12:00/12:30"（差 8 小时，疑似按 UTC 存储、显示未转本地时区） | 时间统一存本地时区并正确显示 |
| 2026-09-25 | 全局 | 界面语言在同一会话内中↔英来回切换（打开导航/Message agent…）；模型按钮偶发显示"连接密钥/Connect keys"而非模型名"Luna" | 语言与模型标签保持稳定一致 |
| 2026-09-25 | /trends | 冷启动约 41s（远超文档 ~15s 的已知问题）；本次返回无 B站 数据，反而出现文档未列的"百度"；知乎走缓存 | 冷启动并行化/渐进渲染；平台集合与文档一致；缓存来源更醒目 |
| 2026-09-25 | topic-evaluator | 选题评估耗 4m38s；答复中注明"共享评分权重文件本次无法读取，综合分用七维平均分换算，并非加权分" | 权重文件应可读，或用确定性加权口径并前置说明 |
| 2026-09-25 | /outputs | 内容库计数不一致：顶部"全部7/待发6/草稿4"，6+4=10≠7；且 get_page_text 一度只返回"全部 0"（渲染时序/双数据源） | 单一数据源、计数一致，空态不闪现 |
| 2026-09-25 | quality-gate | 套话不拦：100/100 通过，但 agent 自述"有几处略像套话"（泛化开头、通用劝告、收藏型 CTA） | 加套话/AI 味启发式（印证既有待办） |
| 2026-09-25 | /ideas | kanban 卡片文字在窄窗口下截断（标题/描述被裁） | 卡片自适应宽度、文字完整换行 |
| 2026-09-25 | metrics-save | 无对应发布记录时拒绝保存手动试录数据（诚实，但归因流程门槛高，无发布环境几乎无法测归因） | 提供独立的"手动录入"入口，不与发布记录强绑定，仍标 source: manual |
| 2026-09-25 | /publish | 缺凭据时如实报 failed、明确列出缺失密钥（BILI_SESSDATA 等）并引导去 secrets 注册，绝不假装发布成功 | 保持该行为（本次体验中做得最好的诚实路径） |
| 2026-09-25 | 归因/竞品 | 无数据时明确标"待验证假设、非数据结论"；竞品/受众如实标注证据边界（第三方榜单口径、未采集逐篇笔记） | 保持该诚实性，可作为产品卖点 |

## 根因与修复（2026-09-28，socket hang up 全应用卡死）

**表象**：所有 SSR 路由 500 + Vite 全屏 "socket hang up" 覆盖层（`Socket.socketOnEnd`），Esc / 刷新 / 重启浏览器都无法恢复。

**根因链**（从表象逐层下钻确认）：
1. Nitro dev worker（跑在 vite 进程内）启动时打开 `data/pglite`；
2. 该 PGlite 数据目录 WAL 已损坏（`PANIC: could not locate a valid checkpoint record at 0/8504970`，上次异常退出残留）→ PGlite WASM abort → worker 立即死亡；
3. Nitro 管理层未收到死亡通知，仍向旧 worker 地址发 `http.request` → 每请求抛 "socket hang up"；
4. Vite 把该错误渲染成覆盖层；worker 以线程方式重启 3 次都撞同一损坏目录，继续死 → 永久卡死。

**修复（三层）**：
1. **数据修复**：`pg_resetwal -f` 重写 WAL 救回数据（96 表 / ideas / content_items / chat_threads / settings 全部完好），替换 `data/pglite`，坏目录留档 `data/pglite.corrupt-wal-0928`；
2. **进程隔离**：`scripts/with-proxy.mjs` 注入 `NITRO_DEV_RUNNER=node-process`，worker 改跑独立子进程 —— 今后 worker 崩溃会随进程退出释放 PGlite 锁 / fd，Nitro 的自动重启能真正拉起新 worker，不再把 vite 主进程拖死；
3. **降级兜底**：新增 `scripts/vite-nitro-worker-guard.ts`（已接入 `vite.config.ts`），把 "socket hang up" / ECONNRESET / "Dev server is unavailable" 类基础设施错误从错误覆盖层改写为 503 自动刷新页 —— 即使 worker 短暂僵死，页面也会自恢复而不是永久全屏报错。

**复测**：全部路由 200，server log 0 次 "socket hang up" / 0 次 worker 重启 / 0 次迁移失败。

## 已知问题（来自 docs/ACCEPTANCE.md 遗留风险，试用时留意是否踩到）

- ffmpeg 无 freetype：带字幕视频合成不可用（`slideshow.py --captions` / `video_ops.py text`）
- PGlite 单实例锁：不能并行起两个 dev server
- 内容库「全部 / 草稿」计数可能不一致（outputs 目录 vs SQL 两个数据源）→ **2026-09-25 已踩到**（全部7/待发6/草稿4，6+4≠7）
- 登录页/`/home` 部分文案仍是框架模板（品牌未替换）

## 本次试录的补充问题（见上方反馈表，按影响排序）

1. AgentKit run 频繁"非正常终止"→ 重连 → 整应用 Error / Vite "socket hang up" 覆盖层（最严重，建议首修）
2. 极端等待（每步几十秒~数分钟，缺进度反馈）
3. /calendar 时区偏移 8 小时（20:00 → 显示 12:00）
4. 界面语言中英来回切换 + 模型按钮偶发显示"连接密钥"
5. metrics-save 强依赖发布记录，手动数据难以录入
