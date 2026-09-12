// v9：课时与招生（订单课时包 / 招生线索 / 学员档案扩展）
// 1) orders 增 total_hours / remain_hours（课时包，考勤联动扣减）
// 2) students 增家长信息 / 来源渠道 / 报名日期（档案扩展）
// 3) 新增 leads 招生线索表（渠道/跟进/转化）
module.exports = {
  version: 9,
  name: "课时与招生（课时包/线索/档案扩展）",
  up(db) {
    db.exec(`
ALTER TABLE orders ADD COLUMN total_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN remain_hours REAL NOT NULL DEFAULT 0;

ALTER TABLE students ADD COLUMN parent_name TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN parent_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN source_channel TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN enroll_date TEXT NOT NULL DEFAULT '';

-- 招生线索：获客 → 跟进 → 转化（转化时自动创建学员档案与报班订单）
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  intent_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT '转介绍' CHECK (source IN ('转介绍', '线上', '地推', '广告')),
  follow_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  follow_records TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT '新线索' CHECK (status IN ('新线索', '跟进中', '已转化', '已流失')),
  converted_student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
`);
  }
};
