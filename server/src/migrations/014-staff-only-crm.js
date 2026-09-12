// v14：员工端 CRM 定调（学生/家长无账号，家长信息并入学生档案）
// 1. users.role CHECK 收紧为 ('admin','teacher')，重建表（保留员工数据，清理历史 student/parent 账号）
// 2. students 删除 user_id 列及唯一索引（v13 账号↔档案关联废弃，学生不登录）
// 3. parent_children 整表删除，绑定关系回填为 students.parent_name / parent_phone（v9 已有字段）
// 4. notifications 重建：target_user_id 删除，新增 parent_name 快照（通知仅内部留痕，不指向任何账号）
module.exports = {
  version: 14,
  name: "员工端 CRM 定调（学生/家长无账号，家长信息并入学生档案）",
  disableForeignKeys: true,
  up(db) {
    // 1. 家长绑定关系回填到学生档案（仅回填空档案；同学生多家长取第一个）
    const binds = db
      .prepare(
        `
        SELECT pc.student_id, u.name AS parent_name, u.phone AS parent_phone
        FROM parent_children pc
        JOIN users u ON u.id = pc.parent_user_id
        WHERE u.role = 'parent'
        ORDER BY pc.id
      `
      )
      .all();
    const backfill = db.prepare(`
      UPDATE students SET parent_name = ?, parent_phone = ?
      WHERE id = ? AND (parent_name IS NULL OR parent_name = '')
    `);
    for (const b of binds) {
      backfill.run(b.parent_name || "", b.parent_phone || "", b.student_id);
    }

    // 2. 重建 notifications：target_user_id → parent_name 快照
    db.exec(`
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT '考勤缺勤' CHECK (type IN ('考勤缺勤', '成绩发布', '请假审批通过')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  parent_name TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO notifications_new (id, student_id, type, title, content, date, parent_name, is_read, created_at)
  SELECT n.id, n.student_id, n.type, n.title, n.content, n.date,
         COALESCE(u.name, ''), n.is_read, n.created_at
  FROM notifications n LEFT JOIN users u ON u.id = n.target_user_id;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
DELETE FROM sqlite_sequence WHERE name = 'notifications';
INSERT INTO sqlite_sequence (name, seq) SELECT 'notifications', MAX(id) FROM notifications;
CREATE INDEX IF NOT EXISTS idx_notifications_student ON notifications (student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications (date);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (is_read);
`);

    // 3. 重建 users：role CHECK 收紧 ('admin','teacher')，仅保留员工账号
    db.exec(`
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('admin', 'teacher')),
  phone TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO users_new (id, username, password_hash, name, role, phone, created_at)
  SELECT id, username, password_hash, name, role, phone, created_at FROM users
  WHERE role IN ('admin', 'teacher');
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
DELETE FROM sqlite_sequence WHERE name = 'users';
INSERT INTO sqlite_sequence (name, seq) SELECT 'users', MAX(id) FROM users;
`);

    // 4. 删除 parent_children 表（绑定关系已并入学生档案）
    db.exec(`DROP TABLE IF EXISTS parent_children;`);

    // 5. students 删除 user_id 列及唯一索引（SQLite 3.35+ 支持 DROP COLUMN）
    db.exec(`
DROP INDEX IF EXISTS idx_students_user_id;
ALTER TABLE students DROP COLUMN user_id;
`);

    // 6. 外键完整性校验
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
