// v10：家校与经营报表
// 1. users.role 支持 parent（家长角色），重建表并保留数据（与 v2 同模式）
// 2. 新增 parent_children：家长账号 ↔ 学员 绑定关系（家校通知推送对象）
// 3. 新增 notifications：通知记录表（考勤缺勤联动生成，管理端可查可标记已读）
module.exports = {
  version: 10,
  name: "家校与经营报表（家长角色/绑定/通知）",
  disableForeignKeys: true,
  up(db) {
    // 1. 重建 users 表：role CHECK 扩展 parent
    db.exec(`
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
  phone TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO users_new (id, username, password_hash, name, role, phone, created_at)
  SELECT id, username, password_hash, name, role, phone, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
DELETE FROM sqlite_sequence WHERE name = 'users';
INSERT INTO sqlite_sequence (name, seq) SELECT 'users', MAX(id) FROM users;
`);

    // 2. 家长-学员绑定表
    db.exec(`
CREATE TABLE IF NOT EXISTS parent_children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (parent_user_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_children_parent ON parent_children (parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_children_student ON parent_children (student_id);
`);

    // 3. 通知记录表（type 预留扩展：考勤缺勤 / 缴费到账 / 课时预警等）
    db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT '考勤缺勤' CHECK (type IN ('考勤缺勤')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_student ON notifications (student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications (date);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (is_read);
`);

    // 4. 外键完整性校验
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
