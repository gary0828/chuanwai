// 通知记录：考勤缺勤等联动生成的家校通知，管理端可查看/标记已读
// 权限：admin 全量；teacher 仅「班主任 OR 任课教师」班级的学员（G2，utils/scope.js 唯一口径）
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageStudent, studentScopeWhere } = require("../utils/scope");
// ★ 统一分页钳制（2026-10-18 深度测试 P2-4）
const { clampPagination } = require("../utils/pagination");

const router = express.Router();

/** 教师范围：通知按学员所属班级过滤（s 为 students 表别名）
 *
 *  ★ P1-4（G2）：原实现只按 classes.head_teacher_id 过滤 —— 只任课不当班主任的老师
 *    看不到自己任课班的家庭通知；改用 utils/scope.js 的 studentScopeWhere 后，
 *    与学员列表 / 请假 / 考试成绩等模块口径一致。
 */
function notificationScope(req) {
  if (req.user.role !== "teacher") return { where: "", params: [] };
  return studentScopeWhere(req);
}

/** 通知列表（分页 + 学员关键字/类型/日期范围/已读筛选） */
router.get("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { keyword = "", type = "", date_start, date_end, is_read } = req.query;
  const { pageSize: ps, offset } = clampPagination(req.query);
  const scope = notificationScope(req);
  const conds = [];
  const params = [];
  if (keyword) {
    conds.push("(s.name LIKE ? OR s.student_no LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (type) {
    conds.push("n.type = ?");
    params.push(type);
  }
  if (date_start) {
    conds.push("n.date >= ?");
    params.push(date_start);
  }
  if (date_end) {
    conds.push("n.date <= ?");
    params.push(date_end);
  }
  if (is_read !== "" && is_read !== undefined && is_read !== null) {
    conds.push("n.is_read = ?");
    params.push(Number(is_read));
  }
  const where = (conds.length ? conds.join(" AND ") : "1=1") + scope.where;
  const allParams = [...params, ...scope.params];

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications n JOIN students s ON s.id = n.student_id WHERE ${where}`
    )
    .get(...allParams).c;
  const list = db
    .prepare(
      `
    SELECT n.id, n.student_id, s.student_no, s.name AS student_name,
           c.name AS class_name, n.type, n.title, n.content, n.date, n.is_read, n.created_at,
           n.parent_name
    FROM notifications n
    JOIN students s ON s.id = n.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE ${where}
    ORDER BY n.id DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...allParams, ps, offset);
  // ★ P3-1（2026-10-18 修复）：unreadCount 必须是「当前筛选条件下的**真正未读数**」。
  //   旧实现对 where 做 `replace("1=1", "n.is_read = 0")`：一旦带了任何筛选条件，
  //   where 里根本没有 "1=1" 子串 → replace 失效 → 返回的是筛选后的**全部条数**，
  //   前端铃铛把「已读的通知」也当成未读。现在独立拼一份 unread 条件。
  const unreadWhere = [...conds, "n.is_read = 0"].join(" AND ") + scope.where;
  const unreadCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications n JOIN students s ON s.id = n.student_id WHERE ${unreadWhere}`
    )
    .get(...params, ...scope.params).c;

  res.json({ success: true, data: { list, total, unreadCount } });
});

/** 标记单条已读 */
router.put("/:id/read", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare("SELECT n.id, n.student_id FROM notifications n WHERE n.id = ?")
    .get(id);
  if (!row)
    return res.status(404).json({ success: false, message: "通知不存在" });
  // ★ P1-4（G2）：与列表同一口径（班主任 OR 任课教师，admin 恒 true）
  if (!canManageStudent(req, row.student_id)) {
    return res.status(403).json({ success: false, message: "无权操作该通知" });
  }
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

/** 全部标记已读（当前用户可视范围） */
router.put("/read-all", auth, requireRole("admin", "teacher"), (req, res) => {
  const scope = notificationScope(req);
  const where = "n.is_read = 0" + scope.where;
  db.prepare(
    `UPDATE notifications SET is_read = 1 WHERE id IN (
       SELECT n.id FROM notifications n JOIN students s ON s.id = n.student_id WHERE ${where}
     )`
  ).run(...scope.params);
  res.json({ success: true, data: null });
});

module.exports = router;
