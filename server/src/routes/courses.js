// 课程管理 CRUD
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

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
  const attendanceCount = db
    .prepare("SELECT COUNT(*) AS c FROM attendances WHERE course_id = ?")
    .get(id).c;
  if (attendanceCount > 0) {
    return res.status(400).json({ success: false, message: "该课程已有考勤记录，无法删除" });
  }
  const schedCount = db.prepare("SELECT COUNT(*) AS c FROM schedules WHERE course_id = ?").get(id).c;
  if (schedCount > 0) {
    return res.status(400).json({ success: false, message: "该课程已排入课表，无法删除" });
  }
  const examCount = db.prepare("SELECT COUNT(*) AS c FROM exams WHERE course_id = ?").get(id).c;
  if (examCount > 0) {
    return res.status(400).json({ success: false, message: "该课程存在考试记录，无法删除" });
  }
  const consCount = db.prepare("SELECT COUNT(*) AS c FROM hour_consumptions WHERE course_id = ?").get(id).c;
  if (consCount > 0) {
    return res.status(400).json({ success: false, message: "该课程存在课时消耗流水，无法删除" });
  }
  const result = db.prepare("DELETE FROM courses WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, message: "课程不存在" });
  }
  res.json({ success: true, data: null });
});

module.exports = router;
