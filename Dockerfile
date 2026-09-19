# syntax=docker/dockerfile:1

# 依赖阶段：完整镜像自带编译工具，better-sqlite3 无论命中预编译包还是源码编译都能装上
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 运行阶段：精简镜像，进程内 SQLite 数据落在 /data
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/muskingum.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "src/index.js"]
