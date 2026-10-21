// 首页考勤看板统计（数据权限：教师仅统计自己负责的班级；管理员不限）
// ★ G2（2026-10-18 P1-4 修复）：教师口径统一为 utils/scope.js 的
//   「班主任 OR 任课教师」，不再只按 classes.head_teacher_id 内联过滤 ——
//   与学员列表 / 请假 / 通知 / 考试成绩等模块保持一致。
const express = require("express");
const db = require("../db");
const { auth } = require("../middleware/auth");
const { classScopeClause, teacherClassPredicate } = require("../utils/scope");

const router = express.Router();

function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 教师考勤过滤：attendances 仅限「班主任 OR 任课教师」班级的学生（a 为 attendances 别名） */
function attendanceScopeClause(req) {
  if (req.user.role !== "teacher") return { clause: "", params: [] };
  return {
    clause: ` AND a.student_id IN (
      SELECT s.id FROM students s
      WHERE s.class_id IN (SELECT c.id FROM classes c WHERE ${teacherClassPredicate("c")})
    )`,
    params: [req.user.id, req.user.id]
  };
}

/** 首页概览：今日统计卡片 + 近 7 日趋势 + 全部记录状态占比 */
router.get("/overview", auth, (req, res) => {
  const today = todayStr();
  const scope = attendanceScopeClause(req);
  const classScope = classScopeClause(req);
  const isTeacher = req.user.role === "teacher";

  // 今日统计卡片
  // ★ 软删口径（v30）：当前在读人数/班级数属「名单类」统计，必须排除已归档学员
  const studentTotal = isTeacher
    ? db
        .prepare(
          `SELECT COUNT(*) AS c FROM students s
           JOIN classes c ON s.class_id = c.id
           WHERE s.status = '在读' AND s.deleted_at IS NULL${classScope.clause}`
        )
        .get(...classScope.params).c
    : db
        .prepare(
          "SELECT COUNT(*) AS c FROM students WHERE status = '在读' AND deleted_at IS NULL"
        )
        .get().c;
  const classTotal = isTeacher
    ? db
        .prepare(
          `SELECT COUNT(*) AS c FROM classes c WHERE 1=1${classScope.clause}`
        )
        .get(...classScope.params).c
    : db.prepare("SELECT COUNT(*) AS c FROM classes").get().c;
  const courseTotal = db.prepare("SELECT COUNT(*) AS c FROM courses").get().c;
  const todayRows = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = '缺勤' THEN 1 ELSE 0 END) AS absent,
         SUM(CASE WHEN status = '请假' THEN 1 ELSE 0 END) AS leave,
         SUM(CASE WHEN status IN ('正常', '迟到', '早退') THEN 1 ELSE 0 END) AS present
       FROM attendances a WHERE a.date = ?${scope.clause}`
    )
    .get(today, ...scope.params);
  const todayStat = {
    total: Number(todayRows.total || 0),
    present: Number(todayRows.present || 0),
    absent: Number(todayRows.absent || 0),
    leave: Number(todayRows.leave || 0)
  };

  // 近 7 日趋势（含今天的最近 7 天，逐天列出，无记录补 0）
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const date = todayStr(-i);
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = '正常' THEN 1 ELSE 0 END) AS normal,
           SUM(CASE WHEN status = '迟到' THEN 1 ELSE 0 END) AS late,
           SUM(CASE WHEN status = '早退' THEN 1 ELSE 0 END) AS early,
           SUM(CASE WHEN status = '缺勤' THEN 1 ELSE 0 END) AS absent,
           SUM(CASE WHEN status = '请假' THEN 1 ELSE 0 END) AS leave
         FROM attendances a WHERE a.date = ?${scope.clause}`
      )
      .get(date, ...scope.params);
    trend.push({
      date,
      total: Number(row.total || 0),
      normal: Number(row.normal || 0),
      late: Number(row.late || 0),
      early: Number(row.early || 0),
      absent: Number(row.absent || 0),
      leave: Number(row.leave || 0)
    });
  }

  // 全部记录状态占比（教师仅本班）
  const dist = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = '正常' THEN 1 ELSE 0 END) AS normal,
         SUM(CASE WHEN status = '迟到' THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN status = '早退' THEN 1 ELSE 0 END) AS early,
         SUM(CASE WHEN status = '缺勤' THEN 1 ELSE 0 END) AS absent,
         SUM(CASE WHEN status = '请假' THEN 1 ELSE 0 END) AS leave
       FROM attendances a WHERE 1=1${scope.clause}`
    )
    .get(...scope.params);
  const statusDist = [
    { name: "正常", value: Number(dist.normal || 0) },
    { name: "迟到", value: Number(dist.late || 0) },
    { name: "早退", value: Number(dist.early || 0) },
    { name: "缺勤", value: Number(dist.absent || 0) },
    { name: "请假", value: Number(dist.leave || 0) }
  ];

  res.json({
    success: true,
    data: {
      today: {
        ...todayStat,
        studentTotal,
        classTotal,
        courseTotal,
        date: today
      },
      trend,
      statusDist
    }
  });
});

module.exports = router;
