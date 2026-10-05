# 中文社媒热搜 API

免费、无需密钥、通过 web_fetch 直接调用。返回 JSON。

> 🚫 **只用本文列出的已验证 API。禁止直接 web_fetch 平台官网**（weibo.com / zhihu.com / douyin.com）**或 tophub.today** —— 它们对服务器 IP 有反爬，返回 403 / 验证码 / 空内容，不是数据。所有请求走外网代理（环境已配 `useTrustedEnvProxy`）。

## 推荐数据源：60s API（v2）

Base URL: `https://60s.viki.moe`

> ⚠️ API 已升级到 v2，路径必须带 `/v2/` 前缀，旧路径已废弃。

| 端点 | 平台 | 状态 | 返回条数 |
|------|------|------|---------|
| `/v2/weibo` | 微博热搜 | ✅ | ~50 |
| `/v2/douyin` | 抖音热搜 | ✅ | ~49 |
| `/v2/zhihu` | 知乎热榜 | ✅ | ~30 |
| `/v2/toutiao` | 今日头条 | ✅ | ~50 |
| `/v2/rednote` | 小红书热搜 | ✅ | ~20 |
| `/v2/bili` | B站热门 | ⚠️ 不稳定（B站反爬导致上游 500） | — |
| `/v2/baidu/hot` | 百度热搜 | ✅ | ~30 |

> 注：`trends` action 的 6 平台集合是 微博/抖音/知乎/B站/**百度**/头条 —— 百度是内置平台，热榜页 /trends 会出现「百度」板块，属预期行为。

| `/v2/60s` | 每天60秒新闻 | ✅ | 10-15 |
| `/v2/it-news` | IT 资讯 | ✅ | ~20 |
| `/v2/ai-news` | AI 资讯 | ✅ | ~20 |

### 响应格式

v2 响应结构（data 字段可能是数组或嵌套对象，取决于端点）：

```json
{
  "code": 200,
  "message": "success",
  "data": [
    { "title": "热搜标题", "hot": 1148823, "url": "https://..." },
    ...
  ]
}
```

部分端点返回嵌套结构：
```json
{
  "code": 200,
  "data": {
    "data": [ { "title": "...", "hot": 123 } ]
  }
}
```

解析时先检查 `data` 是数组还是对象（含嵌套 `data.data`）。

### 用法示例

```
web_fetch https://60s.viki.moe/v2/weibo
web_fetch https://60s.viki.moe/v2/douyin
web_fetch https://60s.viki.moe/v2/rednote
```

### 推荐抓取组合

- **默认**：微博 + 抖音（覆盖面最广）
- **全平台**：微博 + 抖音 + 知乎 + 头条 + 小红书
- **B站用户**：`/v2/bili` 不稳定，用下面「B站官方热搜」端点（或 `trends` action）替代

## B站数据获取

60s 的 `/v2/bili` 常返回 500（B站反爬导致上游失败）。**优先调 `trends` action** —— 它内置「60s → xxapi → B站官方」三级降级与 60s 缓存，B站始终有数据。直抓时按下面顺序选源。

**不要 web_fetch B站视频页面**，会触发验证码返回空内容。如用户提供了具体 BV 号，告知无法通过 web_fetch 抓取，建议用户直接提供内容。

### B站官方热搜（首选直抓源）

`https://api.bilibili.com/x/web-interface/search/square?limit=50` —— 无需 key，返回
`{"code":0,"data":{"trending":{"list":[{"keyword","show_name","heat_score",...}]}}}`。
`limit` 必须显式给出（省略会返回空 list）。标题取 `keyword`/`show_name`，热度取 `heat_score`。

## 备选数据源：xxapi（v2）—— 已验证可用

Base URL: `https://v2.xxapi.cn`

当 60s 某端点不可用（尤其 B站）时用它。返回 `{"code":200,"data":[{"title","hot","url",...}]}`。

| 端点 | 平台 | 状态 |
|------|------|------|
| `/api/weibohot` | 微博热搜 | ✅ |
| `/api/douyinhot` | 抖音热搜 | ✅ |
| `/api/bilibilihot` | B站热搜 | ✅（60s 的 bili 挂时用这个） |
| `/api/baiduhot` | 百度热搜 | ✅ |

用法：`web_fetch https://v2.xxapi.cn/api/bilibilihot`

## 其他备选

- `https://api.03c3.cn/api/zb` — 综合热榜（不稳定）

## 注意事项

- 所有请求走外网代理（环境已配置 `useTrustedEnvProxy`）
- 60s / xxapi 均为公益项目，勿高频调用（建议 ≤1 次/分钟）
- 数据约 5-10 分钟刷新一次
- 单一源失败时按「60s → xxapi → B站官方 → 间接获取」降级，并在产出末尾诚实标注数据来源与时效
