// 课程管理 CRUD
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { parseText } = require("../utils/validate");
const { scanReferences, describeImpacts } = require("../utils/delete-guard");

const router = express.Router();

/** 课程列表（支持名称/代码模糊搜索 + 分页） */
router.get("/", auth, (req, res) => {
  const { keyword = "", page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;
  const like = `%${keyword}%`;

  const total = db
    .prepare("SELECT COUNT(*) AS c FROM courses WHERE name LIKE ? OR code LIKE ?")
    .get(like, like).c;
  const list = db
    .prepare("SELECT * FROM courses WHERE name LIKE ? OR code LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(like, like, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 课程下拉（全部，供考勤登记选择） */
router.get("/all", auth, (_req, res) => {
  const list = db.prepare("SELECT id, code, name FROM courses ORDER BY id").all();
  res.json({ success: true, data: list });
});

/** 新增课程（仅 admin） */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const { code, name, teacher = "" } = req.body || {};
  if (!code || !name) {
    return res.status(400).json({ success: false, message: "课程代码与课程名称为必填项" });
  }
  const codeRes = parseText(code, { field: "课程代码", max: 30, required: true });
  if (!codeRes.ok) return res.status(400).json({ success: false, message: codeRes.message });
  const nameRes = parseText(name, { field: "课程名称", max: 50, required: true });
  if (!nameRes.ok) return res.status(400).json({ success: false, message: nameRes.message });
  try {
    const result = db
      .prepare("INSERT INTO courses (code, name, teacher) VALUES (?, ?, ?)")
      .run(code, name, teacher);
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "课程代码已存在" });
    }
    throw err;
  }
});

/** 修改课程（仅 admin） */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { code, name, teacher } = req.body || {};
  if (!code || !name) {
    return res.status(400).json({ success: false, message: "课程代码与课程名称为必填项" });
  }
  const codeRes = parseText(code, { field: "课程代码", max: 30, required: true });
  if (!codeRes.ok) return res.status(400).json({ success: false, message: codeRes.message });
  const nameRes = parseText(name, { field: "课程名称", max: 50, required: true });
  if (!nameRes.ok) return res.status(400).json({ success: false, message: nameRes.message });
  try {
    const result = db
      .prepare("UPDATE courses SET code = ?, name = ?, teacher = ? WHERE id = ?")
      .run(code, name, teacher || "", id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: "课程不存在" });
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "课程代码已存在" });
    }
    throw err;
  }
});

/** 删除课程（仅 admin）
 *  v13：扩展删除保护——考勤/课表/考试/课时流水任一存在则禁止删除（防止级联清空历史） */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(id)) {
    return res.status(404).json({ success: false, message: "课程不存在" });
  }

  // ★ 2026-09-26 改为「通用删除守卫」（K-052）：
  //   原实现手工列举了 4 张表（考勤/排课/考试/课消），而数据库里**实际有 14 张表**引用 courses，
  //   漏检的包括 orders.course_id（ON DELETE SET NULL → 订单课程被静默置空，
  //   该订单学员以后点名**永不扣课时**）、teaching_assignments / class_sessions（CASCADE → 被连带删除）。
  //   现由 PRAGMA foreign_key_list 自动发现全部引用，杜绝"随迁移新增表而漏检"。
  const impacts = scanReferences("courses", id);
  if (impacts.length > 0) {
    return res.status(400).json({
      success: false,
      message: `该课程已被以下数据引用，无法删除：${describeImpacts(impacts)}`
    });
  }

  db.prepare("DELETE FROM courses WHERE id = ?").run(id);
  res.json({ success: true, data: null });
});

module.exports = router;
