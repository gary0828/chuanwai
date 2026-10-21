// 数据库连接（使用 Node 内置 node:sqlite，零原生依赖编译）
// 建表权威定义在 migrations/ 目录，启动时自动执行版本化迁移
//
// ★ 2026-10-18（深度测试 P1-5 / P2-10 / P2-11）：
//   1. 数据目录统一走 `utils/paths`（唯一解析入口），不再自己拼 `DATA_DIR || server/data`；
//   2. 执行迁移前先 `VACUUM INTO` 一份一致性快照到 backupsDir（迁移失败可回退），
//      失败只告警不阻断启动（运维需在日志里看到醒目提示）；
//   3. 增加 `PRAGMA busy_timeout=5000`，并发写时等待锁而不是立刻抛 SQLITE_BUSY。
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const { dataDir, dbPath, backupsDir } = require("./utils/paths");
const {
  migrate,
  latestVersion,
  currentVersion,
  pending
} = require("./migrations");

// 数据目录可能不存在（首次部署 / 隔离测试的 DATA_DIR），先建出来
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);

// 等待锁的超时（毫秒）：node:sqlite 是同步 API，多连接/多进程并发写时
// 默认会立刻抛 SQLITE_BUSY；5 秒与 SQLite 官方 CLI 默认一致，足够覆盖短事务。
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ── 迁移前自动备份（P2-10）────────────────────────────────────────────
// 迁移是「改库」操作，一旦中途/后续发现迁移有误，没有迁移前快照就只能靠人工翻旧备份。
// 命名 `pre-migrate-v<from>-to-<latest>-<ts>.db`；只保留最近 5 份（避免多次升级堆积）。
const PRE_MIGRATE_KEEP = 5;
const PRE_MIGRATE_RE = /^pre-migrate-v\d+-to-v\d+-\d{8}-\d{6}\.db$/;

/** 本地时间戳（与 utils/backup.js 的备份文件名口径一致，便于运维对时） */
function backupStamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** 只清理本模块生成的 pre-migrate 快照，绝不动用户手动备份（backup-*.db） */
function prunePreMigrateBackups() {
  try {
    const files = fs
      .readdirSync(backupsDir)
      .filter(f => PRE_MIGRATE_RE.test(f))
      .sort()
      .reverse();
    for (const old of files.slice(PRE_MIGRATE_KEEP)) {
      try {
        fs.unlinkSync(path.join(backupsDir, old));
      } catch {
        /* 清理失败不影响启动 */
      }
    }
  } catch {
    /* 目录不可读时忽略（下一步备份会暴露真实错误） */
  }
}

/**
 * 存在待执行迁移时，先把当前库快照到 backupsDir。返回备份文件名或 null。
 * 全新库（v0，还没有任何业务表）没有可丢的数据，跳过以免产生无意义文件。
 */
function preMigrateBackup() {
  const todo = pending(db);
  if (todo.length === 0) return null; // 已是最新版本，无需备份

  const from = currentVersion(db);
  if (from === 0) {
    console.log(
      `[migrate-backup] 全新数据库（v0 → v${latestVersion}），无历史数据可备份，跳过`
    );
    return null;
  }

  const name = `pre-migrate-v${from}-to-v${latestVersion}-${backupStamp()}.db`;
  const target = path.join(backupsDir, name);
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    // VACUUM INTO 要求目标文件不存在（同一秒重复启动时先清残片）
    if (fs.existsSync(target)) fs.unlinkSync(target);
    // 路径里的单引号需转义，避免 SQL 拼接异常
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    prunePreMigrateBackups();
    const size = fs.statSync(target).size;
    console.log(
      `[migrate-backup] 迁移前已备份 v${from} → ${name}（${size} bytes）`
    );
    return name;
  } catch (e) {
    // ★ 失败只告警、不阻断启动：备份失败（如磁盘满/权限）时如果直接拒绝启动，
    //   会把「可用的旧服务」也停掉；但必须留下醒目日志供人工确认。
    console.error(
      `[migrate-backup] ⚠ 迁移前备份失败，仍将继续执行 v${from} → v${latestVersion} 迁移：${e.message}`
    );
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target); // 清掉半成品，避免被误当可用备份
      } catch {
        /* 清理失败不掩盖原始错误 */
      }
    }
    return null;
  }
}

try {
  preMigrateBackup();
} catch (e) {
  // 备份流程自身的意外异常也不能阻断启动（例如 fs.mkdirSync 抛错）
  console.error(
    `[migrate-backup] ⚠ 迁移前备份流程异常（继续启动）：${e.message}`
  );
}

// 版本化迁移（含建表与结构升级，失败会抛错终止启动）
migrate(db);

module.exports = db;
