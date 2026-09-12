# 后端服务：Express + Node 内置 SQLite（node:sqlite，零原生依赖编译）
# 构建上下文为项目根目录：docker build -f server/Dockerfile .
FROM node:24-alpine

WORKDIR /app

# 国内网络：使用 npmmirror 镜像源
RUN npm config set registry https://registry.npmmirror.com

COPY server/package.json server/package-lock.json server/.npmrc ./
RUN npm ci --omit=dev

COPY server/src ./src

ENV PORT=3000
EXPOSE 3000

# 数据持久化目录（compose 中挂载 ./server/data:/app/data）
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/index.js"]
