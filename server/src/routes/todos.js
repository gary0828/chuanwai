// 待办：本人管理自己的待办；admin 可看全部、可指派给别人。
//
// 设计见 `docs/ROADMAP.md`「五之二、通知铃铛 + 待办功能」。
// 要点：
// - **一张表 + 按角色过滤**，教务端与 AI 工作台共用；
// - 安全边界靠 **归属校验**（`canManage`），不靠"挡住读" —— teacher 无论传什么
//   scope 都强制只看自己的，天然防越权；
// - `source` = manual（手工）｜auto（L3 自动生成）。L2 只写 manual；
//   自动来源的 `source_type/source_ref_id` 由 L3 填，配合唯一索引做幂等去重。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { parseText } = require("../utils/validate");
const { generateTodos } = require("../utils/todo-generator");

const router = express.Router();

const PRIORITIES = ["普通", "重要", "紧急"];
const STATUSES = ["待办", "已完成"];

/** 可管理该待办？本人 或 admin */
function canManage(user, row) {
  return user.role === "admin" || row.owner_id === user.id;
}

/** 公告/待办都是「已下架/已完成」这类中文枚举，统一在这里收敛非法值 */
function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** 列表（我的 / 全部） */
router.get("/", auth, requireRole("admin", "teacher"), (req, res) => {
  // ★ 触发点 A：打开待办/铃铛时**按需**跑一遍自动生成（幂等 + 60s 节流，见 todo-generator）。
  //   生成是全局的（会为各种 owner 落库），但**读取范围仍严格按下面的作用域收敛** ——
  //   老师这次请求顺带触发了生成，也**看不到**不属于自己的那些（含财务/线索类）。
  let generated = null;
  try {
    generated = generateTodos();
  } catch (e) {
    // 生成失败不能阻塞列表读取
    console.error("[todo-generator] 生成失败：", e.message);
  }

  const {
    scope = "mine",
    status = "",
    priority = "",
    keyword = "",
    owner_id = "",
    page = 1,
    pageSize = 20
  } = req.query;
  const isAdmin = req.user.role === "admin";

  const conds = [];
  const params = [];

  // ★ 作用域：只有 admin 传 scope=all 才放开；其余一律只看自己。
  //   这是权限边界所在 —— teacher 伪造 scope=all 也无效。
  if (isAdmin && scope === "all") {
    if (owner_id) {
      conds.push("t.owner_id = ?");
      params.push(Number(owner_id));
    }
  } else {
    conds.push("t.owner_id = ?");
    params.push(req.user.id);
  }

  if (status) {
    conds.push("t.status = ?");
    params.push(pickEnum(status, STATUSES, "待办"));
  }
  if (priority) {
    conds.push("t.priority = ?");
    params.push(pickEnum(priority, PRIORITIES, "普通"));
  }
  if (keyword) {
    conds.push("(t.title LIKE ? OR t.content LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const where = conds.length ? conds.join(" AND ") : "1=1";
  const ps = Math.min(Number(pageSize) || 20, 100);

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM todos t WHERE ${where}`)
    .get(...params).c;

  const list = db
    .prepare(
      `SELECT t.*, o.name AS owner_name, c.name AS creator_name
       FROM todos t
       LEFT JOIN users o ON o.id = t.owner_id
       LEFT JOIN users c ON c.id = t.creator_id
       WHERE ${where}
       ORDER BY
         CASE t.status WHEN '待办' THEN 0 ELSE 1 END,
         CASE t.priority WHEN '紧急' THEN 0 WHEN '重要' THEN 1 ELSE 2 END,
         CASE WHEN t.due_date IS NULL OR t.due_date = '' THEN 1 ELSE 0 END,
         t.due_date ASC,
         t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, ps, (Number(page) - 1) * ps);

  // 未完成数（铃铛红点用）
  const mine = isAdmin && scope === "all" ? null : req.user.id;
  const pendingCount = mine
    ? db
        .prepare("SELECT COUNT(*) AS c FROM todos WHERE owner_id = ? AND status = '待办'")
        .get(mine).c
    : db.prepare("SELECT COUNT(*) AS c FROM todos WHERE status = '待办'").get().c;

  res.json({ success: true, data: { list, total, pendingCount, generated } });
});

/**
 * 手动触发一次自动生成（**仅 admin**）。
 * 用途：排查「为什么没生成待办」时不用等定时任务；也便于验收测试。
 * `force=1` 跳过 60s 节流。
 */
router.post("/generate", auth, requireRole("admin"), (req, res) => {
  const force = String(req.query.force || "") === "1";
  const result = generateTodos({ force });
  res.json({ success: true, data: result });
});

/** 新建（owner 默认自己；仅 admin 可指派给别人） */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { title, content = "", priority = "普通", due_date = null, owner_id } = req.body || {};

  const titleRes = parseText(title, { field: "待办标题", max: 100, required: true });
  if (!titleRes.ok) return res.status(400).json({ success: false, message: titleRes.message });
  const contentRes = parseText(content, { field: "待办内容", max: 5000 });
  if (!contentRes.ok) return res.status(400).json({ success: false, message: contentRes.message });

  let ownerId = req.user.id;
  if (owner_id !== undefined && owner_id !== null && Number(owner_id) !== req.user.id) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "只有管理员可以指派待办给他人" });
    }
    ownerId = Number(owner_id);
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(ownerId)) {
      return res.status(400).json({ success: false, message: "指定的负责人不存在" });
    }
  }

  const result = db
    .prepare(
      `INSERT INTO todos (title, content, owner_id, creator_id, source, status, priority, due_date)
       VALUES (?, ?, ?, ?, 'manual', '待办', ?, ?)`
    )
    .run(
      String(title).trim(),
      content || "",
      ownerId,
      req.user.id,
      pickEnum(priority, PRIORITIES, "普通"),
      due_date || null
    );

  res.json({ success: true, data: { id: result.lastInsertRowid } });
});

/** 修改（含标记完成） */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "待办不存在" });
  if (!canManage(req.user, row)) {
    return res.status(403).json({ success: false, message: "无权修改该待办" });
  }

  const { title, content, priority, due_date, status, owner_id } = req.body || {};

  // 负责人变更同样只有 admin 能做
  let ownerId = row.owner_id;
  if (owner_id !== undefined && Number(owner_id) !== row.owner_id) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "只有管理员可以改负责人" });
    }
    ownerId = Number(owner_id);
  }

  const nextTitle = title === undefined ? row.title : title;
  const titleRes = parseText(nextTitle, { field: "待办标题", max: 100, required: true });
  if (!titleRes.ok) return res.status(400).json({ success: false, message: titleRes.message });
  const nextContent = content === undefined ? row.content : content;
  const contentRes = parseText(nextContent, { field: "待办内容", max: 5000 });
  if (!contentRes.ok) return res.status(400).json({ success: false, message: contentRes.message });

  const nextStatus = status === undefined ? row.status : pickEnum(status, STATUSES, row.status);
  // 完成时间：转为已完成时打点，退回待办时清空
  const completedAt =
    nextStatus === "已完成" ? row.completed_at || nowLocal() : null;

  db.prepare(
    `UPDATE todos
     SET title = ?, content = ?, owner_id = ?, status = ?, priority = ?,
         due_date = ?, completed_at = ?, updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(
    String(nextTitle).trim(),
    nextContent || "",
    ownerId,
    nextStatus,
    priority === undefined ? row.priority : pickEnum(priority, PRIORITIES, row.priority),
    due_date === undefined ? row.due_date : due_date || null,
    completedAt,
    id
  );

  res.json({ success: true, data: null });
});

/** 删除 */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "待办不存在" });
  if (!canManage(req.user, row)) {
    return res.status(403).json({ success: false, message: "无权删除该待办" });
  }
  db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

function nowLocal() {
  return db.prepare("SELECT datetime('now','localtime') AS t").get().t;
}

module.exports = router;
