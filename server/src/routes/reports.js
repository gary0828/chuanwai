// 学习报告与成长档案：单学员学习报告（考勤/成绩/课时/订单）与成长档案时间线
// 权限：admin 全量；teacher 仅本班学生（classes.head_teacher_id 绑定）
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageStudent } = require("../utils/scope");

const router = express.Router();

/** 校验学员是否当前用户可管理（admin 恒 true；teacher 须为本班学生） */
function canManageStudentReport(req, studentId) {
  return canManageStudent(req, studentId);
}

/** 按得分率计算等级：>=90% 优 / >=80% 良 / >=70% 中 / >=60% 及格 / 否则不及格 */
function calcGrade(score, fullScore) {
  const ratio = fullScore > 0 ? score / fullScore : 0;
  if (ratio >= 0.9) return "优";
  if (ratio >= 0.8) return "良";
  if (ratio >= 0.7) return "中";
  if (ratio >= 0.6) return "及格";
  return "不及格";
}

/** 学习报告：学员档案 + 近 30 天考勤 + 按课程最近成绩 + 课时包 + 在读订单 */
router.get("/students/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const student = db.prepare(`
    SELECT s.student_no, s.name, s.gender, s.status, s.parent_name, s.parent_phone,
           s.source_channel, s.enroll_date, c.name AS class_name
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE s.id = ?
  `).get(id);
  if (!student) return res.status(404).json({ success: false, message: "学员不存在" });
  if (!canManageStudentReport(req, id)) {
    return res.status(403).json({ success: false, message: "无权查看该学员报告" });
  }

  // 近 30 天考勤聚合
  const att = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = '正常' THEN 1 ELSE 0 END) AS normal,
           SUM(CASE WHEN status = '迟到' THEN 1 ELSE 0 END) AS late,
           SUM(CASE WHEN status = '早退' THEN 1 ELSE 0 END) AS early,
           SUM(CASE WHEN status = '缺勤' THEN 1 ELSE 0 END) AS absent,
           SUM(CASE WHEN status = '请假' THEN 1 ELSE 0 END) AS leave
    FROM attendances
    WHERE student_id = ? AND date(date) >= date('now', 'localtime', '-29 days')
  `).get(id);
  const total = Number(att.total || 0);
  const absent = Number(att.absent || 0);
  const attendance = {
    total,
    normal: Number(att.normal || 0),
    late: Number(att.late || 0),
    early: Number(att.early || 0),
    absent,
    leave: Number(att.leave || 0),
    attendance_rate: total > 0 ? Number(((total - absent) / total * 100).toFixed(1)) : 0
  };

  // 成绩：按课程取最近一次（exam_date 最大的一条）
  const scoreRows = db.prepare(`
    SELECT e.course_id, cu.name AS course_name, e.name AS exam_name,
           es.score, e.full_score, e.exam_date
    FROM exam_scores es
    JOIN exams e ON e.id = es.exam_id
    LEFT JOIN courses cu ON cu.id = e.course_id
    WHERE es.student_id = ?
    ORDER BY e.exam_date DESC, es.id DESC
  `).all(id);
  const latestByCourse = new Map();
  for (const r of scoreRows) {
    const key = r.course_id === null || r.course_id === undefined ? "__none__" : String(r.course_id);
    if (!latestByCourse.has(key)) latestByCourse.set(key, r);
  }
  const scores = [...latestByCourse.values()].map(r => ({
    course_name: r.course_name || "未指定课程",
    exam_name: r.exam_name,
    score: Number(r.score),
    full_score: Number(r.full_score),
    exam_date: r.exam_date,
    grade: calcGrade(Number(r.score), Number(r.full_score))
  }));

  // 课时包：在读且设了课时包的订单
  const hours = db.prepare(`
    SELECT o.course_id, COALESCE(cu.name, '未指定课程') AS course_name,
           o.total_hours, o.remain_hours
    FROM orders o
    LEFT JOIN courses cu ON cu.id = o.course_id
    WHERE o.student_id = ? AND o.status = '在读' AND o.total_hours > 0
    ORDER BY o.id
  `).all(id).map(r => {
    const totalHours = Number(r.total_hours);
    const remainHours = Number(r.remain_hours);
    const consumed = totalHours - remainHours;
    return {
      course_name: r.course_name,
      total_hours: totalHours,
      remain_hours: remainHours,
      consumed,
      progress_rate: totalHours > 0 ? Number((consumed / totalHours * 100).toFixed(1)) : 0
    };
  });

  // 在读订单摘要
  const orders = db.prepare(`
    SELECT COALESCE(cu.name, '未指定课程') AS course_name, c.name AS class_name,
           o.amount, o.status, o.enroll_date,
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) AS paid
    FROM orders o
    LEFT JOIN courses cu ON cu.id = o.course_id
    LEFT JOIN classes c ON c.id = o.class_id
    WHERE o.student_id = ? AND o.status = '在读'
    ORDER BY o.id DESC
  `).all(id).map(r => ({
    course_name: r.course_name,
    class_name: r.class_name || "",
    amount: Number(r.amount),
    paid: Number(r.paid || 0),
    status: r.status,
    enroll_date: r.enroll_date
  }));

  res.json({ success: true, data: { student, attendance, scores, hours, orders } });
});

/** 成长档案时间线：入学/报班/缴费/退费/考勤异常/成绩/结业退班，按时间倒序 */
router.get("/students/:id/timeline", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const student = db.prepare("SELECT id FROM students WHERE id = ?").get(id);
  if (!student) return res.status(404).json({ success: false, message: "学员不存在" });
  if (!canManageStudentReport(req, id)) {
    return res.status(403).json({ success: false, message: "无权查看该学员档案" });
  }

  const events = [];

  // 建档 → 入学
  const profile = db.prepare("SELECT created_at FROM students WHERE id = ?").get(id);
  if (profile?.created_at) {
    events.push({ time: profile.created_at, type: "入学", title: "学员建档", content: "建立学员档案" });
  }

  // 报班（orders.created_at）与 结业/退班（orders.updated_at，当前状态直接生成一条）
  const orderRows = db.prepare(`
    SELECT o.created_at, o.updated_at, o.status, COALESCE(cu.name, '未指定课程') AS course_name
    FROM orders o
    LEFT JOIN courses cu ON cu.id = o.course_id
    WHERE o.student_id = ?
  `).all(id);
  for (const o of orderRows) {
    events.push({ time: o.created_at, type: "报班", title: "报名课程", content: o.course_name });
    if (o.status === "结业" || o.status === "退班") {
      events.push({ time: o.updated_at, type: "结业", title: "结业退班", content: `${o.course_name} ${o.status}` });
    }
  }

  // 缴费
  const payRows = db.prepare("SELECT pay_time, amount FROM payments WHERE student_id = ?").all(id);
  for (const p of payRows) {
    events.push({ time: p.pay_time, type: "缴费", title: "缴费记录", content: `缴费 ¥${Number(p.amount)}` });
  }

  // 退费
  const refundRows = db.prepare("SELECT apply_time, amount FROM refunds WHERE student_id = ?").all(id);
  for (const r of refundRows) {
    events.push({ time: r.apply_time, type: "退费", title: "退费记录", content: `退费 ¥${Number(r.amount)}` });
  }

  // 考勤异常
  const attRows = db.prepare(`
    SELECT a.date, COALESCE(cu.name, '未指定课程') AS course_name, a.status
    FROM attendances a
    LEFT JOIN courses cu ON cu.id = a.course_id
    WHERE a.student_id = ? AND a.status IN ('缺勤', '迟到', '早退')
  `).all(id);
  for (const a of attRows) {
    events.push({ time: a.date, type: "考勤", title: "考勤异常", content: `${a.date} ${a.course_name} ${a.status}` });
  }

  // 成绩
  const scoreRows = db.prepare(`
    SELECT es.created_at, e.name AS exam_name, es.score
    FROM exam_scores es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.student_id = ?
  `).all(id);
  for (const s of scoreRows) {
    events.push({ time: s.created_at, type: "成绩", title: "成绩发布", content: `${s.exam_name} ${Number(s.score)}分` });
  }

  // 按时间倒序
  events.sort((a, b) => (String(a.time) < String(b.time) ? 1 : -1));

  res.json({ success: true, data: events });
});

module.exports = router;
