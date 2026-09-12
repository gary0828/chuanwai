// 学生管理 CRUD + 批量导入/导出（纯档案管理，无账号概念）
// 数据权限：教师仅可见/管理自己绑定班级的学生；管理员不限
// v14：学生不登录、无账号；家长信息（姓名/电话）直接存于档案字段
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const {
  studentScopeWhere,
  canManageStudent,
  canManageClass
} = require("../utils/scope");

const router = express.Router();

const GENDERS = ["男", "女"];
const STATUSES = ["在读", "休学", "退学"];

/** 学生列表（班级/姓名/学号/keyword 过滤 + 分页；教师仅本班） */
router.get("/", auth, (req, res) => {
  const {
    class_id,
    name = "",
    student_no = "",
    keyword = "",
    page = 1,
    pageSize = 10
  } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;
  const scope = studentScopeWhere(req);

  let where = "WHERE 1=1";
  const params = [...scope.params];
  if (class_id) {
    where += " AND s.class_id = ?";
    params.push(Number(class_id));
  }
  if (name) {
    where += " AND s.name LIKE ?";
    params.push(`%${name}%`);
  }
  if (student_no) {
    where += " AND s.student_no LIKE ?";
    params.push(`%${student_no}%`);
  }
  if (keyword) {
    // 模糊匹配姓名或学号（用于学员搜索等场景）
    where += " AND (s.name LIKE ? OR s.student_no LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM students s ${where}${scope.where}`)
    .get(...params).c;
  const list = db
    .prepare(
      `SELECT s.*, c.name AS class_name
       FROM students s LEFT JOIN classes c ON s.class_id = c.id
       ${where}${scope.where} ORDER BY s.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 学生全量导出（与列表同筛选、不分页；供前端导出 Excel） */
router.get("/export", auth, (req, res) => {
  const { class_id, name = "", student_no = "" } = req.query;
  const scope = studentScopeWhere(req);

  let where = "WHERE 1=1";
  const params = [...scope.params];
  if (class_id) {
    where += " AND s.class_id = ?";
    params.push(Number(class_id));
  }
  if (name) {
    where += " AND s.name LIKE ?";
    params.push(`%${name}%`);
  }
  if (student_no) {
    where += " AND s.student_no LIKE ?";
    params.push(`%${student_no}%`);
  }

  const list = db
    .prepare(
      `SELECT s.student_no, s.name, s.gender, s.phone, s.email, c.name AS class_name, s.status,
              s.parent_name, s.parent_phone, s.source_channel, s.enroll_date
       FROM students s LEFT JOIN classes c ON s.class_id = c.id
       ${where}${scope.where} ORDER BY s.class_id, s.student_no`
    )
    .all(...params);

  res.json({ success: true, data: { list } });
});

/** 新增学生（admin / teacher；教师只能分配到本班；家长信息与来源渠道随档案录入） */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const {
    student_no,
    name,
    gender = "男",
    phone = "",
    email = "",
    class_id,
    status = "在读",
    parent_name = "",
    parent_phone = "",
    source_channel = "",
    enroll_date = ""
  } = req.body || {};
  if (!student_no || !name || !class_id) {
    return res
      .status(400)
      .json({ success: false, message: "学号、姓名、班级为必填项" });
  }
  if (!GENDERS.includes(gender) || !STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ success: false, message: "性别或学籍状态不合法" });
  }
  if (!canManageClass(req, class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权将学生分配到该班级" });
  }
  try {
    db.exec("BEGIN");
    try {
      const result = db
        .prepare(
          "INSERT INTO students (student_no, name, gender, phone, email, class_id, status, parent_name, parent_phone, source_channel, enroll_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          student_no,
          name,
          gender,
          phone,
          email,
          Number(class_id),
          status,
          parent_name,
          parent_phone,
          source_channel,
          enroll_date
        );
      db.exec("COMMIT");
      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "学号已存在" });
    }
    throw err;
  }
});

/** 批量导入学生（前端解析 Excel 后提交 JSON 数组；逐条返回成败明细） */
router.post("/import", auth, requireRole("admin", "teacher"), (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "请先选择要导入的数据" });
  }

  const insert = db.prepare(
    "INSERT INTO students (student_no, name, gender, phone, email, class_id, status, parent_name, parent_phone, source_channel, enroll_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const fails = [];
  let successCount = 0;
  const existing = new Set(
    db
      .prepare("SELECT student_no FROM students")
      .all()
      .map(r => r.student_no)
  );

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const line = row.__line || i + 1;
    const {
      student_no,
      name,
      gender = "男",
      phone = "",
      email = "",
      class_id,
      status = "在读",
      parent_name = "",
      parent_phone = ""
    } = row;
    let reason = "";
    if (!student_no || !name || !class_id) reason = "学号、姓名、班级为必填项";
    else if (!GENDERS.includes(gender)) reason = "性别不合法（男/女）";
    else if (!STATUSES.includes(status))
      reason = "学籍状态不合法（在读/休学/退学）";
    else if (!canManageClass(req, class_id)) reason = "无权分配到该班级";
    else if (existing.has(String(student_no))) reason = "学号已存在";
    if (reason) {
      fails.push({ line, student_no, name, reason });
      continue;
    }
    try {
      db.exec("BEGIN");
      try {
        insert.run(
          student_no,
          name,
          gender,
          phone,
          email,
          Number(class_id),
          status,
          parent_name,
          parent_phone
        );
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      existing.add(String(student_no));
      successCount++;
    } catch (err) {
      fails.push({
        line,
        student_no,
        name,
        reason: String(err.message).includes("UNIQUE")
          ? "学号已存在"
          : "写入失败"
      });
    }
  }

  res.json({
    success: true,
    data: {
      total: records.length,
      successCount,
      failCount: fails.length,
      fails
    }
  });
});

/** 修改学生（admin / teacher，仅可改本班学生；教师只能分配到本班；转班联动订单） */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const {
    student_no,
    name,
    gender,
    phone,
    email,
    class_id,
    status,
    parent_name,
    parent_phone,
    source_channel,
    enroll_date
  } = req.body || {};
  if (!student_no || !name || !class_id) {
    return res
      .status(400)
      .json({ success: false, message: "学号、姓名、班级为必填项" });
  }
  if (!canManageStudent(req, id)) {
    return res.status(403).json({ success: false, message: "无权管理该学生" });
  }
  if (!canManageClass(req, class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权将学生分配到该班级" });
  }
  try {
    db.exec("BEGIN");
    try {
      const cur = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
      if (!cur) {
        db.exec("ROLLBACK");
        return res.status(404).json({ success: false, message: "学生不存在" });
      }
      db.prepare(
        "UPDATE students SET student_no = ?, name = ?, gender = ?, phone = ?, email = ?, class_id = ?, status = ?, parent_name = ?, parent_phone = ?, source_channel = ?, enroll_date = ? WHERE id = ?"
      ).run(
        student_no,
        name,
        gender ?? cur.gender, // 缺省字段复用原值，避免 undefined 绑定失败（node:sqlite）
        phone ?? cur.phone,
        email ?? cur.email,
        Number(class_id),
        status ?? cur.status,
        parent_name ?? cur.parent_name,
        parent_phone ?? cur.parent_phone,
        source_channel ?? cur.source_channel,
        enroll_date ?? cur.enroll_date,
        id
      );
      // 转班联动：在读订单班级跟随（考勤与财务口径一致）
      if (Number(class_id) !== cur.class_id) {
        db.prepare(
          "UPDATE orders SET class_id = ?, updated_at = datetime('now','localtime') WHERE student_id = ? AND status = '在读'"
        ).run(Number(class_id), id);
      }
      db.exec("COMMIT");
      res.json({ success: true, data: null });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "学号已存在" });
    }
    throw err;
  }
});

/** 删除学生（admin / teacher，仅可删本班学生；级联删除历史业务记录）
 *  删除策略：有订单（财务记录）→ 400 保护；其他业务记录（考勤/请假/通知/成绩等）允许级联清理，
 *  响应中返回将级联删除的数量统计供前端二次确认（问题 7 修复） */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageStudent(req, id)) {
    return res.status(403).json({ success: false, message: "无权管理该学生" });
  }
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
  if (!student) {
    return res.status(404).json({ success: false, message: "学生不存在" });
  }
  const orders = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE student_id = ?")
    .get(id).c;
  if (orders > 0) {
    return res.status(400).json({
      success: false,
      message: "该学员存在报班/缴费/退费记录，请先处理相关订单"
    });
  }
  // 统计将级联删除的历史数据（供前端提示）
  const tables = [
    ["考勤记录", "attendances"],
    ["请假记录", "leaves"],
    ["补课记录", "makeup_classes"],
    ["课时消耗流水", "hour_consumptions"],
    ["通知记录", "notifications"],
    ["考试成绩", "exam_scores"]
  ];
  const cascade = {};
  for (const [label, table] of tables) {
    const c = db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE student_id = ?`)
      .get(id).c;
    if (c > 0) cascade[label] = c;
  }
  try {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM students WHERE id = ?").run(id);
      db.exec("COMMIT");
      res.json({ success: true, data: { cascade } });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    const msg = String(err.message);
    if (msg.includes("FOREIGN KEY") || msg.includes("constraint")) {
      return res
        .status(400)
        .json({ success: false, message: "该学员存在关联数据，无法删除" });
    }
    throw err;
  }
});

module.exports = router;
