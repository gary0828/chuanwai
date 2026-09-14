# AI 教学工作台（ai-workbench）镜像
#
# 说明：
# - 工作台是纯静态 SPA（hash 路由），本身不含后端逻辑；
# - 会话由教务系统签发的一次性票据换取，数据走教务系统只读网关 /api/agent/*；
# - 与主前端共用同一份依赖清单，构建时统一安装（利用镜像层缓存）；
# - nginx 把 /api 同源反代到 attendance-server，避免跨域与端口暴露。
FROM node:20-alpine AS build-stage

WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@10.15.1 --activate

# 国内网络：使用 npmmirror 镜像源（与 .npmrc 保持一致）
RUN npm config set registry https://registry.npmmirror.com

COPY .npmrc package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec vite build --config ai-workbench/vite.config.ts

FROM nginx:stable-alpine AS production-stage

COPY ai-workbench/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/ai-workbench/dist /usr/share/nginx/html
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
