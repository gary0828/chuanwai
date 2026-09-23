// 数据级权限：教师（teacher）可见/管理「班主任 OR 任课教师」的班级数据
// 管理员不受限。用法：const { classScopeClause, studentScopeWhere, canManageStudent,
//   canManageClass, isHeadTeacherOf, canAccessSession } = require("../utils/scope");
//
// ★ G2 归属过滤扩展（2026-09-23）：把「班主任 head_teacher_id」扩为「班主任 OR 任课教师」。
//   - 任课关系来自 teaching_assignments（班级 × 课程 × 教师 × 学期）。
//   - 任课可见性按学期生效：有任课记录且（term_id 为空=长期有效 OR 命中当前学期）即可见。
//   - 兜底：系统不存在 is_current=1 的学期时**不过滤**（只要有任课记录即可见），避免误挡所有人。
//   - 课次级代课人可见（Q5）是**课次维度**条件，单独由 canAccessSession 处理，不进班级过滤
//     （否则整班越权）。
const db = require("../db");

/**
 * 班级归属谓词（教师视角，SQL 片段）：班主任 OR 任课教师（含学期生效 + 无当前学期兜底）。
 * 占位符两个，均为当前教师 id，顺序：head_teacher_id = ? / ta.teacher_id = ?。
 * @param {string} alias classes 表别名，默认 "c"
 */
function teacherClassPredicate(alias = "c") {
  return `(${alias}.head_teacher_id = ?
    OR EXISTS (
      SELECT 1 FROM teaching_assignments ta
      WHERE ta.class_id = ${alias}.id AND ta.teacher_id = ?
        AND (
          NOT EXISTS (SELECT 1 FROM terms WHERE is_current = 1)
          OR ta.term_id IS NULL
          OR ta.term_id = (SELECT id FROM terms WHERE is_current = 1)
        )
    ))`;
}

/** 班级表过滤：返回 { clause, params }，拼接进 SQL（classes 表别名默认为 c） */
function classScopeClause(req, alias = "c") {
  if (req.user.role !== "teacher") return { clause: "", params: [] };
  return {
    clause: ` AND ${teacherClassPredicate(alias)}`,
    params: [req.user.id, req.user.id]
  };
}

/** 学生表过滤：教师仅能访问自己「班主任或任课」班级的学生（s 为 students 表别名） */
function studentScopeWhere(req) {
  if (req.user.role !== "teacher") return { where: "", params: [] };
  return {
    where: ` AND s.class_id IN (SELECT c.id FROM classes c WHERE ${teacherClassPredicate("c")})`,
    params: [req.user.id, req.user.id]
  };
}

/** 校验某学生是否在当前用户可管理范围内（admin 恒为 true） */
function canManageStudent(req, studentId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare(
      `SELECT 1 FROM students s
       JOIN classes c ON s.class_id = c.id
       WHERE s.id = ? AND ${teacherClassPredicate("c")}`
    )
    .get(Number(studentId), req.user.id, req.user.id);
  return !!row;
}

/** 校验某班级是否在当前用户可管理范围内（admin 恒为 true） */
function canManageClass(req, classId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare(`SELECT 1 FROM classes c WHERE c.id = ? AND ${teacherClassPredicate("c")}`)
    .get(Number(classId), req.user.id, req.user.id);
  return !!row;
}

/**
 * 是否为该班班主任（admin 恒为 true）。
 * 用于「班级档案」编辑/删除等破坏性操作的最小加固 —— 任课教师对班级档案只读。
 */
function isHeadTeacherOf(req, classId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare("SELECT 1 FROM classes WHERE id = ? AND head_teacher_id = ?")
    .get(Number(classId), req.user.id);
  return !!row;
}

/**
 * 某课次是否当前用户可访问（admin / 该班班主任或任课教师 / 该课次代课人）。
 * Q5：代课人可看可录，仅限他代的那一节。
 */
function canAccessSession(req, sessionId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare("SELECT class_id, substitute_teacher_id FROM class_sessions WHERE id = ?")
    .get(Number(sessionId));
  if (!row) return false;
  if (row.substitute_teacher_id != null && Number(row.substitute_teacher_id) === req.user.id) {
    return true;
  }
  return canManageClass(req, row.class_id);
}

module.exports = {
  classScopeClause,
  studentScopeWhere,
  canManageStudent,
  canManageClass,
  isHeadTeacherOf,
  canAccessSession,
  teacherClassPredicate
};
