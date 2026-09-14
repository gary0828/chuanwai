// 使用反馈：教师 / 管理员提交使用过程中遇到的问题与建议，admin 汇总查看并跟踪处理
//
// 权限模型：
// - 提交 / 查看自己的反馈：任意登录用户（admin / teacher）
// - 全量列表 / 统计 / 处理（改状态、写回复）：仅 admin
//
// 数据边界：只记录提交人身份与问题描述，不落任何学员数据，
// 避免「反馈」成为绕过四层权限的数据出口。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

const CATEGORIES = ["功能异常", "操作不便", "数据不准", "性能问题", "功能建议", "其他"];
const STATUSES = ["待处理", "处理中", "已处理", "已忽略"];
const MIN_CONTENT = 5;
const MAX_CONTENT = 2000;
const MAX_PATH = 200;

/** 提交反馈 */
router.post("/", auth, (req, res) => {
  const { category = "其他", content = "", page_path = "" } = req.body || {};

  const text = String(content).trim();
  if (text.length < MIN_CONTENT) {
    return res
      .status(400)
      .json({ success: false, message: `问题描述至少 ${MIN_CONTENT} 个字` });
  }
  if (text.length > MAX_CONTENT) {
    return res
      .status(400)
      .json({ success: false, message: `问题描述不超过 ${MAX_CONTENT} 个字` });
  }

  const user = db
    .prepare("SELECT id, username, role FROM users WHERE id = ?")
    .get(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, message: "用户不存在" });
  }

  const cat = CATEGORIES.includes(category) ? category : "其他";

  const info = db
    .prepare(
      `INSERT INTO feedbacks (user_id, username, user_role, category, content, page_path)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      user.id,
      user.username,
      user.role,
      cat,
      text,
      String(page_path).slice(0, MAX_PATH)
    );

  res.json({ success: true, data: { id: Number(info.lastInsertRowid) } });
});

/** 我的反馈（任意登录用户） */
router.get("/mine", auth, (req, res) => {
  const list = db
    .prepare(
      `SELECT id, category, content, page_path, status, admin_reply, handled_at, created_at
       FROM feedbacks WHERE user_id = ? ORDER BY id DESC LIMIT 100`
    )
    .all(req.user.id);
  res.json({ success: true, data: { list, total: list.length } });
});

/** 反馈统计（admin，供首页角标显示待处理数量） */
router.get("/summary", auth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS c FROM feedbacks GROUP BY status")
    .all();
  const data = { total: 0 };
  for (const s of STATUSES) data[s] = 0;
  for (const r of rows) {
    data[r.status] = Number(r.c);
    data.total += Number(r.c);
  }
  res.json({ success: true, data });
});

/** 全部反馈（admin，分页 + 状态筛选；待处理优先） */
router.get("/", auth, requireRole("admin"), (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const status = String(req.query.status || "").trim();
  const filtered = STATUSES.includes(status);

  const where = filtered ? "WHERE status = ?" : "";
  const whereParams = filtered ? [status] : [];

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM feedbacks ${where}`).get(...whereParams).c
  );

  const list = db
    .prepare(
      `SELECT id, user_id, username, user_role, category, content, page_path,
              status, admin_reply, handled_by, handled_at, created_at, updated_at
       FROM feedbacks ${where}
       ORDER BY CASE status WHEN '待处理' THEN 0 WHEN '处理中' THEN 1 ELSE 2 END, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...whereParams, pageSize, (page - 1) * pageSize);

  res.json({ success: true, data: { list, total, page, pageSize } });
});

/** 处理反馈（admin）：改状态 / 写回复 */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM feedbacks WHERE id = ?").get(id);
  if (!row) {
    return res.status(404).json({ success: false, message: "反馈不存在" });
  }

  const { status, admin_reply } = req.body || {};

  let nextStatus = null;
  if (status !== undefined) {
    nextStatus = String(status);
    if (!STATUSES.includes(nextStatus)) {
      return res.status(400).json({ success: false, message: "状态取值不合法" });
    }
  }

  const fields = [];
  const params = [];

  if (nextStatus !== null) {
    fields.push("status = ?");
    params.push(nextStatus);
    fields.push("handled_at = datetime('now','localtime')");
  }
  if (admin_reply !== undefined) {
    fields.push("admin_reply = ?");
    params.push(String(admin_reply).slice(0, MAX_CONTENT));
  }
  fields.push("handled_by = ?");
  params.push(req.user.id);
  fields.push("updated_at = datetime('now','localtime')");
  params.push(id);

  db.prepare(`UPDATE feedbacks SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  res.json({ success: true, data: null });
});

/** 可选值字典（前端下拉用，避免前后端硬编码分叉） */
router.get("/options", auth, (_req, res) => {
  res.json({ success: true, data: { categories: CATEGORIES, statuses: STATUSES } });
});

module.exports = router;
