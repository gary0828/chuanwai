// 通知记录：考勤缺勤等联动生成的家校通知，管理端可查看/标记已读
// 权限：admin 全量；teacher 仅本班学员（通过 students.class_id 过滤）
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

/** 教师范围：通知按学员所属班级过滤（s 为 students 表别名） */
function notificationScope(req) {
  if (req.user.role !== "teacher") return { where: "", params: [] };
  return {
    where:
      " AND s.class_id IN (SELECT id FROM classes WHERE head_teacher_id = ?)",
    params: [req.user.id]
  };
}

/** 通知列表（分页 + 学员关键字/类型/日期范围/已读筛选） */
router.get("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const {
    keyword = "",
    type = "",
    date_start,
    date_end,
    is_read,
    page = 1,
    pageSize = 10
  } = req.query;
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
    .all(...allParams, Number(pageSize), (Number(page) - 1) * Number(pageSize));
  const unreadCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications n JOIN students s ON s.id = n.student_id WHERE ${where.replace("1=1", "n.is_read = 0")}`
    )
    .get(...allParams).c;

  res.json({ success: true, data: { list, total, unreadCount } });
});

/** 标记单条已读 */
router.put("/:id/read", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      "SELECT n.id, s.class_id FROM notifications n JOIN students s ON s.id = n.student_id WHERE n.id = ?"
    )
    .get(id);
  if (!row)
    return res.status(404).json({ success: false, message: "通知不存在" });
  if (req.user.role === "teacher") {
    const own = db
      .prepare("SELECT 1 FROM classes WHERE id = ? AND head_teacher_id = ?")
      .get(row.class_id, req.user.id);
    if (!own)
      return res
        .status(403)
        .json({ success: false, message: "无权操作该通知" });
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
