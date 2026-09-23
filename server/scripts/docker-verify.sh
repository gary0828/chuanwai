#!/usr/bin/env bash
# Docker 部署验证：健康检查 / 前端托管 / nginx 反代 / 数据持久化 / analytics
# 用法：bash server/scripts/docker-verify.sh
# 说明：不使用 /tmp（部分 Git Bash 环境不可写），全部用命令替换取正文+状态码。
set -uo pipefail

# ★ 自愈 PATH（2026-09-23）：非登录 shell（如 `bash server/scripts/docker-verify.sh`）
#   不会加载 /etc/profile，Git Bash 下 /usr/bin 可能不在 PATH，导致
#   grep/sed/wc/cut/tr/tail 全部 "command not found"，进而让所有断言**误报 FAIL**
#   （实测：接口明明返回 200 且 JSON 正确，却被判失败）。
#   显式补上即可，Linux 上这两个目录本就存在，无副作用。
PATH="/usr/bin:/bin:$PATH"

# 对外端口：取 .env 的 WEB_PORT，缺省 18080（无域名场景）
WEB_PORT="$(grep -E '^WEB_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' ')"
WEB_PORT="${WEB_PORT:-18080}"
# ★ 2026-09-23 起 Docker 统一为「统一入口单端口」：教务 / ＋ 工作台 /ai/ ＋ 后端 /api 同端口。
#   后端 3000 不再对外暴露，所有请求（含 /api）都经同一个 nginx 入口。
FE="http://localhost:${WEB_PORT}"
BE="http://localhost:${WEB_PORT}"
PASS=0
FAIL=0

ok()  { echo "[PASS] $1 ${2:-}"; PASS=$((PASS+1)); }
bad() { echo "[FAIL] $1 ${2:-}"; FAIL=$((FAIL+1)); }

# 取响应的「正文 + 状态码」，避免写临时文件
# 用法：fetch <url> [curl 额外参数...]  → 设置全局 BODY / CODE
fetch() {
  local url="$1"; shift
  local resp
  resp=$(curl -s -m 15 -w $'\n__CODE__%{http_code}' "$@" "$url" 2>&1)
  CODE="${resp##*__CODE__}"
  BODY="${resp%$'\n'__CODE__*}"
}

echo "==================== Docker 部署验证 ===================="

echo "--- 容器 ---"
docker compose ps --format "{{.Service}} | {{.Status}} | {{.Ports}}" 2>&1 | sed 's/^/  /'
RUNNING=$(docker compose ps --status running -q 2>/dev/null | wc -l | tr -d ' ')
if [ "$RUNNING" -ge 2 ]; then ok "两个容器均在运行" "(count=$RUNNING)"; else bad "容器未全部运行" "(count=$RUNNING)"; fi

echo "--- 后端 ---"
fetch "$BE/api/health"
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"status":"ok"'; then
  ok "GET $BE/api/health => 200" "$BODY"
else
  bad "GET $BE/api/health" "code=$CODE body=$BODY"
fi

echo "--- 前端 ---"
fetch "$FE/"
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q 'id="app"'; then
  ok "GET $FE/ => 200 且返回 SPA 入口" "(html $(printf '%s' "$BODY" | wc -c | tr -d ' ') bytes)"
else
  bad "GET $FE/" "code=$CODE"
fi

fetch "$FE/some/deep/path"
if [ "$CODE" = "200" ]; then ok "SPA fallback 深链接返回入口"; else bad "SPA fallback" "code=$CODE"; fi

echo "--- 反代 ---"
fetch "$FE/api/health"
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"status":"ok"'; then
  ok "GET $FE/api/health（经 nginx 反代）=> 200"
else
  bad "nginx 反代 /api" "code=$CODE body=$BODY"
fi

echo "--- 数据 / 登录 ---"
fetch "$BE/api/auth/login" -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456","type":"password"}'
TOKEN=$(printf '%s' "$BODY" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -n "$TOKEN" ]; then ok "admin 登录成功（挂载的 SQLite 可读）"; else bad "admin 登录失败" "code=$CODE"; fi

if [ -n "$TOKEN" ]; then
  fetch "$BE/api/students?page=1&pageSize=1" -H "Authorization: Bearer $TOKEN"
  N=$(printf '%s' "$BODY" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')
  if [ -n "$N" ]; then ok "学生表可查询" "total=$N"; else bad "学生表查询失败" "code=$CODE"; fi

  fetch "$BE/api/analytics/overview" -H "Authorization: Bearer $TOKEN"
  if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"data_version"'; then
    ok "GET /api/analytics/overview => 200" "$(printf '%s' "$BODY" | grep -o '"data_version":"[^"]*"')"
  else
    bad "analytics/overview" "code=$CODE body=${BODY:0:160}"
  fi
fi

echo "--- 数据持久化 ---"
MOUNT=$(docker compose exec -T server sh -c 'ls -l /app/data/attendance.db' 2>/dev/null | tr -d '\r')
if printf '%s' "$MOUNT" | grep -q "attendance.db"; then ok "容器内 /app/data/attendance.db 存在" "$MOUNT"; else bad "容器内未找到数据库文件"; fi

echo ""
echo "==================== 汇总：PASS $PASS / $((PASS+FAIL)) ===================="
[ "$FAIL" -eq 0 ] || echo "失败项数：$FAIL"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
