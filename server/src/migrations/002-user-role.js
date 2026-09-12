// v2：users 表支持 student 角色
// SQLite 无法直接修改 CHECK 约束，采用「重建表 + 数据搬迁」：
// 1. 先备份原 users 表为 users_backup_v1（历史可回溯）
// 2. 新建 users_new（role 扩展 student），搬移数据后替换原表
// 3. 恢复自增序列，保证后续新增用户 id 不冲突
// 注意：PRAGMA foreign_keys 在事务内为 no-op，因此由迁移执行器
//      （migrations/index.js）根据 disableForeignKeys 标志在事务外切换
module.exports = {
  version: 2,
  name: "users 角色支持 student",
  disableForeignKeys: true,
  up(db) {
    // 1. 快照备份（仅首次创建，重复执行不覆盖）
    db.exec("CREATE TABLE IF NOT EXISTS users_backup_v1 AS SELECT * FROM users");

    // 2. 新建扩展表并搬移数据（保留原 id）
    db.exec(`
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('admin', 'teacher', 'student')),
  phone TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO users_new (id, username, password_hash, name, role, phone, created_at)
  SELECT id, username, password_hash, name, role, phone, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
`);

    // 3. 恢复自增序列（DROP 会清除 sqlite_sequence 中 users 记录）
    db.exec(`
DELETE FROM sqlite_sequence WHERE name = 'users';
INSERT INTO sqlite_sequence (name, seq) SELECT 'users', MAX(id) FROM users;
`);

    // 4. 外键完整性校验（leaves.approved_by / user_oauth.user_id 应仍指向 users）
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
