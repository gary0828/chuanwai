// 任课关系 CRUD（班级 × 课程 × 教师(可空) × 学期(可空)）
//
// 权限（对齐设计 §3.2）：GET auth（scope：教师仅本班）；POST / PUT / DELETE 仅 admin。
// 响应体统一 { success, data?, message? }。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { teacherClassPredicate } = require("../utils/scope");

const router = express.Router();

function toIntOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const SELECT = `
  ta.id, ta.class_id, c.name AS class_name, ta.course_id, co.name AS course_name,
  ta.teacher_id, u.name AS teacher_name, ta.term_id, t.name AS term_name,
  ta.created_at, ta.updated_at
  FROM teaching_assignments ta
  JOIN classes c ON c.id = ta.class_id
  JOIN courses co ON co.id = ta.course_id
  LEFT JOIN users u ON u.id = ta.teacher_id
  LEFT JOIN terms t ON t.id = ta.term_id`;

/** 任课关系列表（分页 + 班级/教师/学期筛选；teacher 仅本班） */
router.get("/", auth, (req, res) => {
  const { class_id, teacher_id, term_id, page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Math.min(Number(pageSize) || 10, 200);
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  if (req.user.role === "teacher") {
    where += ` AND (${teacherClassPredicate("c")})`;
    params.push(req.user.id, req.user.id);
  }
  const cid = toIntOrNull(class_id);
  if (cid) { where += " AND ta.class_id = ?"; params.push(cid); }
  const tid = toIntOrNull(teacher_id);
  if (tid) { where += " AND ta.teacher_id = ?"; params.push(tid); }
  if (term_id !== undefined && term_id !== "" && term_id !== "null") {
    const termId = toIntOrNull(term_id);
    if (termId) { where += " AND ta.term_id = ?"; params.push(termId); }
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM teaching_assignments ta JOIN classes c ON c.id = ta.class_id ${where}`).get(...params).c;
  const list = db
    .prepare(`SELECT ${SELECT} ${where} ORDER BY ta.id DESC LIMIT ? OFFSET ?`)
    .all(...params, ps, offset);
  res.json({ success: true, data: { list, total } });
});

/** 新增任课关系（admin） */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const { class_id, course_id, teacher_id, term_id } = req.body || {};
  const classId = toIntOrNull(class_id);
  const courseId = toIntOrNull(course_id);
  if (!classId) return res.status(400).json({ success: false, message: "请选择班级" });
  if (!courseId) return res.status(400).json({ success: false, message: "请选择课程" });
  if (!db.prepare("SELECT 1 FROM classes WHERE id = ?").get(classId)) {
    return res.status(400).json({ success: false, message: "班级不存在" });
  }
  if (!db.prepare("SELECT 1 FROM courses WHERE id = ?").get(courseId)) {
    return res.status(400).json({ success: false, message: "课程不存在" });
  }
  const teachId = toIntOrNull(teacher_id);
  if (teachId && !db.prepare("SELECT 1 FROM users WHERE id = ?").get(teachId)) {
    return res.status(400).json({ success: false, message: "教师不存在" });
  }
  const termId = toIntOrNull(term_id);
  if (termId && !db.prepare("SELECT 1 FROM terms WHERE id = ?").get(termId)) {
    return res.status(400).json({ success: false, message: "学期不存在" });
  }
  try {
    const info = db
      .prepare(
        "INSERT INTO teaching_assignments (class_id, course_id, teacher_id, term_id) VALUES (?, ?, ?, ?)"
      )
      .run(classId, courseId, teachId, termId);
    res.json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ success: false, message: "该班级该课程在该学期已存在任课关系" });
    }
    throw e;
  }
});

/** 修改任课关系（admin） */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { class_id, course_id, teacher_id, term_id } = req.body || {};
  const row = db.prepare("SELECT * FROM teaching_assignments WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "任课关系不存在" });
  const classId = toIntOrNull(class_id);
  const courseId = toIntOrNull(course_id);
  if (!classId) return res.status(400).json({ success: false, message: "请选择班级" });
  if (!courseId) return res.status(400).json({ success: false, message: "请选择课程" });
  const teachId = toIntOrNull(teacher_id);
  if (teachId && !db.prepare("SELECT 1 FROM users WHERE id = ?").get(teachId)) {
    return res.status(400).json({ success: false, message: "教师不存在" });
  }
  const termId = toIntOrNull(term_id);
  if (termId && !db.prepare("SELECT 1 FROM terms WHERE id = ?").get(termId)) {
    return res.status(400).json({ success: false, message: "学期不存在" });
  }
  try {
    db.prepare(
      `UPDATE teaching_assignments
       SET class_id = ?, course_id = ?, teacher_id = ?, term_id = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(classId, courseId, teachId, termId, id);
    res.json({ success: true, data: null });
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ success: false, message: "该班级该课程在该学期已存在任课关系" });
    }
    throw e;
  }
});

/** 删除任课关系（admin） */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM teaching_assignments WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "任课关系不存在" });
  db.prepare("DELETE FROM teaching_assignments WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

module.exports = router;
