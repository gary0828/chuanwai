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
  // AI 教学工作台凭证（type=ai_agent）：默认只允许访问 agent / ai 接口。
  //
  // ── 为什么放行 /api/growth（2026-09-18 人群分离定案）────────────────
  // 教务系统给校区负责人/非一线教学人员用，教学 AI 工作台给一线老师用；
  // **老师要用的功能一律收在工作台**。于是「课后随手记」和「看学生成长路径」
  // 两件事都落在工作台，二者用的是同一个数据域，因此整体放行 /api/growth。
  //
  // 关键点：读写必须同权。曾一度只放行写（采集端）、挡住读（查询端），
  // 结果是老师能往班里写数据却看不到自己写的数据，成长路径页整页 403 —— 那是错的。
  //
  // 安全边界（不是靠"挡住读"，而是靠这三个约束）：
  //   1. 全部端点内部复用 utils/scope.js 的 canManageClass / canManageStudent，
  //      **老师只能碰自己带的班**，跨班一律 403（与教务系统内完全一致）；
  //   2. 数据域只含教学口径（出勤/课堂表现/知识点/成绩/课时数量），
  //      **不含金额、订单、退费、家长信息**（timeline.js 落库前还有 scrubPayload 兜底）；
  //   3. 管理动作仍然挡住：PUT /thresholds（改全局阈值，仅 admin）。
  //      该路径以管理动作白名单形式排除，而非按方法粗粒度放行。
  //
  // 其余 /api/* 一律仍挡（财务、用户、班级增删改、学生增删改……）。
  if (payload.type === "ai_agent") {
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    const READ_ONLY_OK = /^\/api\/(agent|ai)(\/|$)/.test(path);
    const GROWTH_OK = /^\/api\/growth(\/|$)/.test(path);
    // 管理动作：即使在 /api/growth 内也不放行（改全局成长阈值）
    const ADMIN_ONLY = path === "/api/growth/thresholds" && req.method !== "GET";
    if ((!READ_ONLY_OK && !GROWTH_OK) || ADMIN_ONLY) {
      return res.status(403).json({
        success: false,
        message: ADMIN_ONLY
          ? "成长阈值属于管理配置，请用教务系统管理员账号操作"
          : "该凭证仅可用于教学工作台的只读接口与课堂采集接口"
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
