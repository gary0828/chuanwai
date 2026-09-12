// JWT 鉴权中间件（无状态，PC 与微信小程序等多端共用同一套鉴权）
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "attendance-secret-key-change-me";

/** 日期格式化为 YYYY/MM/DD HH:mm:ss（与 pure-admin 前端 setToken 兼容） */
function formatDate(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 签发 accessToken（7 天）与 refreshToken（30 天） */
function signTokens(user) {
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "7d" }
  );
  const refreshToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role, type: "refresh" },
    SECRET,
    { expiresIn: "30d" }
  );
  return {
    accessToken,
    refreshToken,
    expires: formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  };
}

/** 校验 Authorization: Bearer <token> */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ success: false, message: "未登录或登录已过期" });
  }
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.type === "refresh") {
      return res.status(401).json({ success: false, message: "无效的访问凭证" });
    }
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "未登录或登录已过期" });
  }
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

module.exports = { auth, requireRole, signTokens, formatDate, SECRET };
