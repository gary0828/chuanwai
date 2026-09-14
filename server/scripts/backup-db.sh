#!/usr/bin/env bash
# 在线热备份教务数据库 —— 不停机，快照一致
#
# 原理：SQLite 的 `VACUUM INTO '文件'` 在单个读事务里生成一致性副本，
#       因此无需停容器，也不会拿到「写到一半」的中间状态。
#       比直接 cp attendance.db 安全 —— 后者会漏掉 -wal 里未落的页，
#       拷出来的副本单独打开可能是损坏的（除非同时 cp -wal/-shm 三件套）。
#       产物是自包含的完整单文件，恢复时按 restore-db.sh 的流程配套处理即可。
#
# 用法：
#   bash server/scripts/backup-db.sh
#   bash server/scripts/backup-db.sh attendance-server     # 指定容器名
#
# 产物：./server/data/attendance-<时间戳>.db （该目录已被 git 忽略，不会误入库）
# 建议：校区使用时配 Windows 任务计划，每天下班前自动执行保留最近 7 天。

set -euo pipefail

CONTAINER="${1:-attendance-server}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/app/data/attendance-${STAMP}.db"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "✗ 容器 $CONTAINER 未运行，请先启动服务" >&2
  exit 1
fi

# shellcheck disable=SC2016
if ! docker exec "$CONTAINER" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/app/data/attendance.db');
  db.exec(\"VACUUM INTO '${OUT}'\");
  const rows = db.prepare('SELECT COUNT(*) c FROM students').get().c;
  db.close();
  console.log('源库学员数 ' + rows);
" 2>&1 | grep -v -e Warning -e trace-warnings; then
  echo "✗ 备份失败" >&2
  exit 1
fi

HOST_PATH="server/data/attendance-${STAMP}.db"
SIZE="$(du -k "$HOST_PATH" 2>/dev/null | cut -f1)"
echo "✓ 备份完成：$HOST_PATH （${SIZE} KB）"
echo "  恢复方法：bash server/scripts/restore-db.sh $HOST_PATH"
