# Easel 部署 Runbook

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `BETTER_AUTH_SECRET` | 生产 | 32 字节 hex 密钥，用于会话签名和 secrets 加密。`openssl rand -hex 32` 生成 |
| `DATABASE_URL` | 生产 | PostgreSQL 连接串，`postgresql://user:pass@host:5432/db?sslmode=require`。本地 dev 留空使用 PGlite |
| `SECRETS_ENCRYPTION_KEY` | 可选 | Secrets 加密密钥，未设置回退到 `BETTER_AUTH_SECRET` |
| `EASEL_OUTPUTS_DIR` | 可选 | 内容产物目录，默认 `<cwd>/outputs/`。生产建议挂载持久卷 |
| `PORT` | 可选 | 监听端口，默认 `3000` |
| `NITRO_PRESET` | 可选 | Nitro 部署 preset，默认 `node-server` |
| `PING_MESSAGE` | 可选 | 健康检查消息，默认 `pong` |

发布凭据（通过 secrets 注册，不在环境变量中管理）：

| Secret Key | 平台 |
|------------|------|
| `WECHAT_OA_APP_ID` / `WECHAT_OA_APP_SECRET` | 公众号 |
| `BILI_SESSDATA` / `BILI_BILI_JCT` / `BILI_DEDEUSERID` | B站 |
| `WEIBO_ACCESS_TOKEN` | 微博 |

## 部署方式

### Docker（推荐）

```bash
# 构建镜像
docker build -t easel .

# 运行（注入 secrets）
docker run -d \
  --name easel \
  -p 3000:3000 \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e DATABASE_URL="postgresql://user:pass@db:5432/easel?sslmode=require" \
  -e SECRETS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -v easel-outputs:/data/outputs \
  easel
```

### Node.js 直接部署

```bash
pnpm build
pnpm migrate:production   # 框架表迁移
BETTER_AUTH_SECRET=xxx \
DATABASE_URL=postgresql://... \
node .output/server/index.mjs
```

### 其他平台

设置 `NITRO_PRESET` 后 `pnpm build`：

| 平台 | NITRO_PRESET |
|------|-------------|
| Vercel | `vercel` |
| Netlify | `netlify` |
| Cloudflare Pages | `cloudflare_pages` |
| AWS Lambda | `aws-lambda` |

## 迁移

### 首次部署

```bash
# 1. 确保 DATABASE_URL 指向空库
# 2. 运行框架迁移（表自动创建）
pnpm migrate:production

# 3. 应用迁移在 server/plugins/db.ts 中注册，首启自动执行
```

`scripts/migrate-production.ts` 通过 `withMigrationRuntime()` 包裹，安全执行框架表迁移。应用表（profiles/ideas/calendar_events/content_items/publish_jobs/publish_records）在 server/plugins/db.ts 中以 `IF NOT EXISTS` 方式注册，首启自动建表。

### 回滚

- 迁移 SQL 是 additive-only（`IF NOT EXISTS`，不 DROP/RENAME）
- 回滚 = 回退代码版本，数据库表保持兼容
- 如需删表：手动连库执行 `DROP TABLE`（生产慎用）

## 安全检查清单

- [ ] `BETTER_AUTH_SECRET` 已设置（非空）
- [ ] `DATABASE_URL` 指向 TLS 保护的 PostgreSQL（`sslmode=require`）
- [ ] HTTPS 终端已配置（框架在 HTTPS 下自动设置 `Secure; SameSite=None` cookie）
- [ ] secrets 不出现在日志/错误信息中（框架 `resolveCredential` 自动掩码）
- [ ] `EASEL_OUTPUTS_DIR` 挂载到持久卷（容器重启不丢内容）
- [ ] 发布凭据在 settings → API keys 中管理，不进 env/代码

## 常见故障

| 症状 | 原因 | 解决 |
|------|------|------|
| 启动报 `BETTER_AUTH_SECRET` ERROR | 生产环境未设置 | 设置 `BETTER_AUTH_SECRET=$(openssl rand -hex 32)` |
| 启动报 `DATABASE_URL` ERROR | 生产环境未设置 | 设置为 PostgreSQL 连接串 |
| Cookie 不持久 | 非 HTTPS 部署 | 配置 HTTPS 反向代理，框架按 HTTPS 自动设置 Secure cookie |
| `pnpm build` 失败 | 依赖不完整 | `pnpm install --frozen-lockfile` |
| 迁移失败 | DATABASE_URL 指向 PgBouncer | 设置 `DATABASE_URL_UNPOOLED` 直连 |
| 发布凭据不生效 | 未在 settings 中配置 | 打开 `/settings` → API keys，填入对应凭据 |

## CI 流水线

CI 包含两个 job：

1. **test** — typecheck + doctor + test
2. **build** — production build + smoke test start（依赖 test 通过）

```yaml
jobs:
  test:     # Typecheck · Doctor · Test
  build:    # Production Build + smoke (needs: test)
```
