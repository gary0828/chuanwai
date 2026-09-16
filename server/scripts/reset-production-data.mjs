#!/usr/bin/env node
/**
 * 清空全部业务测试数据，只保留一个 admin 账号 —— 用于交付前的「出厂设置」。
 *
 * 用法：
 *   node server/scripts/reset-production-data.mjs              # 预览：只打印将要清空什么
 *   node server/scripts/reset-production-data.mjs --confirm    # 真正执行
 *
 * 安全设计：
 *   1. 执行前自动用 VACUUM INTO 做一份完整快照备份（不停机、快照一致）
 *   2. 默认只预览不执行，必须显式 --confirm
 *   3. 用「排除法」定义保留名单，新增的业务表会自动被清掉，不会遗漏
 *
 * 保留：users 表里的 admin 账号、terms（当前学期，签到等功能依赖）、settings（系统配置）
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const DB = process.env.DB_PATH || "server/data/attendance.db";
const CONFIRM = process.argv.includes("--confirm");

/** 保留名单：这些表不动；users 只保留 admin 行 */
const KEEP_TABLES = new Set(["terms", "settings"]);
const KEEP_USER = "admin";

if (!existsSync(DB)) {
  console.error(`✗ 找不到数据库：${DB}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const backupPath = DB.replace(/\.db$/, "") + `-before-reset-${stamp}.db`;

const db = new DatabaseSync(DB);

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all()
  .map(r => r.name);

const toClear = tables.filter(t => t !== "users" && !KEEP_TABLES.has(t));
const counts = {};
for (const t of tables) {
  try {
    counts[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  } catch {
    counts[t] = 0;
  }
}

console.log("=== 将要执行的操作 ===");
console.log(`保留：${[...KEEP_TABLES].join(", ")}、users 里的 ${KEEP_USER}`);
console.log("清空：");
for (const t of toClear) console.log(`  - ${t.padEnd(22)} ${counts[t]} 行`);
console.log(`  - users（除 ${KEEP_USER} 外全部删除）  当前 ${counts.users} 个账号`);

if (!CONFIRM) {
  console.log("\n这是预览模式。确认无误后加 --confirm 执行。");
  db.close();
  process.exit(0);
}

// ① 先备份
db.exec(`VACUUM INTO '${backupPath}'`);
console.log(`\n✓ 已备份：${backupPath}`);

// ② 清空
// 「整库清空」不关心父子表顺序，逐表 DELETE 会被外键 RESTRICT 拦下，
// 因此先关闭外键约束（SQLite 的 foreign_keys 是连接级开关，必须在事务外设置）。
db.exec("PRAGMA foreign_keys = OFF");
db.exec("BEGIN");
try {
  for (const t of toClear) db.exec(`DELETE FROM "${t}"`);
  db.exec(`DELETE FROM users WHERE username <> '${KEEP_USER}'`);
  // 自增序列归零，让新数据的 ID 从 1 开始，交付给客户时更干净
  try {
    db.exec("DELETE FROM sqlite_sequence");
  } catch {
    /* 无 AUTOINCREMENT 表时不存在此表，忽略 */
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  db.exec("PRAGMA foreign_keys = ON");
  console.error("✗ 清空失败，已回滚：", err.message);
  db.close();
  process.exit(1);
}
db.exec("PRAGMA foreign_keys = ON");

// ②-b 清完必须复核外键完整性（关掉约束就有可能留下孤儿，这里确认没有）
const broken = db.prepare("PRAGMA foreign_key_check").all();
if (broken.length) {
  console.error("✗ 存在外键不完整的行：", JSON.stringify(broken.slice(0, 5)));
  db.close();
  process.exit(1);
}

// ③ 复核
const left = {};
for (const t of tables) {
  try {
    left[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  } catch {
    left[t] = 0;
  }
}
console.log("\n=== 执行后剩余 ===");
for (const [t, c] of Object.entries(left)) if (c > 0) console.log(`  ${t.padEnd(22)} ${c}`);

const admins = db.prepare("SELECT username, role FROM users").all();
console.log("\n账号：", JSON.stringify(admins));
console.log(`库版本：v${db.prepare("PRAGMA user_version").get().user_version}`);
db.close();
console.log("\n✓ 已恢复出厂状态（仅保留 admin 账号）");
