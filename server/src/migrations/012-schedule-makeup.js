// v12：排课优化（调课 / 补课 / 冲突检测）
// 1. schedule_adjustments 调课申请表（教师提交调课申请 → 管理员审批 → 事务内同步课表）
// 2. makeup_classes 补课登记表（缺勤/请假学员补课追踪，标记完成联动扣减课时包）
module.exports = {
  version: 12,
  name: "排课优化（调课申请与审批 / 补课管理 / 冲突检测）",
  up(db) {
    // 1. 调课申请表
    db.exec(`
CREATE TABLE IF NOT EXISTS schedule_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  from_day_of_week INTEGER NOT NULL CHECK (from_day_of_week BETWEEN 1 AND 7),
  from_period INTEGER NOT NULL CHECK (from_period BETWEEN 1 AND 8),
  to_day_of_week INTEGER NOT NULL CHECK (to_day_of_week BETWEEN 1 AND 7),
  to_period INTEGER NOT NULL CHECK (to_period BETWEEN 1 AND 8),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待审批' CHECK (status IN ('待审批', '通过', '驳回')),
  apply_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approve_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  apply_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  approve_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_adj_status ON schedule_adjustments (status);
CREATE INDEX IF NOT EXISTS idx_adj_class ON schedule_adjustments (class_id);
CREATE INDEX IF NOT EXISTS idx_adj_schedule ON schedule_adjustments (schedule_id);
`);

    // 2. 补课登记表（original_date 关联缺勤/请假考勤日期；标记完成联动扣减课时包）
    db.exec(`
CREATE TABLE IF NOT EXISTS makeup_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  original_date TEXT NOT NULL,
  makeup_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待安排' CHECK (status IN ('待安排', '已完成')),
  remark TEXT NOT NULL DEFAULT '',
  apply_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_makeup_student ON makeup_classes (student_id);
CREATE INDEX IF NOT EXISTS idx_makeup_status ON makeup_classes (status);
CREATE INDEX IF NOT EXISTS idx_makeup_date ON makeup_classes (makeup_date);
`);

    // 3. 外键完整性校验
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
