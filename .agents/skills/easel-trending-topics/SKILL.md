---
name: trending-topics
description: >-
  抓取微博、抖音、知乎、头条、B站实时热搜，筛选与创作者赛道相关的热点，输出二创选题建议。
  当用户说"今天有什么热搜""热点""最近大家在聊什么""追热点""蹭热点""二创选题""热搜榜"时使用。
  本 SKILL 抓分钟级实时热搜榜做快速二创选题；日级深度行业资讯聚合不在本 SKILL。
layer: discover
---

# 热点发现

> 抓取多平台实时热搜数据，筛选与创作者赛道相关的热点，输出可操作的二创选题。

## 输入

用户 prompt 中提供以下信息（全部可选）：

- **平台**：微博 / 抖音 / 知乎 / 头条 / B站（默认：微博 + 抖音）
- **赛道/领域**：如"科技数码"、"美妆"、"职场"（有 Profile 时自动提取）
- **目的**：浏览热搜 / 找二创选题 / 追热点写内容

## 输出

```markdown
# 热点速报
日期: {date}
平台: {platforms}

## 🔥 全平台热搜 Top 10
| # | 平台 | 话题 | 热度 | 与你的相关度 |

## 🎯 推荐二创选题（3-5 个）
### 选题 1: {标题}
- 热点来源: {平台 + 原话题}
- 二创角度: {怎么切}
- 建议格式: {图文/短视频/thread}
- 时效性: {需要多快发}

## 📊 趋势洞察
{跨平台重合话题、上升趋势、可预判的后续热点}
```

## 执行步骤

1. **抓取热搜数据** — 优先调 `trends` action（热点雷达）：内置 60s 主源 + xxapi 备源 + B站官方第三源的降级与 60s 缓存，返回 `{platform, label, source, items:[{rank,title,url,hot}], error?}`。用户指定平台时传 `platforms`（`weibo`/`douyin`/`zhihu`/`bili`/`baidu`/`toutiao`），未指定取全部平台。

   🚫 **绝对不要 web_fetch 平台官网**（weibo.com / zhihu.com / douyin.com）**或 tophub.today** —— 它们对服务器 IP 反爬，返回登录页 / 验证码 / 403，不是数据。

   **降级**：`trends` 某平台 `items` 为空或带 `error` 时，再直抓已验证的公益 API（返回 JSON，无需 key，走外网代理）：主源 `https://60s.viki.moe/v2/<platform>`（路径必须带 `/v2/`，返回 `{"code":200,"data":[{title,hot,url},...]}`，部分端点为嵌套 `data.data`）；备源 `https://v2.xxapi.cn/api/weibohot|douyinhot|bilibilihot|baiduhot`；B站另可用官方热搜 `https://api.bilibili.com/x/web-interface/search/square?limit=50`（标题 `keyword`/`show_name`，热度 `heat_score`）。全部失败则如实告知并请用户粘贴热搜截图/文字。完整清单见 `../../shared/hotlist-apis.md`。
2. **解析数据** — 提取每条热搜的标题和热度值，按热度排序。
3. **赛道匹配** — 如有 Profile 或用户指定了赛道，过滤出与赛道相关的话题，标注相关度（高/中/低）。无赛道信息时展示全量 Top 10。
4. **二创分析** — 从相关话题中挑选 3-5 个有二创价值的选题：
   - 有争议性或讨论空间
   - 与创作者定位匹配
   - 时效性窗口足够（不是已经过气的）
   - 能产出差异化内容（不是简单搬运）
5. **趋势洞察** — 分析跨平台重合的话题（同时上微博和抖音热搜的说明是大事件）、上升趋势、可预判的后续热点。
6. **输出** — 按输出格式交付。

## Profile 感知

- **有 Profile 时**：
  - 读取 `profile.identity` 获取赛道和定位，自动过滤相关热点
  - 读取 `profile.style` 匹配二创建议的内容形式
  - 读取 `profile.platforms` 优先抓取创作者活跃平台的热搜
  - 读取 `profile.audience` 判断哪些热点对目标受众有吸引力
- **无 Profile 时**：
  - 展示全平台 Top 10，不做赛道过滤
  - 二创建议给出通用角度
  - 附注"指定赛道或提供 Profile 可获得更精准的热点筛选"
