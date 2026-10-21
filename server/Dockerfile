# 后端服务：Express + Node 内置 SQLite（node:sqlite，零原生依赖编译）
# 构建上下文为项目根目录：docker build -f server/Dockerfile .
FROM node:24-alpine

WORKDIR /app

# 时区（P1-10）：Alpine 基础镜像默认 UTC 且不带 tzdata，会导致
#   1) 日志时间比校区早/晚 8 小时；
#   2) utils/backup.js 按 `new Date()` 本地时间生成备份文件名（日期错位）。
# 安装 tzdata 并把系统时区固定为 Asia/Shanghai；TZ 供 Node 解析，
# /etc/localtime 让 `date` / `ls` 等容器内命令的语义与 Node 一致。
RUN apk add --no-cache tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone
ENV TZ=Asia/Shanghai

# 国内网络：使用 npmmirror 镜像源
RUN npm config set registry https://registry.npmmirror.com

COPY server/package.json server/package-lock.json server/.npmrc ./
RUN npm ci --omit=dev

COPY server/src ./src

# ⚠️ 必须保持 root 运行，不要改为 USER node
# 原因（2026-09-12 实测踩坑）：数据目录 /app/data 由 compose 以 bind mount 方式挂载
# 宿主机 ./server/data。Windows / Docker Desktop 下该目录属主为 root:root 且权限 755，
# 容器内 uid=1000 的 node 用户只能读不能写，启动时迁移会抛
#   Error: 迁移 v15 失败，已回滚：attempt to write a readonly database
# 导致容器 unhealthy、前端因 depends_on 无法启动。
# 若确需非 root，必须改为「entrypoint 以 root 启动 → chown /app/data → 降权执行」
# （需额外安装 su-exec），属上线后的独立改造项，勿在上线窗口内改动。
RUN mkdir -p /app/data

ENV PORT=3000
EXPOSE 3000

# 数据持久化目录（compose 中挂载 ./server/data:/app/data）
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# --env-file-if-exists：环境变量优先由 compose/外层注入；若挂载了 /app/.env 也会自动读取
CMD ["node", "--env-file-if-exists=.env", "src/index.js"]
