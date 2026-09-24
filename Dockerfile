# ── Easel Dockerfile (node-server preset) ──────────────
# 多阶段构建：install → build → runtime
# 生产环境通过环境变量注入 secrets，不烘焙任何凭据。

# ── Stage 1: install ────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.29.1 --activate

# 仅安装依赖（利用 Docker 层缓存）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# ── Stage 2: build ──────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY . .

# 构建时不需要真实 secrets；agent-native build 不读取 BETTER_AUTH_SECRET
# NITRO_PRESET=node-server 是默认值，可在此覆盖
RUN pnpm build

# ── Stage 3: runtime ────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# 生产依赖 + 构建产物
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json

# outputs 目录（挂载持久卷）
RUN mkdir -p /data/outputs
ENV EASEL_OUTPUTS_DIR=/data/outputs

# 默认端口
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 启动
CMD ["node", ".output/server/index.mjs"]
