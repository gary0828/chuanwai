// 数据级权限：教师（teacher）仅可见/管理自己绑定（classes.head_teacher_id）的班级数据
// 管理员不受限。用法：const { classScopeClause, studentScopeWhere, canManageStudent, canManageClass } = require("../utils/scope");
const db = require("../db");

/** 班级表过滤：返回 { clause, params }，拼接进 SQL（c 为 classes 表别名时使用） */
function classScopeClause(req) {
  if (req.user.role !== "teacher") return { clause: "", params: [] };
  return { clause: " AND c.head_teacher_id = ?", params: [req.user.id] };
}

/** 学生表过滤：教师仅能访问自己班级的学生（s 为 students 表别名） */
function studentScopeWhere(req) {
  if (req.user.role !== "teacher") return { where: "", params: [] };
  return {
    where: " AND s.class_id IN (SELECT id FROM classes WHERE head_teacher_id = ?)",
    params: [req.user.id]
  };
}

/** 校验某学生是否在当前用户可管理范围内（admin 恒为 true） */
function canManageStudent(req, studentId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare(
      `SELECT 1 FROM students s
       JOIN classes c ON s.class_id = c.id
       WHERE s.id = ? AND c.head_teacher_id = ?`
    )
    .get(Number(studentId), req.user.id);
  return !!row;
}

/** 校验某班级是否在当前用户可管理范围内（admin 恒为 true） */
function canManageClass(req, classId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare("SELECT 1 FROM classes WHERE id = ? AND head_teacher_id = ?")
    .get(Number(classId), req.user.id);
  return !!row;
}

module.exports = { classScopeClause, studentScopeWhere, canManageStudent, canManageClass };
