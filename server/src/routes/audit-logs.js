// 审计日志查询（仅 admin）：分页 + 操作人/动作/时间范围筛选
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", auth, requireRole("admin"), (req, res) => {
  const { username, action, start, end, page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;

  const where = [];
  const params = [];
  if (username) {
    where.push("username LIKE ?");
    params.push(`%${username}%`);
  }
  if (action) {
    where.push("action LIKE ?");
    params.push(`%${action}%`);
  }
  if (start) {
    where.push("created_at >= ?");
    params.push(`${start} 00:00:00`);
  }
  if (end) {
    where.push("created_at <= ?");
    params.push(`${end} 23:59:59`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`).get(...params).c;
  const list = db
    .prepare(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

module.exports = router;
