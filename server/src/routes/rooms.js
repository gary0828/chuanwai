// 教室字典 CRUD（★ 2026-09-30 校区反馈⑤：课表要能标明上哪个教室）
//
// 设计取舍（用户 2026-09-30 拍板：用**字典表**而非自由文本）：
//   避免「302」「302教室」「三零二」三种写法并存，且后续可自然扩展「同教室同时段冲突检测」。
//
// 删除保护（两类引用分别处理）：
//   · `schedules.room_id` 带外键 → `utils/delete-guard.js` 能自动发现（不必手工列举）
//   · `class_sessions.room_id` 在 v21/v22 重建表时定的型、**没有外键** → 这里手工查一次，
//     避免留下"指向不存在教室的课次"
//
// 权限：读 = 登录即可（加课弹窗 / 课次详情 / 排课模板都要拉下拉）；
//       写 = 仅 admin（教室属排课配置，与学期管理、节次时间同类）。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { parseText } = require("../utils/validate");
const { scanReferences, describeImpacts } = require("../utils/delete-guard");

const router = express.Router();

/** 校验教室入参（名称必填 + 容量可选但必须是 ≥0 的整数） */
function parseRoomBody(body = {}) {
  const { name, capacity = null, remark = "" } = body;
  if (!name) return { ok: false, message: "教室名称不能为空" };
  const nameRes = parseText(name, { field: "教室名称", max: 50, required: true });
  if (!nameRes.ok) return { ok: false, message: nameRes.message };
  let cap = null;
  if (capacity !== null && capacity !== undefined && capacity !== "") {
    cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 0) {
      return { ok: false, message: "容量必须是不小于 0 的整数" };
    }
  }
  return { ok: true, name: nameRes.value, capacity: cap, remark: String(remark || "") };
}

/** 教室列表（登录可读；关键字搜索；教室数量少故不分页） */
router.get("/", auth, (req, res) => {
  const { keyword = "" } = req.query;
  let where = "";
  const params = [];
  if (keyword) {
    where = "WHERE name LIKE ? OR remark LIKE ?";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const list = db
    .prepare(
      `SELECT id, name, capacity, remark, created_at, updated_at FROM rooms ${where} ORDER BY name`
    )
    .all(...params);
  res.json({ success: true, data: list });
});

/** 新增教室（仅 admin） */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const parsed = parseRoomBody(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
  try {
    const r = db
      .prepare("INSERT INTO rooms (name, capacity, remark) VALUES (?, ?, ?)")
      .run(parsed.name, parsed.capacity, parsed.remark);
    res.json({ success: true, data: { id: r.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "教室名称已存在" });
    }
    throw err;
  }
});

/** 修改教室（仅 admin） */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const parsed = parseRoomBody(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
  try {
    const r = db
      .prepare(
        `UPDATE rooms SET name = ?, capacity = ?, remark = ?,
           updated_at = datetime('now','localtime') WHERE id = ?`
      )
      .run(parsed.name, parsed.capacity, parsed.remark, id);
    if (r.changes === 0) {
      return res.status(404).json({ success: false, message: "教室不存在" });
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "教室名称已存在" });
    }
    throw err;
  }
});

/** 删除教室（仅 admin）：被排课模板 / 课次引用则拒绝，并在提示里给出条数 */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM rooms WHERE id = ?").get(id)) {
    return res.status(404).json({ success: false, message: "教室不存在" });
  }
  const parts = [];
  const impacts = scanReferences("rooms", id); // schedules（有外键，自动发现）
  if (impacts.length) parts.push(describeImpacts(impacts));
  const sessCount = db
    .prepare("SELECT COUNT(*) AS c FROM class_sessions WHERE room_id = ?")
    .get(id).c; // 无外键 → 手工查
  if (sessCount > 0) parts.push(`课次 ${sessCount} 条（该教室将被置空）`);
  if (parts.length) {
    return res.status(400).json({
      success: false,
      message: `该教室仍被以下数据引用，无法删除：${parts.join("；")}`
    });
  }
  db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

module.exports = router;
