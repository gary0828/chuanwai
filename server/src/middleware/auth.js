// JWT 鉴权中间件（PC 与微信小程序等多端共用同一套鉴权）
//
// 安全约定（2026-09-12 上线门禁 B1 / H2 修复）：
// 1. JWT_SECRET 由 server/src/config.js 在启动期集中校验，缺失或过弱直接拒绝启动。
//    此前实现为 `process.env.JWT_SECRET || "attendance-secret-key-change-me"`，
//    会静默退化为源码中的公开默认值 —— 任何拿到源码的人都能自签 role:"admin"
//    的 token，读取全部学员档案、家长电话与缴费金额。
// 2. accessToken / refreshToken 均携带 token_version（tv）。鉴权时与 users 表比对，
//    因此「登出 / 改密 / 改角色 / 删号」可立即吊销该用户已签发的全部凭证
//    （JWT 本身无状态，此前 refreshToken 30 天内无法失效）。
const jwt = require("jsonwebtoken");
// config 必须先于 db 加载：配置非法时在打开/迁移数据库之前就终止（fail fast）
const config = require("../config");
const db = require("../db");

const SECRET = config.jwtSecret;

/** 日期格式化为 YYYY/MM/DD HH:mm:ss（与 pure-admin 前端 setToken 兼容） */
function formatDate(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 读取用户当前 token 版本号（用于校验凭证是否已被吊销） */
function currentTokenVersion(userId) {
  const row = db
    .prepare("SELECT token_version FROM users WHERE id = ?")
    .get(Number(userId));
  return row ? Number(row.token_version ?? 0) : null;
}

/** 吊销某用户已签发的全部凭证（登出 / 改密 / 改角色 / 删号时调用） */
function revokeTokens(userId) {
  db.prepare(
    "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?"
  ).run(Number(userId));
}

/** 签发 accessToken（7 天）与 refreshToken（30 天）；tv 用于吊销校验 */
function signTokens(user) {
  const tv = Number(user.token_version ?? 0);
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv },
    SECRET,
    { expiresIn: "7d" }
  );
  const refreshToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv, type: "refresh" },
    SECRET,
    { expiresIn: "30d" }
  );
  return {
    accessToken,
    refreshToken,
    expires: formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  };
}

/** 校验 Authorization: Bearer <token>，并确认凭证未被吊销 */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ success: false, message: "未登录或登录已过期" });
  }
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, message: "未登录或登录已过期" });
  }
  if (payload.type === "refresh") {
    return res.status(401).json({ success: false, message: "无效的访问凭证" });
  }
  // AI 教学工作台凭证（type=ai_agent）：只允许访问只读的 agent / ai 接口。
  // 工作台持有该凭证，但不因此获得调用教务系统写接口的能力（最小权限原则）。
  if (payload.type === "ai_agent") {
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (!/^\/api\/(agent|ai)(\/|$)/.test(path)) {
      return res.status(403).json({
        success: false,
        message: "该凭证仅可用于教学工作台的只读接口"
      });
    }
  }
  // 吊销校验：用户不存在、或 token 版本已过期（登出/改密/改角色/删号）即拒绝
  const tv = currentTokenVersion(payload.id);
  if (tv === null || tv !== Number(payload.tv ?? 0)) {
    return res
      .status(401)
      .json({ success: false, message: "登录状态已失效，请重新登录" });
  }
  req.user = {
    id: payload.id,
    username: payload.username,
    role: payload.role
  };
  next();
}

/** 角色校验：requireRole("admin") 或 requireRole("admin", "teacher") */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "无权限执行该操作" });
    }
    next();
  };
}

module.exports = {
  auth,
  requireRole,
  signTokens,
  revokeTokens,
  currentTokenVersion,
  formatDate,
  SECRET
};
