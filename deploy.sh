#!/usr/bin/env bash
# 一键部署：装好 Docker Desktop 后，双击或 `bash deploy.sh` 即可。
#
# 做五件事：检查 Docker → 生成 .env（自动造 JWT 密钥）→ 准备镜像（优先用离线包，
# 不联网）→ 启动 → 自检并打印访问地址。
#
# 部署形态（2026-09-23 起统一）：**统一入口单端口** —— 一个 nginx 同时托管
# 教务系统(/)、AI 工作台(/ai/)、后端 API(/api)。不再有独立的「三端口」形态。
#
# 说明：本脚本刻意用 `docker build` + `compose up --no-build`，而不用
# `compose up --build` —— 后者在中文目录下会因 Docker Desktop 的 gRPC 缺陷
# 必然失败（详见 README 排障小节）。
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n== %s ==\n' "$1"; }

# 找一个本机局域网 IP，用于告诉用户「别的电脑该访问哪个地址」
guess_ip() {
  ipconfig 2>/dev/null |
    grep -oE '(192\.168\.[0-9]{1,3}\.[0-9]{1,3})|(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})' |
    grep -v '\.255$' | head -1
}

step "1/5 检查 Docker"
if ! docker info > /dev/null 2>&1; then
  echo "✗ 连不上 Docker。请先安装并启动 Docker Desktop，然后重跑本脚本。"
  exit 1
fi
echo "✓ Docker 可用"

step "2/5 准备环境配置 .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ 已从 .env.example 生成 .env"
else
  echo "✓ .env 已存在，保持不变"
fi
# JWT 签名密钥（后端缺它直接拒绝启动）
if ! grep -q '^JWT_SECRET=' .env 2>/dev/null; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)"
  echo "JWT_SECRET=${SECRET}" >> .env
  echo "✓ 已生成并写入随机 JWT 密钥"
fi
# 对外端口（默认 18080；大陆 80/443 对外服务需 ICP 备案）
if ! grep -q '^WEB_PORT=' .env 2>/dev/null; then
  echo 'WEB_PORT=18080' >> .env
fi
WEB_PORT="$(grep -E '^WEB_PORT=' .env | tail -1 | cut -d= -f2 | tr -d ' ')"
WEB_PORT="${WEB_PORT:-18080}"
echo "  对外端口：${WEB_PORT}"
echo "  提示：大模型 Key 不用改 .env —— 登录后在系统「AI 配置中心」页面填写即可"

step "3/5 准备镜像"
TARBALL="$(ls -1t attendance-offline-images*.tar.gz 2>/dev/null | head -1 || true)"
if [ -n "$TARBALL" ]; then
  echo "发现离线镜像包：$TARBALL（不联网，最快）"
  docker load -i "$TARBALL"
  UP_FLAG="--no-build"
elif docker image inspect attendance-system-server > /dev/null 2>&1 &&
     docker image inspect attendance-system-unified > /dev/null 2>&1; then
  echo "本机已有镜像，直接复用"
  UP_FLAG="--no-build"
else
  echo "未找到离线包，改为在线构建（需要联网，较慢）"
  docker build -t attendance-system-server  -f server/Dockerfile .
  docker build -t attendance-system-unified -f deploy/Dockerfile.unified .
  UP_FLAG="--no-build"
fi

step "4/5 启动服务"
# 清理旧编排（三端口形态 / 旧统一入口）遗留的同名容器，避免 name conflict；
# 数据在 bind mount ./server/data，删容器不会丢数据。
docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench >/dev/null 2>&1 || true
docker compose up -d $UP_FLAG

step "5/5 等待就绪并自检"
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}/api/health" 2>/dev/null || true)"
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}/api/health" 2>/dev/null || true)" = "200" ]; then
  echo "✓ 后端已就绪"
else
  echo "✗ 后端未就绪，执行 docker compose logs server 查看原因"
  exit 1
fi

IP="$(guess_ip)"
echo ""
echo "────────────────────────────────────────────"
echo "  部署完成"
echo ""
echo "  本机访问：        http://localhost:${WEB_PORT}"
[ -n "$IP" ] && echo "  同局域网其他电脑：http://${IP}:${WEB_PORT}"
echo ""
echo "  默认账号：admin / admin123456  ← 正式使用前务必改密码"
echo "  AI 配置中心：    http://localhost:${WEB_PORT}/#/ai-admin（仅管理员，不出现在菜单）"
echo "────────────────────────────────────────────"
echo ""
echo "  提醒：老师在别的电脑上打开时，请让他们用上面的 IP 地址访问；"
echo "        「AI 助手」按钮会自动跳到同一台机器上的工作台，不会出现打不开的情况。"
