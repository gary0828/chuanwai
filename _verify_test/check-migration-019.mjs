// 迁移 019 独立校验：在临时库上跑一遍，确认 SQL 合法、索引与约束按预期生效
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "_tmp", "mig019-test.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.rmSync(dbPath, { force: true });

const m = require("../server/src/migrations/019-todos.js");
console.log(`迁移 v${m.version} · ${m.name}`);

const db = new DatabaseSync(dbPath);
// 造最小前置表（todos 对 users 有外键）
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  INSERT INTO users (name) VALUES ('张三'), ('李四');
`);

m.up(db);
console.log("✅ up(db) 执行成功");

// 表结构
const cols = db.prepare("PRAGMA table_info(todos)").all().map(c => c.name);
console.log("✅ 字段:", cols.join(", "));
const expect = ["id","title","content","owner_id","creator_id","source","source_type","source_ref_id","status","priority","due_date","completed_at","created_at","updated_at"];
const missing = expect.filter(c => !cols.includes(c));
console.log(missing.length ? `❌ 缺字段: ${missing}` : "✅ 字段齐全");

// 索引
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='todos'").all();
console.log("✅ 索引:");
for (const i of idx) console.log("   " + i.name);

// 幂等去重键必须生效
const ins = db.prepare(
  "INSERT INTO todos (title, owner_id, source, source_type, source_ref_id) VALUES (?, ?, 'auto', ?, ?)"
);
ins.run("余额不足-A", 1, "tuition_low", 10);
let dupBlocked = false;
try {
  ins.run("余额不足-A 重复", 1, "tuition_low", 10);
} catch (e) {
  dupBlocked = /UNIQUE/i.test(String(e.message));
}
console.log(dupBlocked ? "✅ 幂等键生效（同来源+同负责人重复插入被拒）" : "❌ 幂等键未生效");

// 不同负责人 / 不同来源应可插入
ins.run("余额不足-A 换人", 2, "tuition_low", 10);
ins.run("另一来源", 1, "absent_streak", 10);
console.log("✅ 不同负责人/不同来源均可插入（当前 " + db.prepare("SELECT COUNT(*) AS n FROM todos").get().n + " 条）");

// 手工待办不受幂等键约束（source_type 为空）
db.prepare("INSERT INTO todos (title, owner_id) VALUES ('手工1', 1)").run();
db.prepare("INSERT INTO todos (title, owner_id) VALUES ('手工2', 1)").run();
console.log("✅ 手工待办可重复插入（不受部分索引约束）");

// CHECK 约束
for (const [sql, label] of [
  ["INSERT INTO todos (title, owner_id, status) VALUES ('x', 1, '乱填')", "status"],
  ["INSERT INTO todos (title, owner_id, priority) VALUES ('x', 1, '乱填')", "priority"],
  ["INSERT INTO todos (title, owner_id, source) VALUES ('x', 1, '乱填')", "source"],
]) {
  let blocked = false;
  try { db.exec(sql); } catch { blocked = true; }
  console.log(blocked ? `✅ CHECK 拦住非法 ${label}` : `❌ CHECK 未拦住 ${label}`);
}

db.close();
fs.rmSync(dbPath, { force: true });
console.log("\n迁移 019 校验通过");
