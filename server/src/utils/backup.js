// 数据备份：手动/自动备份 SQLite 数据库，支持列表/恢复/删除
// 备份文件存于 server/data/backups/，自动备份每 6 小时一次，保留最近 20 份
const path = require("path");
const fs = require("fs");
const db = require("../db");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "attendance.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const KEEP_COUNT = 20; // 自动备份最多保留份数

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** 备份文件名格式校验，防止目录穿越 */
function safeName(filename) {
  return typeof filename === "string" && /^backup-\d{8}-\d{6}\.db$/.test(filename);
}

/** 执行一次备份：WAL checkpoint 后复制主库文件，返回备份信息 */
function createBackup() {
  ensureDir();
  // 强制 WAL checkpoint，确保数据全部落盘到主文件
  try {
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } catch (e) {
    // checkpoint 失败不阻断备份（WAL 内容仍可被下次打开时回放）
    console.warn("[backup] wal_checkpoint warn:", e.message);
  }
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const name = `backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
  const target = path.join(BACKUP_DIR, name);
  fs.copyFileSync(DB_PATH, target);
  const stat = fs.statSync(target);

  // 清理超出保留份数的旧备份（按文件名倒序，保留最新的 KEEP_COUNT 份）
  const all = fs.readdirSync(BACKUP_DIR).filter(safeName).sort().reverse();
  for (const old of all.slice(KEEP_COUNT)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }

  return { file: name, size: stat.size, created_at: now.toISOString().slice(0, 19).replace("T", " ") };
}

/** 备份列表（新的在前） */
function listBackups() {
  ensureDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(safeName).sort().reverse();
  return files.map(f => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    return { file: f, size: stat.size, created_at: stat.mtime.toISOString().slice(0, 19).replace("T", " ") };
  });
}

/** 删除备份（校验文件名） */
function deleteBackup(filename) {
  if (!safeName(filename)) {
    const err = new Error("非法的备份文件名");
    err.status = 400;
    throw err;
  }
  const target = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(target)) {
    const err = new Error("备份文件不存在");
    err.status = 404;
    throw err;
  }
  fs.unlinkSync(target);
}

/**
 * 恢复备份：用备份文件覆盖主库（含清理 WAL/SHM 残留），
 * 调用方需在响应后触发进程退出，由容器 restart 策略拉起新进程
 */
function restoreBackup(filename) {
  if (!safeName(filename)) {
    const err = new Error("非法的备份文件名");
    err.status = 400;
    throw err;
  }
  const source = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(source)) {
    const err = new Error("备份文件不存在");
    err.status = 404;
    throw err;
  }
  // 先复制到临时文件，再原子替换主库，避免进程退出前读到半成品
  const tmp = path.join(DATA_DIR, "attendance.restore.tmp");
  fs.copyFileSync(source, tmp);
  fs.renameSync(tmp, DB_PATH);
  for (const suffix of ["-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

/** 定时自动备份（每 6 小时），返回定时器句柄 */
function scheduleAutoBackup() {
  const INTERVAL_MS = 6 * 60 * 60 * 1000;
  const timer = setInterval(() => {
    try {
      const info = createBackup();
      console.log(`[backup] 自动备份完成: ${info.file} (${info.size} bytes)`);
    } catch (e) {
      console.error("[backup] 自动备份失败:", e.message);
    }
  }, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { createBackup, listBackups, deleteBackup, restoreBackup, scheduleAutoBackup };
