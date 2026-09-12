// v11：教学结果与课时消耗
// 1. exams 考试表 + exam_scores 成绩表（成绩/测评管理，学习报告与成长档案的数据基础）
// 2. hour_consumptions 课时消耗流水表（考勤扣减/回补落流水，课消统计与收入确认的数据基础）
// 3. 重建 notifications：type CHECK 扩展支持 '成绩发布'（成绩录入后通知绑定家长）
module.exports = {
  version: 11,
  name: "教学结果与课消（成绩/学习报告/成长档案/课时消耗流水）",
  disableForeignKeys: true,
  up(db) {
    // 1. 考试表
    db.exec(`
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  exam_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  type TEXT NOT NULL DEFAULT '单元测' CHECK (type IN ('单元测', '期中', '期末')),
  full_score REAL NOT NULL DEFAULT 100,
  remark TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_exams_class ON exams (class_id);
CREATE INDEX IF NOT EXISTS idx_exams_date ON exams (exam_date);
`);

    // 2. 成绩表（UNIQUE exam_id+student_id 保证一考一成绩，批量录入冲突覆盖）
    db.exec(`
CREATE TABLE IF NOT EXISTS exam_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_scores_student ON exam_scores (student_id);
`);

    // 3. 课时消耗流水表（扣减为正 / 回补为负，date 为考勤日期）
    db.exec(`
CREATE TABLE IF NOT EXISTS hour_consumptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('扣减', '回补')),
  operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_hour_cons_order ON hour_consumptions (order_id);
CREATE INDEX IF NOT EXISTS idx_hour_cons_student_date ON hour_consumptions (student_id, date);
CREATE INDEX IF NOT EXISTS idx_hour_cons_course ON hour_consumptions (course_id);
`);

    // 4. 重建 notifications：type CHECK 扩展 '成绩发布'（与 v2/v10 users 重建模式一致）
    db.exec(`
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT '考勤缺勤' CHECK (type IN ('考勤缺勤', '成绩发布')),
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

    // 5. 外键完整性校验
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
