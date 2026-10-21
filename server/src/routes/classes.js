// 班级管理 CRUD + 班级名单
// 数据权限：教师仅可见「班主任或任课」的班级；管理员不限
// ★ 班级档案的编辑 / 删除收窄为「班主任或 admin」（任课教师对班级档案只读）
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const {
  classScopeClause,
  canManageClass,
  isHeadTeacherOf
} = require("../utils/scope");
const { parseText } = require("../utils/validate");
const { scanReferences, describeImpacts } = require("../utils/delete-guard");
const { audit } = require("../utils/audit");

const router = express.Router();

/** 班级列表（名称搜索 + 分页；教师仅显示自己负责的班级） */
router.get("/", auth, (req, res) => {
  const { name = "", page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;
  const like = `%${name}%`;
  const scope = classScopeClause(req);

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM classes c WHERE c.name LIKE ?${scope.clause}`
    )
    .get(like, ...scope.params).c;
  const list = db
    .prepare(
      `SELECT c.*, u.name AS head_teacher_name,
              (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = '在读' AND s.deleted_at IS NULL) AS student_count
       FROM classes c
       LEFT JOIN users u ON u.id = c.head_teacher_id
       WHERE c.name LIKE ?${scope.clause}
       ORDER BY c.id DESC LIMIT ? OFFSET ?`
    )
    .all(like, ...scope.params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 班级下拉（全部，供筛选使用；教师仅返回自己负责的班级） */
router.get("/all", auth, (req, res) => {
  const scope = classScopeClause(req);
  const list = db
    .prepare(
      `SELECT c.id, c.name FROM classes c WHERE 1=1${scope.clause} ORDER BY c.id`
    )
    .all(...scope.params);
  res.json({ success: true, data: list });
});

/** 班级学生名单 + 出勤概况（班级详情用） */
router.get("/:id/students", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!canManageClass(req, id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权查看该班级数据" });
  }
  const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(id);
  if (!cls) {
    return res.status(404).json({ success: false, message: "班级不存在" });
  }
  const students = db
    .prepare(
      `SELECT id, student_no, name, gender, phone, email, status
       FROM students WHERE class_id = ? AND status = '在读' AND deleted_at IS NULL
       ORDER BY student_no`
    )
    .all(id);
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const todayStats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN a.status = '正常' OR a.status = '迟到' OR a.status = '早退' THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent,
         SUM(CASE WHEN a.status = '请假' THEN 1 ELSE 0 END) AS leave_count
       FROM attendances a JOIN students s ON a.student_id = s.id
       WHERE s.class_id = ? AND a.date = ?`
    )
    .get(id, todayStr);

  res.json({
    success: true,
    data: {
      class: {
        id: cls.id,
        name: cls.name,
        grade: cls.grade,
        head_teacher: cls.head_teacher,
        head_teacher_id: cls.head_teacher_id
      },
      student_total: students.length,
      today: {
        date: todayStr,
        present: Number(todayStats.present || 0),
        absent: Number(todayStats.absent || 0),
        leave_count: Number(todayStats.leave_count || 0)
      },
      students
    }
  });
});

/** 新增班级（admin / teacher）；教师创建的班级自动绑定自己为班主任，仅 admin 可指定班主任账号 */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const {
    name,
    grade = "",
    head_teacher = "",
    head_teacher_id = null
  } = req.body || {};
  if (!name)
    return res
      .status(400)
      .json({ success: false, message: "班级名称不能为空" });
  const nameRes = parseText(name, {
    field: "班级名称",
    max: 50,
    required: true
  });
  if (!nameRes.ok)
    return res.status(400).json({ success: false, message: nameRes.message });
  const bindId =
    req.user.role === "admin" ? Number(head_teacher_id) || null : req.user.id;
  try {
    const result = db
      .prepare(
        "INSERT INTO classes (name, grade, head_teacher, head_teacher_id) VALUES (?, ?, ?, ?)"
      )
      .run(name, grade, head_teacher, bindId);
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res
        .status(400)
        .json({ success: false, message: "班级名称已存在" });
    }
    throw err;
  }
});

/** 修改班级（admin / teacher；★ 收窄为仅班主任或 admin —— 任课教师对班级档案只读）；班主任账号绑定仅 admin 可改 */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const { name, grade, head_teacher, head_teacher_id } = req.body || {};
  if (!name)
    return res
      .status(400)
      .json({ success: false, message: "班级名称不能为空" });
  const nameRes = parseText(name, {
    field: "班级名称",
    max: 50,
    required: true
  });
  if (!nameRes.ok)
    return res.status(400).json({ success: false, message: nameRes.message });
  if (!isHeadTeacherOf(req, id)) {
    return res.status(403).json({ success: false, message: "无权管理该班级" });
  }
  const headTeacherId =
    req.user.role === "admin" && head_teacher_id !== undefined
      ? Number(head_teacher_id) || null
      : null; // node:sqlite 无法绑定 undefined；未传时传 null，COALESCE 保留原值
  try {
    const result = db
      .prepare(
        `UPDATE classes SET name = ?, grade = ?, head_teacher = ?,
           head_teacher_id = COALESCE(?, head_teacher_id) WHERE id = ?`
      )
      .run(name, grade || "", head_teacher || "", headTeacherId, id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: "班级不存在" });
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res
        .status(400)
        .json({ success: false, message: "班级名称已存在" });
    }
    throw err;
  }
});

/** 删除班级（admin / teacher；★ 收窄为仅班主任或 admin；班级下存在学生时禁止删除）
 *
 *  ★ 2026-10-18 重写（原实现有 P0 缺陷）：
 *    旧代码硬编码 5 张表（schedules / exams / schedule_adjustments / makeup_classes /
 *    hour_consumptions），而 `classes` 实际被 **12 张**表引用。漏掉的 6 张里
 *    `class_sessions` / `teaching_assignments` / `class_evaluations` 是 CASCADE，
 *    `orders.class_id` 是 SET NULL —— 于是「班级下学生已全部转走、但学期课次已生成」
 *    这个常态场景下，删除会连带清空课次（及其考勤锚点）、任课关系、课堂评价，
 *    并把订单的班级归属静默置空，响应仍返回 success: true。
 *
 *    与 courses.js 的修复（K-052）保持同一实现：由数据库自己告诉我们"谁引用了我"，
 *    今后迁移新增外键不必回来改这里。
 */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!isHeadTeacherOf(req, id)) {
    return res.status(403).json({ success: false, message: "无权管理该班级" });
  }
  if (!db.prepare("SELECT 1 FROM classes WHERE id = ?").get(id)) {
    return res.status(404).json({ success: false, message: "班级不存在" });
  }
  // 学生单独提示：这是最高频的拦截原因，值得一句人话而不是一串表名
  const studentCount = db
    .prepare("SELECT COUNT(*) AS c FROM students WHERE class_id = ?")
    .get(id).c;
  if (studentCount > 0) {
    return res.status(400).json({
      success: false,
      message: `该班级下仍有 ${studentCount} 名学员，无法删除`
    });
  }
  // 其余引用一律自动发现（students 已单独处理，这里排除避免重复提示）
  const impacts = scanReferences("classes", id).filter(
    i => i.table !== "students"
  );
  if (impacts.length > 0) {
    return res.status(400).json({
      success: false,
      message: `该班级仍被以下数据引用，无法删除：${describeImpacts(impacts)}`
    });
  }
  const result = db.prepare("DELETE FROM classes WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, message: "班级不存在" });
  }
  audit(req.user, "删除班级", `班级#${id}`);
  res.json({ success: true, data: null });
});

module.exports = router;
