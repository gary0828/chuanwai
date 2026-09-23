#!/usr/bin/env bash
# ============================================================
#  教务管理系统 · Linux 服务器一键部署（PVE 虚拟机 / 物理机通用）
#  适用：Debian 12 / Ubuntu 22.04+（x86_64 或 arm64）
#
#  用法（在装有本项目的目录里执行）：
#      sudo bash deploy/linux-server-setup.sh
#  指定对外端口（默认 18080，避开需备案的 80/443）：
#      sudo bash deploy/linux-server-setup.sh --web-port 18080
#
#  它会依次完成：
#    1. 安装 Docker + Compose 插件
#    2. 配置 Docker 镜像加速器（国内网络，可跳过）
#    3. 生成 .env（随机 JWT 密钥）
#    4. 启动「统一入口」编排（对外只开一个端口）
#    5. 设置开机自启 + 防火墙 + 每日数据备份
#
#  跑完后还需要你在【路由器 / 云安全组】把公网端口映射到本机 WEB_PORT，
#  外网才能访问 —— 见 docs/06-部署/校区部署与升级.md §九。
#
#  大模型 Key 不在这里配：登录后在「AI 配置中心」页面(/#/ai-admin)填写。
#
#  幂等：重复执行安全，不会破坏已有数据。
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# 对外端口。默认 18080：无域名场景下 80/443 需 ICP 备案，
# 用高位端口可合规对外提供访问（详见 docs/06-部署/校区部署与升级.md §九 合规章节）。
# 若要改成 80（已备案域名场景）：--web-port 80
WEB_PORT="${WEB_PORT:-18080}"
SKIP_MIRROR="${SKIP_MIRROR:-0}"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web-port)   WEB_PORT="${2:-}"; shift 2 ;;
    --skip-mirror) SKIP_MIRROR=1; shift ;;
    -h|--help)    sed -n '2,23p' "$0"; exit 0 ;;
    *)            die "未知参数：$1（用 --help 查看用法）" ;;
  esac
done

# ---------- 0. 前置检查 ----------
say "检查运行环境"
[[ "$(id -u)" -eq 0 ]] || die "请用 root 执行：sudo bash $0"
[[ -f docker-compose.yml ]] || die "没找到 docker-compose.yml，请在项目根目录执行"
case "$(uname -m)" in x86_64|aarch64) ok "架构 $(uname -m) 支持" ;; *) die "不支持的架构 $(uname -m)" ;; esac
[[ "${APP_DIR}" =~ ^[a-zA-Z0-9_./-]+$ ]] || die "项目路径含非 ASCII 字符：${APP_DIR}\nDocker 构建会把目录编码进请求头，中文路径必然构建失败，请换到 /opt/jx-system 之类的路径"

# ---------- 1. 安装 Docker ----------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker 已安装，跳过"
else
  say "安装 Docker CE + Compose 插件"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  chmod a+r /etc/apt/keyrings/docker.gpg
  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  ok "Docker 安装完成"
fi
systemctl enable --now docker >/dev/null 2>&1 && ok "Docker 开机自启已开启"

# ---------- 2. 镜像加速器（国内网络）----------
if [[ "$SKIP_MIRROR" != "1" ]]; then
  say "配置 Docker 镜像加速器"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://hub.rat.dev",
    "https://docker.xuanyuan.me"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
  ok "已配置加速器（若现场仍拉不动镜像，见部署文档的「离线镜像包」方案）"
fi

# ---------- 3. 生成 .env ----------
say "准备环境变量"
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
JWT_SECRET="${JWT_SECRET:-}"
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ok "已生成随机 JWT 密钥"
fi

cat > .env <<ENV
# 本文件由部署脚本生成，含密钥，已加入 .gitignore，切勿提交
JWT_SECRET=${JWT_SECRET}
WEB_PORT=${WEB_PORT}
# 同源部署：AI 助手跳转自动跟随访问者地址
AI_WORKBENCH_URL=http://localhost
AI_WORKBENCH_BASE_PATH=/ai
ENV
chmod 600 .env
ok "大模型 Key 不在本文件配置：登录后在「AI 配置中心」页面(/#/ai-admin)填写即可"

# .gitignore 兜底
grep -qxF '.env' .gitignore 2>/dev/null || echo '.env' >> .gitignore

# ---------- 4. 启动 ----------
say "构建并启动（首次约 3–8 分钟，取决于网络）"
# 清理旧编排（三端口形态 / 旧统一入口）遗留的同名容器，避免 name conflict；
# 数据在 bind mount ./server/data，删容器不会丢数据。
docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench >/dev/null 2>&1 || true
docker compose up -d --build

say "等待服务就绪"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then ok "后端已就绪"; break; fi
  [[ $i -eq 60 ]] && { docker compose logs --tail 40 server; die "服务未就绪，请检查上方日志"; }
  sleep 3
done

# ---------- 5. 防火墙 ----------
say "配置防火墙（只放行 SSH 与 ${WEB_PORT}）"
if command -v ufw >/dev/null 2>&1; then
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp comment 'SSH' >/dev/null
  ufw allow "${WEB_PORT}/tcp" comment '教务系统' >/dev/null
  ufw --force enable >/dev/null
  ok "ufw 已启用（后端 3000 未放行，公网不可达）"
else
  warn "未安装 ufw，请自行确认只暴露 ${WEB_PORT}"
fi

# ---------- 6. 每日数据备份 ----------
say "配置每日自动备份"
BACKUP_DIR="/var/backups/jx-system"
mkdir -p "$BACKUP_DIR" "$APP_DIR/server/data"
cat > /usr/local/bin/jx-backup.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="__APP_DIR__"
BACKUP_DIR="/var/backups/jx-system"
ts="$(date +%F-%H%M)"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/data-$ts.tar.gz" -C "$APP_DIR" server/data
find "$BACKUP_DIR" -name 'data-*.tar.gz' -mtime +14 -delete
SH
sed -i "s|__APP_DIR__|$APP_DIR|" /usr/local/bin/jx-backup.sh
chmod +x /usr/local/bin/jx-backup.sh
( crontab -l 2>/dev/null | grep -v jx-backup.sh; echo "0 3 * * * /usr/local/bin/jx-backup.sh >> /var/log/jx-backup.log 2>&1" ) | crontab -
ok "每天凌晨 3 点备份到 ${BACKUP_DIR}，保留 14 天"

# ---------- 7. 完成 ----------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')" || IP=""
cat <<TIP

────────────────────────────────────────────
  部署完成（本机已可用）

  本机访问        http://localhost:${WEB_PORT}
  校区老师访问    http://${IP}:${WEB_PORT}      ← 让老师用这个，不要用 localhost
  AI 配置中心     http://${IP}:${WEB_PORT}/#/ai-admin

  ⚠ 想让【外网】也能访问，还差最后一步：
     在路由器 / 云安全组里，把公网端口映射到本机的 ${WEB_PORT}
     例：公网 18080 → ${IP}:${WEB_PORT}
     然后在手机 4G 流量下访问 http://<公网IP>:${WEB_PORT} 验证

     提示：请用 18080 这类高位端口，不要用 80/443 ——
     中国大陆 80/443 对外提供服务需要 ICP 备案，而备案必须有域名。

  默认账号        admin / admin123456
                  teacher / teacher123456

  ⚠ 接下来必须做：
    1. 用 admin 登录，立刻修改默认口令（个人中心）
    2. 在「AI 配置中心」页面填写大模型 Key（页面上能看到余额与用量即通）
    3. 让老师用 IP 访问，不要在本地之外用 localhost

  常用命令
    查看状态：docker compose ps
    查看日志：docker compose logs -f server
    备份数据：/usr/local/bin/jx-backup.sh
────────────────────────────────────────────
TIP
