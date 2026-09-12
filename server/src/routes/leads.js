// 招生线索：新增/跟进/状态流转/转化（转化时自动创建学员档案与报班订单）/渠道统计
// 权限：admin 全量；teacher 仅可操作自己创建的线索（follow_user_id）；删除仅 admin
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageClass } = require("../utils/scope");
const { audit } = require("../utils/audit");

const router = express.Router();

const SOURCES = ["转介绍", "线上", "地推", "广告"];

/** 教师范围：仅自己创建的线索（l 为 leads 别名） */
function leadScope(req) {
  if (req.user.role !== "teacher") return { where: "", params: [] };
  return { where: " AND l.follow_user_id = ?", params: [req.user.id] };
}

/** 校验线索是否当前用户可操作（admin 恒 true） */
function canManageLead(req, leadId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare("SELECT 1 FROM leads WHERE id = ? AND follow_user_id = ?")
    .get(Number(leadId), req.user.id);
  return !!row;
}

function parseRecords(text) {
  try {
    const arr = JSON.parse(text || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 线索列表（分页 + 状态/渠道/关键字筛选） */
router.get("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { status, source, keyword, page = 1, pageSize = 10 } = req.query;
  const scope = leadScope(req);
  const conds = [];
  const params = [];
  if (status) {
    conds.push("l.status = ?");
    params.push(status);
  }
  if (source) {
    conds.push("l.source = ?");
    params.push(source);
  }
  if (keyword) {
    conds.push("(l.name LIKE ? OR l.phone LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const where = (conds.length ? conds.join(" AND ") : "1=1") + scope.where;
  const allParams = [...params, ...scope.params];

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM leads l WHERE ${where}`)
    .get(...allParams).c;
  const list = db
    .prepare(
      `
    SELECT l.id, l.name, l.phone, l.source, l.status, l.remark,
           l.follow_records, l.created_at, l.updated_at,
           cu.id AS course_id, cu.name AS course_name,
           u.name AS follow_user_name,
           s.student_no, s.name AS converted_name
    FROM leads l
    LEFT JOIN courses cu ON cu.id = l.intent_course_id
    LEFT JOIN users u ON u.id = l.follow_user_id
    LEFT JOIN students s ON s.id = l.converted_student_id
    WHERE ${where}
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...allParams, Number(pageSize), (Number(page) - 1) * Number(pageSize));

  // 补充跟进记录解析后的笔数
  const rows = list.map(r => ({
    ...r,
    follow_count: parseRecords(r.follow_records).length
  }));
  res.json({ success: true, data: { list: rows, total } });
});

/** 新增线索 */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const {
    name,
    phone = "",
    intent_course_id,
    source = "转介绍",
    remark = ""
  } = req.body || {};
  if (!name)
    return res.status(400).json({ success: false, message: "请输入线索姓名" });
  if (!SOURCES.includes(source)) {
    return res.status(400).json({ success: false, message: "来源渠道不合法" });
  }
  const info = db
    .prepare(
      `
    INSERT INTO leads (name, phone, intent_course_id, source, follow_user_id, remark)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      name.trim(),
      phone,
      intent_course_id ? Number(intent_course_id) : null,
      source,
      req.user.id,
      remark
    );
  audit(req.user, "新增招生线索", `线索#${info.lastInsertRowid} ${name}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 修改线索基本信息 */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageLead(req, id)) {
    return res.status(403).json({ success: false, message: "无权操作该线索" });
  }
  const { name, phone, intent_course_id, source, remark } = req.body || {};
  if (!name)
    return res.status(400).json({ success: false, message: "请输入线索姓名" });
  if (source && !SOURCES.includes(source)) {
    return res.status(400).json({ success: false, message: "来源渠道不合法" });
  }
  const info = db
    .prepare(
      `
    UPDATE leads SET name = ?, phone = ?, intent_course_id = ?, source = ?, remark = ?,
           updated_at = datetime('now','localtime')
    WHERE id = ?
  `
    )
    .run(
      name.trim(),
      phone || "",
      intent_course_id ? Number(intent_course_id) : null,
      source || "转介绍",
      remark || "",
      id
    );
  if (info.changes === 0)
    return res.status(404).json({ success: false, message: "线索不存在" });
  audit(req.user, "修改招生线索", `线索#${id}`);
  res.json({ success: true, data: null });
});

/** 添加跟进记录（追加到 follow_records JSON） */
router.put("/:id/follow", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageLead(req, id)) {
    return res.status(403).json({ success: false, message: "无权操作该线索" });
  }
  const { content } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ success: false, message: "请填写跟进内容" });
  }
  const lead = db
    .prepare("SELECT follow_records FROM leads WHERE id = ?")
    .get(id);
  if (!lead)
    return res.status(404).json({ success: false, message: "线索不存在" });

  const records = parseRecords(lead.follow_records);
  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  records.push({
    time,
    user: req.user.username,
    content: String(content).trim()
  });
  const info = db
    .prepare(
      `
    UPDATE leads SET follow_records = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `
    )
    .run(JSON.stringify(records), id);
  if (info.changes === 0)
    return res.status(404).json({ success: false, message: "线索不存在" });
  audit(req.user, "跟进招生线索", `线索#${id}`);
  res.json({ success: true, data: { records } });
});

/** 状态流转（新线索/跟进中/已流失） */
router.put("/:id/status", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageLead(req, id)) {
    return res.status(403).json({ success: false, message: "无权操作该线索" });
  }
  const { status } = req.body || {};
  if (!["新线索", "跟进中", "已流失"].includes(status)) {
    return res.status(400).json({ success: false, message: "无效的线索状态" });
  }
  const info = db
    .prepare(
      `
    UPDATE leads SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `
    )
    .run(status, id);
  if (info.changes === 0)
    return res.status(404).json({ success: false, message: "线索不存在" });
  audit(req.user, "流转招生线索", `线索#${id} → ${status}`);
  res.json({ success: true, data: null });
});

/** 标记转化：自动创建学员档案 + 报班订单（事务） */
router.put(
  "/:id/convert",
  auth,
  requireRole("admin", "teacher"),
  (req, res) => {
    const id = Number(req.params.id);
    if (!canManageLead(req, id)) {
      return res
        .status(403)
        .json({ success: false, message: "无权操作该线索" });
    }
    const { class_id, course_id, amount = 0, remark = "" } = req.body || {};
    if (!class_id)
      return res
        .status(400)
        .json({ success: false, message: "请选择学员班级" });
    if (!canManageClass(req, class_id)) {
      return res
        .status(403)
        .json({ success: false, message: "无权将该学员分配到该班级" });
    }
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
    if (!lead)
      return res.status(404).json({ success: false, message: "线索不存在" });
    if (lead.status === "已转化" || lead.status === "已流失") {
      return res.status(400).json({
        success: false,
        message: "该线索已转化或已流失，无法再次转化"
      });
    }
    if (lead.converted_student_id) {
      return res
        .status(400)
        .json({ success: false, message: "该线索已生成学员档案" });
    }
    if (lead.phone) {
      const exist = db
        .prepare("SELECT id FROM students WHERE phone = ?")
        .get(lead.phone);
      if (exist) {
        return res.status(400).json({
          success: false,
          message: "该手机号已有学员档案，请勿重复转化"
        });
      }
    }

    // 生成学号：当前年份 + 3 位递增序号（与既有学号不冲突）
    const year = String(new Date().getFullYear());
    const maxNo = db
      .prepare(
        "SELECT student_no FROM students WHERE student_no LIKE ? ORDER BY student_no DESC LIMIT 1"
      )
      .get(`${year}%`);
    const studentNo = maxNo
      ? String(Number(maxNo.student_no) + 1)
      : `${year}001`;

    db.exec("BEGIN");
    try {
      const studentId = db
        .prepare(
          `
      INSERT INTO students (student_no, name, gender, phone, class_id, status, source_channel, enroll_date, parent_name, parent_phone)
      VALUES (?, ?, '男', ?, ?, '在读', ?, ?, ?, ?)
    `
        )
        .run(
          studentNo,
          lead.name,
          lead.phone || "",
          Number(class_id),
          lead.source,
          new Date().toLocaleDateString("sv"),
          `${lead.name}家长`,
          lead.phone || ""
        ).lastInsertRowid;
      db.prepare(
        `
      INSERT INTO orders (student_id, class_id, course_id, enroll_date, amount, status, enroll_user_id, remark)
      VALUES (?, ?, ?, ?, ?, '在读', ?, ?)
    `
      ).run(
        studentId,
        Number(class_id),
        course_id ? Number(course_id) : lead.intent_course_id,
        new Date().toLocaleDateString("sv"),
        Number(amount) || 0,
        req.user.id,
        remark || "线索转化建档"
      );
      db.prepare(
        `
      UPDATE leads SET status = '已转化', converted_student_id = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `
      ).run(studentId, id);
      db.exec("COMMIT");
      audit(req.user, "线索转化", `线索#${id} → 学员#${studentId}`);
      res.json({
        success: true,
        data: { student_id: studentId, student_no: studentNo }
      });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
);

/** 删除线索（仅 admin）
 *  v13：已转化线索禁止删除（避免转化率统计失真） */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const lead = db.prepare("SELECT status FROM leads WHERE id = ?").get(id);
  if (!lead)
    return res.status(404).json({ success: false, message: "线索不存在" });
  if (lead.status === "已转化") {
    return res.status(400).json({
      success: false,
      message: "已转化的线索不可删除（已生成学员档案）"
    });
  }
  const info = db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  if (info.changes === 0)
    return res.status(404).json({ success: false, message: "线索不存在" });
  audit(req.user, "删除招生线索", `线索#${id}`);
  res.json({ success: true, data: null });
});

/** 渠道转化统计（按来源渠道聚合：总数/跟进中/已转化/转化率） */
router.get(
  "/stats/channels",
  auth,
  requireRole("admin", "teacher"),
  (req, res) => {
    const scope = leadScope(req);
    const rows = db
      .prepare(
        `
    SELECT l.source,
           COUNT(*) AS total,
           SUM(CASE WHEN l.status = '跟进中' THEN 1 ELSE 0 END) AS following,
           SUM(CASE WHEN l.status = '已转化' THEN 1 ELSE 0 END) AS converted
    FROM leads l
    WHERE 1=1 ${scope.where}
    GROUP BY l.source
  `
      )
      .all(...scope.params);
    const list = rows.map(r => ({
      source: r.source,
      total: Number(r.total || 0),
      following: Number(r.following || 0),
      converted: Number(r.converted || 0),
      convert_rate:
        Number(r.total) > 0
          ? Number((((r.converted || 0) / r.total) * 100).toFixed(1))
          : 0
    }));
    const totals = list.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        following: acc.following + r.following,
        converted: acc.converted + r.converted
      }),
      { total: 0, following: 0, converted: 0 }
    );
    res.json({
      success: true,
      data: {
        list,
        summary: {
          ...totals,
          convert_rate:
            totals.total > 0
              ? Number(((totals.converted / totals.total) * 100).toFixed(1))
              : 0
        }
      }
    });
  }
);

module.exports = router;
