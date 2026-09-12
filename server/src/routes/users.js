// 员工账号管理：仅管理员管理内部员工账号（admin / teacher）
// 定位：纯员工端 CRM——学生/家长无账号不登录，账号体系只保留员工
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { auth, requireRole, revokeTokens } = require("../middleware/auth");

const router = express.Router();

const VALID_ROLES = ["admin", "teacher"];

/** 员工列表（分页 + 角色/关键字筛选；仅 admin） */
router.get("/", auth, requireRole("admin"), (req, res) => {
  const { role = "", keyword = "", page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  if (role && VALID_ROLES.includes(role)) {
    where += " AND u.role = ?";
    params.push(role);
  }
  if (keyword) {
    where +=
      " AND (u.username LIKE ? OR u.name LIKE ? OR COALESCE(u.phone,'') LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM users u ${where}`)
    .get(...params).c;
  const list = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, u.phone, u.created_at
       FROM users u
       ${where}
       ORDER BY u.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 创建员工账号（admin / teacher） */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const {
    username,
    password,
    name,
    role = "teacher",
    phone = ""
  } = req.body || {};
  if (!username || !password || !name) {
    return res
      .status(400)
      .json({ success: false, message: "用户名、密码、姓名为必填项" });
  }
  if (!VALID_ROLES.includes(role)) {
    return res
      .status(400)
      .json({ success: false, message: "角色不合法，可选：管理员/教师" });
  }
  try {
    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?)"
      )
      .run(username, bcrypt.hashSync(password, 10), name, role, phone || null);
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res
        .status(400)
        .json({ success: false, message: "用户名或手机号已存在" });
    }
    throw err;
  }
});

/** 修改员工账号（姓名/角色/手机号；不能修改自己的角色） */
router.put("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { name, role, phone } = req.body || {};
  if (role && !VALID_ROLES.includes(role)) {
    return res
      .status(400)
      .json({ success: false, message: "角色不合法，可选：管理员/教师" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) {
    return res.status(404).json({ success: false, message: "用户不存在" });
  }
  if (id === req.user.id && role && role !== req.user.role) {
    return res
      .status(400)
      .json({ success: false, message: "不能修改自己的角色" });
  }
  try {
    db.prepare(
      "UPDATE users SET name = ?, role = ?, phone = ? WHERE id = ?"
    ).run(
      name || user.name,
      role || user.role,
      phone !== undefined ? phone : user.phone,
      id
    );
    // 角色变更即吊销该员工已签发凭证，避免旧 token 保留旧角色的权限（H2）
    if (role && role !== user.role) revokeTokens(id);
    res.json({ success: true, data: null });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res
        .status(400)
        .json({ success: false, message: "用户名或手机号已存在" });
    }
    throw err;
  }
});

/** 重置密码（重置后吊销该员工全部已签发凭证，强制重新登录） */
router.put("/:id/password", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ success: false, message: "请输入新密码" });
  }
  if (String(password).length < 8) {
    return res
      .status(400)
      .json({ success: false, message: "密码长度至少 8 位" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) {
    return res.status(404).json({ success: false, message: "用户不存在" });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(password, 10),
    id
  );
  // 改密即吊销旧凭证：防止密码泄露后已签发的 token 继续可用（H2）
  revokeTokens(id);
  res.json({ success: true, data: null });
});

/** 删除员工账号（不能删除自己；系统至少保留一个 admin）
 *  删除前检查班主任/审计/公告关联，给出友好提示 */
router.delete("/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res
      .status(400)
      .json({ success: false, message: "不能删除当前登录账号" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) {
    return res.status(404).json({ success: false, message: "用户不存在" });
  }
  if (user.role === "admin") {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")
      .get().c;
    if (adminCount <= 1) {
      return res
        .status(400)
        .json({ success: false, message: "系统至少保留一个管理员账号" });
    }
  }
  const headClass = db
    .prepare("SELECT COUNT(*) AS c FROM classes WHERE head_teacher_id = ?")
    .get(id);
  if (headClass.c > 0) {
    return res.status(400).json({
      success: false,
      message: "该用户是班级班主任，请先在班级管理中解绑后再删除"
    });
  }
  const auditCnt = db
    .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE user_id = ?")
    .get(id);
  if (auditCnt.c > 0) {
    return res
      .status(400)
      .json({ success: false, message: "该用户存在操作审计记录，无法删除" });
  }
  const noticeCnt = db
    .prepare("SELECT COUNT(*) AS c FROM notices WHERE creator_id = ?")
    .get(id);
  if (noticeCnt.c > 0) {
    return res
      .status(400)
      .json({ success: false, message: "该用户发布过公告，无法删除" });
  }
  try {
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    res.json({ success: true, data: null });
  } catch (err) {
    const msg = String(err.message);
    if (msg.includes("FOREIGN KEY") || msg.includes("constraint")) {
      return res
        .status(400)
        .json({ success: false, message: "该用户存在关联数据，无法删除" });
    }
    throw err;
  }
});

module.exports = router;
