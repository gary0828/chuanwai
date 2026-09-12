# 前端构建阶段：pnpm 打包 pure-admin-thin
FROM node:20-alpine AS build-stage

WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@10.15.1 --activate

# 国内网络：使用 npmmirror 镜像源（与 .npmrc 保持一致）
RUN npm config set registry https://registry.npmmirror.com

COPY .npmrc package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# 运行阶段：nginx 托管静态资源 + 反代 /api 到后端服务
FROM nginx:stable-alpine AS production-stage

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
