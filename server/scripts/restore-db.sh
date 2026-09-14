#!/usr/bin/env bash
# 从备份恢复数据库 —— 会覆盖当前生产库，需二次确认
#
# 用法：
#   bash server/scripts/restore-db.sh server/data/attendance-20260914-190000.db
#   bash server/scripts/restore-db.sh <备份文件> attendance-server -y   # 跳过确认（定时任务/脚本里用）
#
# 步骤：停容器 → 覆盖 db 文件 → 启容器 → 等待健康检查
# 停机窗口取决于数据量，当前规模实测 < 10 秒。

set -euo pipefail

CONTAINER="${2:-attendance-server}"
FORCE_YES="${3:-}"
DB_PATH="server/data/attendance.db"

if [ $# -lt 1 ]; then
  echo "用法: bash server/scripts/restore-db.sh <备份文件路径> [容器名]" >&2
  echo "可用备份：" >&2
  ls -1 server/data/attendance-*.db 2>/dev/null | sed 's/^/  /' >&2 || echo "  （暂无）" >&2
  exit 1
fi

SRC="$1"
[ -f "$SRC" ] || { echo "✗ 备份文件不存在：$SRC" >&2; exit 1; }

# 恢复前先把当前库也存一份，避免「恢复错了还想反悔」无处可去
ROLLBACK_STAMP="$(date +%Y%m%d-%H%M%S)"
if [ -f "$DB_PATH" ]; then
  cp "$DB_PATH" "server/data/before-restore-${ROLLBACK_STAMP}.db"
  echo "已把当前库存档为 server/data/before-restore-${ROLLBACK_STAMP}.db"
fi

ans="N"
if [ "$FORCE_YES" = "-y" ] || [ "${FORCE_YES}" = "y" ] || [ "${RESTORE_YES:-}" = "1" ]; then
  ans="y"
else
  printf '即将用 %s 覆盖 %s（当前学员等数据会丢失），确认？[y/N] ' "$SRC" "$DB_PATH"
  read -r ans || ans="N"
fi
if [ "$ans" != "y" ]; then
  echo "已取消（未改动任何数据）"
  exit 0
fi

docker stop "$CONTAINER" >/dev/null

# ⚠️ 关键：必须清掉 -wal / -shm，否则必崩。
# SQLite 运行在该库的 journal_mode=WAL 下，attendance.db-wal 里存着尚未合并的事务。
# 若只覆盖 .db 而留下旧 WAL，SQLite 会把「上一个库的事务日志」挂到新库上，
# 启动时直接报 `malformed database schema (92)` / `database disk image is malformed`
# 并进入 crash loop（2026-09-14 实测踩到，务必保留这段逻辑）。
# 用 mv 隔离而不是 rm，万一需要原始数据还能救回来。
if [ -f "${DB_PATH}-wal" ] || [ -f "${DB_PATH}-shm" ]; then
  QUAR="server/data/_quarantine/${ROLLBACK_STAMP}"
  mkdir -p "$QUAR"
  mv "${DB_PATH}-wal" "$QUAR/" 2>/dev/null || true
  mv "${DB_PATH}-shm" "$QUAR/" 2>/dev/null || true
  echo "已隔离旧的 -wal / -shm → $QUAR"
fi

cp "$SRC" "$DB_PATH"
docker start "$CONTAINER" >/dev/null

for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  [ "$code" = "200" ] && break
  sleep 1
done

echo "✓ 恢复完成"
docker exec "$CONTAINER" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/app/data/attendance.db', { readOnly: true });
  console.log('学员数 ' + db.prepare('SELECT COUNT(*) c FROM students').get().c +
              ' | 库版本 v' + db.prepare('PRAGMA user_version').get().user_version);
  db.close();
" 2>&1 | grep -v -e Warning -e trace-warnings
