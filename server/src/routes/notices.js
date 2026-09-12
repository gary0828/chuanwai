// 通知公告：admin 发布/下架/删除，登录用户可读；看板取最新公告
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { parseText } = require("../utils/validate");

const router = express.Router();

/** 公告列表（分页 + 关键字；登录用户可读） */
router.get("/", auth, (req, res) => {
  const { keyword = "", page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;
  const like = `%${keyword}%`;
  const total = db
    .prepare("SELECT COUNT(*) AS c FROM notices WHERE title LIKE ?")
    .get(like).c;
  const list = db
    .prepare(
      `SELECT n.*, u.name AS creator_name
       FROM notices n LEFT JOIN users u ON n.creator_id = u.id
       WHERE n.title LIKE ?
       ORDER BY n.is_top DESC, n.id DESC LIMIT ? OFFSET ?`
    )
    .all(like, ps, offset);
  res.json({ success: true, data: { list, total } });
});

/** 最新公告（看板用，最多 3 条，仅已发布） */
router.get("/latest", auth, (_req, res) => {
  const list = db
    .prepare(
      "SELECT id, title, content, is_top, created_at FROM notices WHERE status = '发布' ORDER BY is_top DESC, id DESC LIMIT 3"
    )
    .all();
  res.json({ success: true, data: list });
});

/** 新增公告（仅 admin） */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const { title, content = "", is_top = 0, status = "发布" } = req.body || {};
  if (!title) {
    return res.status(400).json({ success: false, message: "公告标题不能为空" });
  }
  const titleRes = parseText(title, { field: "公告标题", max: 100, required: true });
  if (!titleRes.ok) return res.status(400).json({ success: false, message: titleRes.message });
  const contentRes = parseText(content, { field: "公告内容", max: 5000 });
  if (!contentRes.ok) return res.status(400).json({ success: false, message: contentRes.message });
  const result = db
    .prepare("INSERT INTO notices (title, content, creator_id, is_top, status) VALUES (?, ?, ?, ?, ?)")
    .run(title, content, req.user.id, Number(is_top) ? 1 : 0, status === "下架" ? "下架" : "发布");
  res.json({ success: true, data: { id: result.lastInsertRowid } });
});

/** 修改公告（仅 admin） */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { title, content, is_top, status } = req.body || {};
  if (!title) {
    return res.status(400).json({ success: false, message: "公告标题不能为空" });
  }
  const titleRes = parseText(title, { field: "公告标题", max: 100, required: true });
  if (!titleRes.ok) return res.status(400).json({ success: false, message: titleRes.message });
  const contentRes = parseText(content, { field: "公告内容", max: 5000 });
  if (!contentRes.ok) return res.status(400).json({ success: false, message: contentRes.message });
  const result = db
    .prepare(
      "UPDATE notices SET title = ?, content = ?, is_top = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    )
    .run(title, content || "", Number(is_top) ? 1 : 0, status === "下架" ? "下架" : "发布", id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, message: "公告不存在" });
  }
  res.json({ success: true, data: null });
});

/** 删除公告（仅 admin） */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM notices WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, message: "公告不存在" });
  }
  res.json({ success: true, data: null });
});

module.exports = router;
