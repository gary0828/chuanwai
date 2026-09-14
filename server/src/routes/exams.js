// 考试与成绩：考试管理 / 成绩录入（upsert + 家长通知）/ 成绩单排名
// 权限：admin 全量；teacher 仅本班（classes.head_teacher_id 绑定）
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageClass } = require("../utils/scope");
const { audit } = require("../utils/audit");
const { parseDate, parseNumber } = require("../utils/validate");
const { calcGrade } = require("../utils/grade");

const router = express.Router();

const EXAM_TYPES = ["单元测", "期中", "期末"];

/** 教师范围：考试仅本班（e 为 exams 表别名） */
function examScope(req) {
  if (req.user.role !== "teacher") return { where: "", params: [] };
  return {
    where:
      " AND e.class_id IN (SELECT id FROM classes WHERE head_teacher_id = ?)",
    params: [req.user.id]
  };
}

/** 校验考试是否当前用户可管理（admin 恒 true；teacher 须为本班） */
function canManageExam(req, examId) {
  if (req.user.role === "admin") return true;
  const exam = db
    .prepare("SELECT class_id FROM exams WHERE id = ?")
    .get(Number(examId));
  return !!exam && canManageClass(req, exam.class_id);
}


// ==================== 考试管理 ====================

/** 考试列表（分页 + 课程/班级/考试名筛选；教师仅本班） */
router.get("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { course_id, class_id, keyword, page = 1, pageSize = 10 } = req.query;
  const scope = examScope(req);
  const conds = [];
  const params = [];
  if (course_id) {
    conds.push("e.course_id = ?");
    params.push(Number(course_id));
  }
  if (class_id) {
    conds.push("e.class_id = ?");
    params.push(Number(class_id));
  }
  if (keyword) {
    conds.push("e.name LIKE ?");
    params.push(`%${keyword}%`);
  }
  const where = (conds.length ? conds.join(" AND ") : "1=1") + scope.where;
  const allParams = [...params, ...scope.params];

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM exams e WHERE ${where}`)
    .get(...allParams).c;
  const list = db
    .prepare(
      `
    SELECT e.id, e.name, e.course_id, e.class_id, e.exam_date, e.type, e.full_score, e.remark,
           e.created_by, e.created_at,
           cu.name AS course_name, c.name AS class_name,
           (SELECT COUNT(*) FROM students s WHERE s.class_id = e.class_id AND s.status = '在读') AS student_count,
           (SELECT COUNT(*) FROM exam_scores es WHERE es.exam_id = e.id) AS scored_count
    FROM exams e
    LEFT JOIN courses cu ON cu.id = e.course_id
    LEFT JOIN classes c ON c.id = e.class_id
    WHERE ${where}
    ORDER BY e.id DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...allParams, Number(pageSize), (Number(page) - 1) * Number(pageSize));

  res.json({ success: true, data: { list, total } });
});

/** 新增考试 */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { name, course_id, class_id, exam_date, type, full_score, remark } =
    req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ success: false, message: "请输入考试名称" });
  if (!class_id)
    return res.status(400).json({ success: false, message: "请选择考试班级" });
  if (type && !EXAM_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: "无效的考试类型" });
  }
  if (!canManageClass(req, Number(class_id))) {
    return res
      .status(403)
      .json({ success: false, message: "无权为该班级创建考试" });
  }
  // 考试日期：提供时必须真实存在；满分：0 < score ≤ 1000（默认 100）
  let examDate = new Date().toLocaleDateString("sv");
  if (exam_date !== undefined && exam_date !== null && exam_date !== "") {
    const dRes = parseDate(exam_date, { field: "考试日期" });
    if (!dRes.ok) return res.status(400).json({ success: false, message: dRes.message });
    examDate = dRes.value;
  }
  const fsRes = parseNumber(full_score, { field: "满分", min: 1, max: 1000, required: false });
  if (!fsRes.ok) return res.status(400).json({ success: false, message: fsRes.message });
  const fullScore = fsRes.value === null ? 100 : fsRes.value;
  const info = db
    .prepare(
      `
    INSERT INTO exams (name, course_id, class_id, exam_date, type, full_score, remark, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      String(name).trim(),
      course_id ? Number(course_id) : null,
      Number(class_id),
      examDate,
      type || "单元测",
      fullScore,
      remark || "",
      req.user.id
    );
  audit(req.user, "新增考试", `考试#${info.lastInsertRowid} ${name}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 修改考试（未传字段保留原值；教师须本班） */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageExam(req, id)) {
    return res.status(403).json({ success: false, message: "无权操作该考试" });
  }
  const { name, course_id, class_id, exam_date, type, full_score, remark } =
    req.body || {};
  if (type && !EXAM_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: "无效的考试类型" });
  }
  if (
    class_id != null &&
    class_id !== "" &&
    !canManageClass(req, Number(class_id))
  ) {
    return res
      .status(403)
      .json({ success: false, message: "无权将该考试改到该班级" });
  }
  // 考试日期 / 满分：提供时必须合法（空值保留原值）
  if (exam_date !== undefined && exam_date !== null && exam_date !== "") {
    const dRes = parseDate(exam_date, { field: "考试日期" });
    if (!dRes.ok) return res.status(400).json({ success: false, message: dRes.message });
  }
  if (full_score !== undefined && full_score !== null && full_score !== "") {
    const fsRes = parseNumber(full_score, { field: "满分", min: 1, max: 1000 });
    if (!fsRes.ok) return res.status(400).json({ success: false, message: fsRes.message });
  }
  const info = db
    .prepare(
      `
    UPDATE exams SET
      name = COALESCE(NULLIF(?, ''), name),
      course_id = COALESCE(?, course_id),
      class_id = COALESCE(?, class_id),
      exam_date = COALESCE(NULLIF(?, ''), exam_date),
      type = COALESCE(?, type),
      full_score = COALESCE(?, full_score),
      remark = COALESCE(NULLIF(?, ''), remark)
    WHERE id = ?
  `
    )
    .run(
      name != null && name !== "" ? String(name).trim() : "",
      course_id != null && course_id !== "" ? Number(course_id) : null,
      class_id != null && class_id !== "" ? Number(class_id) : null,
      exam_date || "",
      type || "",
      full_score != null && full_score !== "" ? Number(full_score) : null,
      remark || "",
      id
    );
  if (info.changes === 0)
    return res.status(404).json({ success: false, message: "考试不存在" });
  audit(req.user, "修改考试", `考试#${id}`);
  res.json({ success: true, data: null });
});

/** 删除考试（成绩由外键级联删除；教师须本班） */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageExam(req, id)) {
    return res.status(403).json({ success: false, message: "无权操作该考试" });
  }
  const info = db.prepare("DELETE FROM exams WHERE id = ?").run(id);
  if (info.changes === 0)
    return res.status(404).json({ success: false, message: "考试不存在" });
  audit(req.user, "删除考试", `考试#${id}`);
  res.json({ success: true, data: null });
});

// ==================== 成绩录入 ====================

/** 成绩录入表单：考试信息 + 该班在读学生名单 + 每人已有成绩 */
router.get("/:id/scores", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageExam(req, id)) {
    return res.status(403).json({ success: false, message: "无权查看该考试" });
  }
  const exam = db
    .prepare(
      `
    SELECT e.*, cu.name AS course_name, c.name AS class_name
    FROM exams e
    LEFT JOIN courses cu ON cu.id = e.course_id
    LEFT JOIN classes c ON c.id = e.class_id
    WHERE e.id = ?
  `
    )
    .get(id);
  if (!exam)
    return res.status(404).json({ success: false, message: "考试不存在" });
  const students = db
    .prepare(
      `
    SELECT s.id AS student_id, s.student_no, s.name, s.status,
           es.score, es.id AS score_id, es.remark
    FROM students s
    LEFT JOIN exam_scores es ON es.student_id = s.id AND es.exam_id = ?
    WHERE s.class_id = ?
    ORDER BY s.student_no
  `
    )
    .all(id, exam.class_id);
  res.json({ success: true, data: { exam, students } });
});

/** 批量录入成绩（事务 upsert；仅「新插入」时给绑定家长发成绩通知，幂等） */
router.put("/:id/scores", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageExam(req, id)) {
    return res.status(403).json({ success: false, message: "无权操作该考试" });
  }
  const exam = db.prepare("SELECT * FROM exams WHERE id = ?").get(id);
  if (!exam)
    return res.status(404).json({ success: false, message: "考试不存在" });
  const { scores } = req.body || {};
  if (!Array.isArray(scores) || scores.length === 0) {
    return res.status(400).json({ success: false, message: "请提供成绩数据" });
  }

  // 校验：student_id 属于该考试班级（含已退学学生，考试时班级成员即可录入成绩）
  const classStudents = db
    .prepare("SELECT id, name FROM students WHERE class_id = ?")
    .all(exam.class_id);
  const validIds = new Set(classStudents.map(s => s.id));
  const nameById = new Map(classStudents.map(s => [s.id, s.name]));
  for (const item of scores) {
    const studentId = Number(item.student_id);
    const score =
      item.score === "" || item.score === null || item.score === undefined
        ? NaN
        : Number(item.score);
    if (!validIds.has(studentId)) {
      return res.status(400).json({
        success: false,
        message: `学员ID ${item.student_id} 不属于该考试班级`
      });
    }
    if (!Number.isFinite(score)) {
      return res.status(400).json({
        success: false,
        message: `学员「${nameById.get(studentId)}」的成绩必须为非空数字`
      });
    }
  }

  const getExist = db.prepare(
    "SELECT id FROM exam_scores WHERE exam_id = ? AND student_id = ?"
  );
  const upsert = db.prepare(`
    INSERT INTO exam_scores (exam_id, student_id, score, remark)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(exam_id, student_id)
    DO UPDATE SET score = excluded.score, remark = excluded.remark
  `);
  // 家长通知（仅新插入成绩时生成，已存在成绩的覆盖更新不重复通知）
  const getParentName = db.prepare(
    "SELECT parent_name FROM students WHERE id = ?"
  );
  const insertNotice = db.prepare(`
    INSERT INTO notifications (student_id, type, title, content, date, parent_name)
    VALUES (?, '成绩发布', ?, ?, ?, ?)
  `);
  const today = new Date().toLocaleDateString("sv");

  db.exec("BEGIN");
  try {
    let inserted = 0;
    for (const item of scores) {
      const studentId = Number(item.student_id);
      const score = Number(item.score);
      const remark = item.remark || "";
      const exist = getExist.get(id, studentId);
      upsert.run(id, studentId, score, remark);
      if (!exist) {
        inserted++;
        const content = `${nameById.get(studentId)} ${exam.name} 成绩 ${score}，请家长关注`;
        const parentName = getParentName.get(studentId)?.parent_name || "";
        insertNotice.run(studentId, "成绩发布提醒", content, today, parentName);
      }
    }
    db.exec("COMMIT");
    audit(req.user, "录入成绩", `考试#${id} ${exam.name} ${scores.length}人`);
    res.json({ success: true, data: { count: scores.length, inserted } });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

// ==================== 成绩单 ====================

/** 成绩单：全部成绩 + 排名（row_number 按分数降序）+ 等级 + 平均分 */
router.get(
  "/:id/scorecard",
  auth,
  requireRole("admin", "teacher"),
  (req, res) => {
    const id = Number(req.params.id);
    if (!canManageExam(req, id)) {
      return res
        .status(403)
        .json({ success: false, message: "无权查看该考试" });
    }
    const exam = db
      .prepare(
        `
    SELECT e.*, cu.name AS course_name, c.name AS class_name
    FROM exams e
    LEFT JOIN courses cu ON cu.id = e.course_id
    LEFT JOIN classes c ON c.id = e.class_id
    WHERE e.id = ?
  `
      )
      .get(id);
    if (!exam)
      return res.status(404).json({ success: false, message: "考试不存在" });
    const list = db
      .prepare(
        `
    SELECT es.id, es.student_id, s.student_no, s.name, es.score, es.remark,
           ROW_NUMBER() OVER (ORDER BY es.score DESC, es.id ASC) AS rank
    FROM exam_scores es
    JOIN students s ON s.id = es.student_id
    WHERE es.exam_id = ?
    ORDER BY es.score DESC, es.id ASC
  `
      )
      .all(id)
      .map(r => ({
        ...r,
        score: Number(r.score),
        rank: Number(r.rank),
        grade: calcGrade(Number(r.score), Number(exam.full_score))
      }));
    const stat = db
      .prepare(
        `
    SELECT COUNT(*) AS scored_count, COALESCE(AVG(score), 0) AS avg_score
    FROM exam_scores WHERE exam_id = ?
  `
      )
      .get(id);
    res.json({
      success: true,
      data: {
        exam,
        list,
        scored_count: Number(stat.scored_count),
        avg_score: Number(Number(stat.avg_score).toFixed(2))
      }
    });
  }
);

module.exports = router;
