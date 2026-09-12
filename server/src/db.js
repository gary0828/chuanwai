// 数据库连接（使用 Node 内置 node:sqlite，零原生依赖编译）
// 建表权威定义在 migrations/ 目录，启动时自动执行版本化迁移
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const { migrate } = require("./migrations");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "attendance.db"));

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// 版本化迁移（含建表与结构升级，失败会抛错终止启动）
migrate(db);

module.exports = db;
