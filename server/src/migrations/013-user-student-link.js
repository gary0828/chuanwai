// v13：统一用户与全模块联动（数据一致性全面修复）
// 1. students.user_id 唯一外键：账号（users）↔ 学籍档案（students）一对一
// 2. 存量学生自动补建 student 账号（username=学号，占位密码 123456；学生暂不可登录）
// 3. leaves.source：请假来源（手动 / 考勤同步），支撑考勤↔请假双向联动
// 4. settings.term_id 僵尸键清理（与 terms.is_current 双数据源，全库无消费）
// 5. notifications.type 扩展支持 '请假审批通过'（请假审批通过后通知绑定家长）
const bcrypt = require("bcryptjs");

module.exports = {
  version: 13,
  name: "统一用户与联动（账号档案关联/考勤请假联动/删除保护）",
  disableForeignKeys: true,
  up(db) {
    // 1. students 增加 user_id 唯一列 + leaves 增加 source
    db.exec(`
      ALTER TABLE students ADD COLUMN user_id INTEGER;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
      ALTER TABLE leaves ADD COLUMN source TEXT NOT NULL DEFAULT '手动';
    `);

    // 2. 演示账号 s2023001（陈伟）与档案 2023001（陈伟）按姓名+学号匹配关联
    const demo = db.prepare("SELECT id FROM users WHERE username = 's2023001'").get();
    if (demo) {
      const profile = db
        .prepare("SELECT id FROM students WHERE student_no = '2023001' AND user_id IS NULL")
        .get();
      if (profile) {
        db.prepare("UPDATE students SET user_id = ? WHERE id = ?").run(demo.id, profile.id);
      }
    }

    // 3. 存量无账号学生补建 student 账号并回填（username=学号；学号全局唯一）
    const orphans = db
      .prepare("SELECT id, student_no, name FROM students WHERE user_id IS NULL")
      .all();
    const insertUser = db.prepare(
      "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, 'student')"
    );
    const linkUser = db.prepare("UPDATE students SET user_id = ? WHERE id = ?");
    for (const s of orphans) {
      try {
        const info = insertUser.run(String(s.student_no), bcrypt.hashSync("123456", 10), s.name);
        linkUser.run(info.lastInsertRowid, s.id);
      } catch (err) {
        // username 已被占用（历史账号）：复用该账号回填
        if (String(err.message).includes("UNIQUE")) {
          const exist = db.prepare("SELECT id FROM users WHERE username = ?").get(String(s.student_no));
          if (exist) linkUser.run(exist.id, s.id);
          continue;
        }
        throw err;
      }
    }

    // 4. 清理 settings.term_id 僵尸键（terms.is_current 为唯一当前学期数据源）
    db.prepare("DELETE FROM settings WHERE key = 'term_id'").run();

    // 5. 重建 notifications：type CHECK 扩展 '请假审批通过'（与 v11 重建模式一致）
    db.exec(`
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT '考勤缺勤' CHECK (type IN ('考勤缺勤', '成绩发布', '请假审批通过')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO notifications_new (id, student_id, type, title, content, date, target_user_id, is_read, created_at)
  SELECT id, student_id, type, title, content, date, target_user_id, is_read, created_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
DELETE FROM sqlite_sequence WHERE name = 'notifications';
INSERT INTO sqlite_sequence (name, seq) SELECT 'notifications', MAX(id) FROM notifications;
CREATE INDEX IF NOT EXISTS idx_notifications_student ON notifications (student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications (date);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (is_read);
`);

    // 6. 外键完整性校验
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
