// 学期管理：CRUD + 当前学期切换（仅 admin 写；登录用户可读，供统计/报表筛选）
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

/** 学期列表（分页 + 名称搜索） */
router.get("/", auth, (req, res) => {
  const { name = "", page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;
  const like = `%${name}%`;
  const total = db
    .prepare("SELECT COUNT(*) AS c FROM terms WHERE name LIKE ?")
    .get(like).c;
  const list = db
    .prepare(
      "SELECT * FROM terms WHERE name LIKE ? ORDER BY start_date DESC, id DESC LIMIT ? OFFSET ?"
    )
    .all(like, ps, offset);
  res.json({ success: true, data: { list, total } });
});

/** 学期下拉（全部） */
router.get("/all", auth, (_req, res) => {
  const list = db
    .prepare("SELECT id, name, start_date, end_date, is_current FROM terms ORDER BY start_date DESC, id DESC")
    .all();
  res.json({ success: true, data: list });
});

/** 当前学期 */
router.get("/current", auth, (_req, res) => {
  const row = db.prepare("SELECT * FROM terms WHERE is_current = 1").get();
  res.json({ success: true, data: row || null });
});

/** 新增学期（仅 admin） */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const { name, start_date, end_date, is_current = 0 } = req.body || {};
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ success: false, message: "学期名称、开始日期、结束日期为必填项" });
  }
  if (String(start_date) > String(end_date)) {
    return res.status(400).json({ success: false, message: "开始日期不能晚于结束日期" });
  }
  try {
    // 若标记为当前学期，先取消其它当前学期
    if (Number(is_current) === 1) db.prepare("UPDATE terms SET is_current = 0").run();
    const result = db
      .prepare("INSERT INTO terms (name, start_date, end_date, is_current) VALUES (?, ?, ?, ?)")
      .run(name, start_date, end_date, Number(is_current) ? 1 : 0);
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "学期名称已存在" });
    }
    throw err;
  }
});

/** 修改学期（仅 admin） */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { name, start_date, end_date, is_current } = req.body || {};
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ success: false, message: "学期名称、开始日期、结束日期为必填项" });
  }
  if (String(start_date) > String(end_date)) {
    return res.status(400).json({ success: false, message: "开始日期不能晚于结束日期" });
  }
  try {
    if (Number(is_current) === 1) db.prepare("UPDATE terms SET is_current = 0").run();
    const result = db
      .prepare("UPDATE terms SET name = ?, start_date = ?, end_date = ?, is_current = ? WHERE id = ?")
      .run(name, start_date, end_date, Number(is_current) ? 1 : 0, id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: "学期不存在" });
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "学期名称已存在" });
    }
    throw err;
  }
});

/** 设为当前学期（仅 admin；自动取消其它当前） */
router.put("/:id/current", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare("SELECT id FROM terms WHERE id = ?").get(id);
  if (!exists) {
    return res.status(404).json({ success: false, message: "学期不存在" });
  }
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE terms SET is_current = 0").run();
    db.prepare("UPDATE terms SET is_current = 1 WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ success: true, data: null });
});

/** 删除学期（仅 admin；当前学期不可删除） */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT is_current FROM terms WHERE id = ?").get(id);
  if (!row) {
    return res.status(404).json({ success: false, message: "学期不存在" });
  }
  if (row.is_current === 1) {
    return res.status(400).json({ success: false, message: "当前学期不可删除，请先切换当前学期" });
  }
  db.prepare("DELETE FROM terms WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

module.exports = router;
