// v4：课程表（班级 × 星期 × 节次 的课程安排，考勤登记时自动带出课程）
// 表 schedules：一个班级在某个星期的某个节次安排一门课程
module.exports = {
  version: 4,
  name: "课程表管理",
  up(db) {
    db.exec(`
      CREATE TABLE schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
        period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 8),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE (class_id, course_id, day_of_week, period)
      );
      CREATE INDEX idx_schedules_class_day ON schedules (class_id, day_of_week);
    `);
  }
};
