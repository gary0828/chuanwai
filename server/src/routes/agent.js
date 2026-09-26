// AI 教学工作台只读数据网关（调研报告方案 C：教务业务数据留在原库，由原系统只读提供）
//
// 约定：
// 1. 全部端点为只读 GET，复用既有鉴权与数据范围（utils/scope.js）——
//    教师只能取自己带的班，与教务系统内的可见范围严格一致；
// 2. 只返回教学所需字段与聚合结果：**不返回金额**（orders.amount / payments）、
//    不返回家长电话等敏感字段，学生信息只保留编号与姓名（教师本来就可见）；
// 3. 返回 data_version（PRAGMA user_version），工作台记录生成时的数据版本；
// 4. capabilities 声明「真实库里是否已有该类数据」，工作台据此决定展示真实值还是演示内容，
//    避免把「没有数据」渲染成「数据为 0」。
const express = require("express");
const db = require("../db");
const { auth } = require("../middleware/auth");
const { classScopeClause, canManageClass } = require("../utils/scope");
const { attendanceRate } = require("../utils/attendance-rate");

const router = express.Router();

function dataVersion() {
  const row = db.prepare("PRAGMA user_version").get();
  return `v${Number(row.user_version || 0)}`;
}

function hasTable(name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

function tableCount(table) {
  if (!hasTable(table)) return 0;
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
  } catch {
    return 0;
  }
}

/** 真实库当前能提供哪些数据 */
function capabilities() {
  const studentCount = tableCount("students");
  const attendanceCount = tableCount("attendances");
  const scoreCount = tableCount("exam_scores");
  const hourOrderCount = Number(
    db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE total_hours > 0")
      .get().c
  );
  return {
    students: studentCount > 0,
    attendance: attendanceCount > 0,
    scores: scoreCount > 0,
    hours: hourOrderCount > 0,
    // v18 起这三类已有对应表，由 capabilities 如实上报实际是否有数据
    evaluations: tableCount("class_evaluations") > 0,
    knowledge: tableCount("knowledge_points") > 0,
    questions: tableCount("questions") > 0,
    // v18 新增：成长时间轴（学生成长路径的数据地基）
    timeline: tableCount("student_timeline") > 0,
    kpAssessments: tableCount("kp_assessments") > 0
  };
}

/** 工作台启动上下文：身份 + 可见班级 + 能力位 */
router.get("/context", auth, (req, res) => {
  const { clause, params } = classScopeClause(req);

  const classes = db
    .prepare(
      `SELECT c.id, c.name, c.grade,
              (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS student_count
       FROM classes c
       WHERE 1 = 1 ${clause}
       ORDER BY c.id`
    )
    .all(...params);

  const me = db
    .prepare("SELECT id, name, role FROM users WHERE id = ?")
    .get(req.user.id);

  res.json({
    success: true,
    data: {
      user: me ? { id: me.id, name: me.name, role: me.role } : null,
      classes,
      capabilities: capabilities(),
      data_version: dataVersion()
    }
  });
});

/** 班级概览：学员名单 + 考勤 / 成绩 / 课时聚合（教师仅本班） */
router.get("/classes/:id/overview", auth, (req, res) => {
  const classId = Number(req.params.id);
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ success: false, message: "班级 ID 不合法" });
  }

  const cls = db
    .prepare("SELECT id, name, grade FROM classes WHERE id = ?")
    .get(classId);
  if (!cls) {
    return res.status(404).json({ success: false, message: "班级不存在" });
  }
  if (!canManageClass(req, classId)) {
    return res.status(403).json({ success: false, message: "无权查看该班级" });
  }

  // 学员（不含电话、家长信息）
  const studentRows = db
    .prepare(
      `SELECT s.id, s.student_no, s.name, s.gender, s.status, s.enroll_date
       FROM students s WHERE s.class_id = ? ORDER BY s.id`
    )
    .all(classId);

  // 考勤聚合（按学员）
  const attRows = db
    .prepare(
      `SELECT a.student_id,
              COUNT(*) AS total,
              SUM(CASE WHEN a.status = '正常' THEN 1 ELSE 0 END) AS normal,
              SUM(CASE WHEN a.status = '迟到' THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN a.status = '早退' THEN 1 ELSE 0 END) AS early,
              SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN a.status = '请假' THEN 1 ELSE 0 END) AS leave
       FROM attendances a
       JOIN students s ON s.id = a.student_id
       WHERE s.class_id = ?
       GROUP BY a.student_id`
    )
    .all(classId);
  const attMap = new Map(attRows.map(r => [Number(r.student_id), r]));

  // 成绩（按学员，时间正序）
  const scoreRows = db
    .prepare(
      `SELECT es.student_id, e.name AS exam_name, e.exam_date, e.full_score, es.score
       FROM exam_scores es
       JOIN exams e ON e.id = es.exam_id
       JOIN students s ON s.id = es.student_id
       WHERE s.class_id = ?
       ORDER BY e.exam_date, es.id`
    )
    .all(classId);
  const scoreMap = new Map();
  for (const r of scoreRows) {
    const key = Number(r.student_id);
    if (!scoreMap.has(key)) scoreMap.set(key, []);
    scoreMap.get(key).push({
      name: r.exam_name,
      date: r.exam_date,
      full: Number(r.full_score),
      score: Number(r.score),
      rate:
        Number(r.full_score) > 0
          ? Math.round((Number(r.score) / Number(r.full_score)) * 1000) / 10
          : 0
    });
  }

  // 课时（仅数量，不含金额）
  const hourRows = db
    .prepare(
      `SELECT o.student_id,
              SUM(o.total_hours) AS total_hours,
              SUM(o.remain_hours) AS remain_hours
       FROM orders o
       JOIN students s ON s.id = o.student_id
       WHERE s.class_id = ? AND o.status = '在读'
       GROUP BY o.student_id`
    )
    .all(classId);
  const hourMap = new Map(hourRows.map(r => [Number(r.student_id), r]));

  const students = studentRows.map(s => {
    const id = Number(s.id);
    const att = attMap.get(id);
    const total = Number(att?.total || 0);
    const absent = Number(att?.absent || 0);
    const exams = scoreMap.get(id) || [];
    const rates = exams.map(e => e.rate);
    const avgRate = rates.length
      ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10
      : null;
    const trend = rates.length >= 2 ? Math.round((rates[rates.length - 1] - rates[0]) * 10) / 10 : null;
    const hour = hourMap.get(id);

    return {
      id,
      no: s.student_no,
      name: s.name,
      gender: s.gender,
      status: s.status,
      enroll_date: s.enroll_date,
      attendance: {
        total,
        normal: Number(att?.normal || 0),
        late: Number(att?.late || 0),
        early: Number(att?.early || 0),
        absent,
        leave: Number(att?.leave || 0),
        // total=0 时返回 null（工作台据此显示"暂无数据"），故保留外层判空
        rate: total > 0 ? attendanceRate(total, absent) : null
      },
      exams,
      hours: {
        total: Number(hour?.total_hours || 0),
        remain: Number(hour?.remain_hours || 0)
      },
      avg_rate: avgRate,
      trend
    };
  });

  const scored = students.filter(s => s.avg_rate !== null);
  const summary = {
    student_count: students.length,
    attendance_sessions: students.reduce((n, s) => n + s.attendance.total, 0),
    absent_total: students.reduce((n, s) => n + s.attendance.absent, 0),
    score_avg: scored.length
      ? Math.round((scored.reduce((n, s) => n + s.avg_rate, 0) / scored.length) * 10) / 10
      : null,
    excellent_rate: scored.length
      ? Math.round((scored.filter(s => s.avg_rate >= 90).length / scored.length) * 1000) / 10
      : null,
    scored_students: scored.length
  };

  res.json({
    success: true,
    data: {
      class: cls,
      summary,
      students,
      capabilities: capabilities(),
      data_version: dataVersion()
    }
  });
});

module.exports = router;
