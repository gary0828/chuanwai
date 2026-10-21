// 数据备份：手动/自动备份 SQLite 数据库，支持列表/恢复/删除
//
// ★ 2026-10-18（深度测试 P1-5 / P2-7 / 备份恢复安全）：
//   · 所有路径统一走 `utils/paths`（唯一解析入口）。此前这里硬编码 `server/data`，
//     用 `DATA_DIR` 起隔离/测试实例时会「备份到主目录、恢复覆盖主库」（假恢复），
//     上传头像甚至清理掉主目录的旧文件 —— 已实测，属 P1。
//   · 恢复前先用**只读连接**做 `PRAGMA integrity_check` + 版本校验：
//     备份的 `user_version` 不得高于当前代码的 `latestVersion`，且必须含核心表，
//     否则拒绝恢复（400 中文提示），目标固定为 `paths.dbPath`。
//   · 备份/恢复的路径解析与自动备份策略（每 6 小时、保留 20 份）保持不变。
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { dataDir, dbPath, backupsDir } = require("./paths");
const { latestVersion } = require("../migrations");

const KEEP_COUNT = 20; // 自动备份最多保留份数

function ensureDir() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

/** 备份文件名格式校验，防止目录穿越 */
function safeName(filename) {
  return (
    typeof filename === "string" && /^backup-\d{8}-\d{6}\.db$/.test(filename)
  );
}

/** 构造一个带 HTTP 状态码的错误（统一错误处理中间件会尊重 err.status） */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** 执行一次备份：用 VACUUM INTO 生成一致性快照，返回备份信息
 *
 * ★ 2026-09-26 改造（统一安全实现）：
 *   原实现 = `wal_checkpoint(TRUNCATE)` + `fs.copyFileSync`。
 *   而本项目的运维脚本 backup-db.sh 一直用 `VACUUM INTO`，其注释明确指出
 *   「直接 copy 会漏掉 -wal 里未落的页，拷出来的副本可能是损坏的」——
 *   即应用内这套正是被批评的做法。两套机制写同一件事却用不同技术，属口径分叉。
 *   现统一为 `VACUUM INTO`：单读事务内生成自包含快照，不停机、不受并发写入影响。
 *   （顺带去掉了 wal_checkpoint(TRUNCATE) —— VACUUM INTO 本身读一致视图，无需先清 WAL。）
 */
function createBackup() {
  ensureDir();
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const name = `backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
  const target = path.join(backupsDir, name);

  // VACUUM INTO 要求目标文件不存在；同一秒内重复调用时先清掉同名残片
  if (fs.existsSync(target)) fs.unlinkSync(target);

  try {
    // 路径内的单引号需转义，避免 SQL 拼接异常
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (e) {
    // 失败时清掉可能产生的半成品，避免被 listBackups 当成可用备份（恢复它等于恢复损坏库）
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch {
        /* 清理失败不掩盖原始错误 */
      }
    }
    throw e;
  }

  const stat = fs.statSync(target);

  // 清理超出保留份数的旧备份（按文件名倒序，保留最新的 KEEP_COUNT 份）
  const all = fs.readdirSync(backupsDir).filter(safeName).sort().reverse();
  for (const old of all.slice(KEEP_COUNT)) {
    fs.unlinkSync(path.join(backupsDir, old));
  }

  return {
    file: name,
    size: stat.size,
    created_at: now.toISOString().slice(0, 19).replace("T", " ")
  };
}

/** 备份列表（新的在前；只列用户备份 backup-*.db，迁移前快照不在此暴露） */
function listBackups() {
  ensureDir();
  const files = fs.readdirSync(backupsDir).filter(safeName).sort().reverse();
  return files.map(f => {
    const stat = fs.statSync(path.join(backupsDir, f));
    return {
      file: f,
      size: stat.size,
      created_at: stat.mtime.toISOString().slice(0, 19).replace("T", " ")
    };
  });
}

/** 删除备份（校验文件名；只允许删 backupsDir 下的 backup-*.db） */
function deleteBackup(filename) {
  if (!safeName(filename)) {
    throw httpError(400, "非法的备份文件名");
  }
  const target = path.join(backupsDir, filename);
  if (!fs.existsSync(target)) {
    throw httpError(404, "备份文件不存在");
  }
  fs.unlinkSync(target);
}

/**
 * 恢复前校验（P1-5 要求的恢复安全前置条件）：
 *  1) 文件存在、非空、大小合理；
 *  2) 只读连接打开，`PRAGMA integrity_check` 必须返回 ok（不是「有个文件就行」）；
 *  3) 备份的 user_version 不得高于当前代码的 latestVersion（否则等于把新结构
 *     硬塞给旧代码，启动迁移/查询会直接崩）；
 *  4) 必须含核心数据表 `users`（拦住「随手一个 SQLite 文件」）。
 *
 * 任何一条不满足 → 抛带中文 message 的 400/404，绝不裸抛 500。
 * @returns {{ version: number }}
 */
function assertBackupRestorable(source) {
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    throw httpError(404, "备份文件不存在");
  }
  if (!stat.isFile() || stat.size < 512) {
    throw httpError(
      400,
      "备份文件为空或过小（不是有效的数据库文件），已拒绝恢复"
    );
  }

  let probe = null;
  try {
    probe = new DatabaseSync(source, { readOnly: true });
    const rows = probe.prepare("PRAGMA integrity_check").all();
    const ok =
      rows.length === 1 &&
      String(
        rows[0].integrity_check || rows[0][Object.keys(rows[0])[0]] || ""
      ).toLowerCase() === "ok";
    if (!ok) {
      throw httpError(
        400,
        "备份文件完整性校验未通过（文件可能损坏），已拒绝恢复"
      );
    }

    const version =
      Number(probe.prepare("PRAGMA user_version").get().user_version) || 0;
    if (version > latestVersion) {
      throw httpError(
        400,
        `备份来自更高版本的代码（数据库 v${version}），当前服务最高支持 v${latestVersion}，请升级服务后再恢复`
      );
    }
    if (version <= 0) {
      throw httpError(400, "备份文件缺少数据库版本信息（v0），已拒绝恢复");
    }

    const core = probe
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users'"
      )
      .get();
    if (!core) {
      throw httpError(
        400,
        "备份文件内容异常（缺少核心数据表 users），已拒绝恢复"
      );
    }
    return { version };
  } catch (e) {
    if (e && Number.isInteger(e.status)) throw e; // 上面主动抛的 400/404 原样上抛
    // SQLite 打开失败 / 损坏 / 加密：统一转中文 400，避免英文原文与裸 500
    const raw = String(e?.message || e);
    const message = /not a database|encrypted|malformed|corrupt/i.test(raw)
      ? "备份文件不是有效的 SQLite 数据库或已损坏，已拒绝恢复"
      : `备份文件校验失败，已拒绝恢复：${raw}`;
    throw httpError(400, message);
  } finally {
    if (probe) {
      try {
        probe.close();
      } catch {
        /* 关闭失败无影响 */
      }
    }
  }
}

/**
 * 恢复备份：校验通过后，用备份文件覆盖主库（含清理 WAL/SHM 残留）。
 * - 目标固定为 `paths.dbPath`（尊重 DATA_DIR），不再硬编码主库；
 * - 先复制到临时文件，再原子替换主库，避免进程退出前读到半成品；
 * - 校验失败抛 400/404，写库失败抛 500 中文提示，调用方可直接转成 JSON。
 * 调用方需在响应后触发进程退出，由容器 restart 策略拉起新进程。
 */
function restoreBackup(filename) {
  if (!safeName(filename)) {
    throw httpError(400, "非法的备份文件名");
  }
  const source = path.join(backupsDir, filename);
  const { version } = assertBackupRestorable(source);

  const tmp = path.join(dataDir, "attendance.restore.tmp");
  try {
    fs.copyFileSync(source, tmp);
    fs.renameSync(tmp, dbPath);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* 清理失败不掩盖原始错误 */
    }
    throw httpError(500, `恢复失败（写入数据库文件出错）：${e.message}`);
  } finally {
    // 目标库被替换后，旧 WAL/SHM 属于旧库，必须清掉，否则新库可能读到旧日志
    for (const suffix of ["-wal", "-shm"]) {
      const f = dbPath + suffix;
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* 进程即将退出，忽略 */
        }
      }
    }
  }
  return { file: filename, version };
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

module.exports = {
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  assertBackupRestorable,
  scheduleAutoBackup
};
