// 课程表管理 CRUD + 查询
// 数据权限：教师仅能管理/查看自己绑定（classes.head_teacher_id）班级的课表；管理员不限
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { classScopeClause, canManageClass } = require("../utils/scope");

const router = express.Router();

/** 冲突检测：同班同时段（class_conflict，业务上拒绝） + 同教师文本跨班同时段（teacher_warnings，警告不阻断）
 *  返回 { class_conflict: [], teacher_warnings: [] }，exclude_id 用于编辑/调课审批时排除当前条目 */
function checkConflicts(db, { class_id, course_id, day_of_week, period, exclude_id }) {
  const excludeClause = exclude_id ? " AND sc.id != ?" : "";
  const excludeParams = exclude_id ? [Number(exclude_id)] : [];
  const classConflict = db
    .prepare(
      `SELECT sc.id, sc.class_id, c.name AS class_name, sc.course_id, co.name AS course_name, sc.day_of_week, sc.period
       FROM schedules sc
       JOIN classes c ON sc.class_id = c.id
       JOIN courses co ON sc.course_id = co.id
       WHERE sc.class_id = ? AND sc.day_of_week = ? AND sc.period = ?${excludeClause}`
    )
    .all(Number(class_id), Number(day_of_week), Number(period), ...excludeParams);

  // 同教师文本跨班同时段（courses.teacher 为文本字段，文本级警告）
  const teacherWarnings = [];
  if (course_id) {
    const course = db.prepare("SELECT teacher FROM courses WHERE id = ?").get(Number(course_id));
    if (course && String(course.teacher || "").trim()) {
      teacherWarnings.push(
        ...db
          .prepare(
            `SELECT sc.id, sc.class_id, c.name AS class_name, sc.course_id, co.name AS course_name,
                    co.teacher, sc.day_of_week, sc.period
             FROM schedules sc
             JOIN classes c ON sc.class_id = c.id
             JOIN courses co ON sc.course_id = co.id
             WHERE co.teacher = ? AND sc.day_of_week = ? AND sc.period = ?
               AND sc.class_id != ?${excludeClause}`
          )
          .all(String(course.teacher).trim(), Number(day_of_week), Number(period), Number(class_id), ...excludeParams)
      );
    }
  }
  return { class_conflict: classConflict, teacher_warnings: teacherWarnings };
}

/** 冲突检测接口（保存前预览；teacher 仅本班） */
router.post("/check-conflict", auth, (req, res) => {
  const { class_id, course_id, day_of_week, period, exclude_id } = req.body || {};
  if (!class_id || !day_of_week || !period) {
    return res.status(400).json({ success: false, message: "班级、星期、节次为必填项" });
  }
  if (!canManageClass(req, class_id)) {
    return res.status(403).json({ success: false, message: "无权管理该班级课程表" });
  }
  res.json({ success: true, data: checkConflicts(db, { class_id, course_id, day_of_week, period, exclude_id }) });
});

/** 课表查询：支持按班级 / 星期过滤 + 分页（考勤登记复用：class_id + day_of_week 查某班某天课程） */
router.get("/", auth, (req, res) => {
  const { class_id, day_of_week, page = 1, pageSize = 100 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 100;
  const offset = (p - 1) * ps;
  const scope = classScopeClause(req);

  let where = "WHERE 1=1";
  const params = [];
  if (class_id) {
    where += " AND sc.class_id = ?";
    params.push(Number(class_id));
  }
  if (day_of_week) {
    where += " AND sc.day_of_week = ?";
    params.push(Number(day_of_week));
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM schedules sc JOIN classes c ON sc.class_id = c.id ${where}${scope.clause}`)
    .get(...params, ...scope.params).c;
  const list = db
    .prepare(
      `SELECT sc.id, sc.class_id, c.name AS class_name, sc.course_id, co.name AS course_name,
              co.teacher, sc.day_of_week, sc.period
       FROM schedules sc
       JOIN classes c ON sc.class_id = c.id
       JOIN courses co ON sc.course_id = co.id
       ${where}${scope.clause}
       ORDER BY sc.day_of_week, sc.period LIMIT ? OFFSET ?`
    )
    .all(...params, ...scope.params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 课表全量（供课程表页一次性渲染；教师仅本班） */
router.get("/all", auth, (req, res) => {
  const scope = classScopeClause(req);
  const list = db
    .prepare(
      `SELECT sc.id, sc.class_id, c.name AS class_name, sc.course_id, co.name AS course_name,
              co.teacher, sc.day_of_week, sc.period
       FROM schedules sc
       JOIN classes c ON sc.class_id = c.id
       JOIN courses co ON sc.course_id = co.id
       WHERE 1=1${scope.clause}
       ORDER BY sc.day_of_week, sc.period`
    )
    .all(...scope.params);
  res.json({ success: true, data: list });
});

/** 新增课表条目 */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { class_id, course_id, day_of_week, period } = req.body || {};
  if (!class_id || !course_id || !day_of_week || !period) {
    return res.status(400).json({ success: false, message: "班级、课程、星期、节次为必填项" });
  }
  const d = Number(day_of_week);
  const per = Number(period);
  if (d < 1 || d > 7 || per < 1 || per > 8) {
    return res.status(400).json({ success: false, message: "星期范围 1-7，节次范围 1-8" });
  }
  if (!canManageClass(req, class_id)) {
    return res.status(403).json({ success: false, message: "无权为该校班级设置课程表" });
  }
  // 冲突检测：同班同时段拒绝（含不同课程）；同教师跨班同时段警告不阻断
  const conflicts = checkConflicts(db, { class_id, course_id, day_of_week, period });
  if (conflicts.class_conflict.length > 0) {
    const c = conflicts.class_conflict[0];
    return res.status(400).json({ success: false, message: `该班级在星期${c.day_of_week}第${c.period}节已安排「${c.course_name}」，请先调整` });
  }
  try {
    const result = db
      .prepare(
        "INSERT INTO schedules (class_id, course_id, day_of_week, period) VALUES (?, ?, ?, ?)"
      )
      .run(Number(class_id), Number(course_id), d, per);
    res.json({ success: true, data: { id: result.lastInsertRowid, warnings: conflicts.teacher_warnings } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "该班级在该星期该节次已安排课程" });
    }
    throw err;
  }
});

/** 修改课表条目 */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const { class_id, course_id, day_of_week, period } = req.body || {};
  if (!class_id || !course_id || !day_of_week || !period) {
    return res.status(400).json({ success: false, message: "班级、课程、星期、节次为必填项" });
  }
  if (!canManageClass(req, class_id)) {
    return res.status(403).json({ success: false, message: "无权管理该班级课程表" });
  }
  // 冲突检测：同班同时段拒绝（排除自身条目）；同教师跨班同时段警告不阻断
  const conflicts = checkConflicts(db, { class_id, course_id, day_of_week, period, exclude_id: id });
  if (conflicts.class_conflict.length > 0) {
    const c = conflicts.class_conflict[0];
    return res.status(400).json({ success: false, message: `该班级在星期${c.day_of_week}第${c.period}节已安排「${c.course_name}」，请先调整` });
  }
  try {
    const result = db
      .prepare(
        "UPDATE schedules SET class_id = ?, course_id = ?, day_of_week = ?, period = ? WHERE id = ?"
      )
      .run(Number(class_id), Number(course_id), Number(day_of_week), Number(period), id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: "课表条目不存在" });
    }
    res.json({ success: true, data: { warnings: conflicts.teacher_warnings } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "该班级在该星期该节次已安排课程" });
    }
    throw err;
  }
});

/** 删除课表条目
 *  v13：存在已通过的调课历史时禁止删除（防止级联删除调课审批记录） */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT class_id FROM schedules WHERE id = ?").get(id);
  if (!row) {
    return res.status(404).json({ success: false, message: "课表条目不存在" });
  }
  if (!canManageClass(req, row.class_id)) {
    return res.status(403).json({ success: false, message: "无权管理该班级课程表" });
  }
  const adjCount = db
    .prepare("SELECT COUNT(*) AS c FROM schedule_adjustments WHERE schedule_id = ? AND status = '通过'")
    .get(id).c;
  if (adjCount > 0) {
    return res.status(400).json({ success: false, message: "该课表存在已通过的调课历史，无法删除" });
  }
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

module.exports = router;
