// v8：财务管理（报班订单 / 收费记录 / 退费记录）
// 打通「报名 → 缴费 → 退费」主链路；存量学生通过幂等 INSERT 补默认报班订单，不破坏现有数据
module.exports = {
  version: 8,
  name: "财务管理（订单/缴费/退费）",
  up(db) {
    db.exec(`
-- 报班订单：学员"购买/报名"班级与课程的业务记录
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  enroll_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT '在读' CHECK (status IN ('在读', '结业', '退班')),
  enroll_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_student ON orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_enroll_date ON orders(enroll_date);

-- 收费记录：每笔实收，挂靠订单
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK (amount > 0),
  pay_method TEXT NOT NULL DEFAULT '转账' CHECK (pay_method IN ('现金', '转账', '扫码')),
  pay_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pay_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_time ON payments(pay_time);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);

-- 退费记录：申请 → 审批
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待审批' CHECK (status IN ('待审批', '通过', '驳回')),
  apply_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  apply_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  approve_time TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

-- 存量学生补默认报班订单（幂等：仅给尚无订单的学生建档）
INSERT INTO orders (student_id, class_id, course_id, status, enroll_date, remark, created_at)
SELECT s.id, s.class_id, NULL, '在读', s.created_at, '历史学员自动建档', s.created_at
FROM students s
LEFT JOIN orders o ON o.student_id = s.id
WHERE o.id IS NULL;
`);
  }
};
