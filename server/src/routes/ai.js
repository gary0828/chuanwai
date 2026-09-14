// AI 教学工作台接入：免登票据签发与校验
//
// 链路：
//   教务系统已登录 → POST /api/ai/sso/ticket（需鉴权）取一次性票据
//   → 浏览器跳转 <工作台>/#/sso?ticket=xxx
//   → 工作台 POST /api/ai/sso/verify（公开）换取会话
//
// 安全设计：
// 1. 票据 60 秒有效且一次性（jti 用后即废），显著压缩重放窗口；
// 2. 票据携带 token_version，登出 / 改密 / 改角色后票据立即失效（与既有 H2 机制一致）；
// 3. ticket 放在 URL 的 hash 片段中，浏览器不会把它发给任何服务器，不落访问日志；
// 4. 票据只证明「该用户此刻已在教务系统登录」，不授予教务系统任何写权限。
//
// 注意：已用票据记录在进程内存中，多实例部署需改为数据库或 Redis 存储。
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const db = require("../db");
const { auth, requireRole, SECRET } = require("../middleware/auth");
const llm = require("../utils/llm");
const redact = require("../utils/redact");
const prompts = require("../utils/prompts");

const router = express.Router();

const TICKET_TTL_SEC = 60;
const TICKET_TYPE = "ai_sso";
/** 工作台凭证有效期：覆盖一个工作日的使用即可，过期需重新从教务系统进入 */
const AGENT_TOKEN_TTL = "12h";

/** 已使用票据：jti -> 过期时间（毫秒） */
const usedTickets = new Map();

// 定期清理过期条目，避免长期运行内存增长
setInterval(() => {
  const now = Date.now();
  for (const [jti, expireAt] of usedTickets) {
    if (expireAt <= now) usedTickets.delete(jti);
  }
}, 30 * 1000).unref();

/** 签发免登票据（需已登录） */
router.post("/sso/ticket", auth, (req, res) => {
  const user = db
    .prepare("SELECT id, username, role, token_version FROM users WHERE id = ?")
    .get(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, message: "用户不存在" });
  }

  const jti = crypto.randomUUID();
  const ticket = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tv: Number(user.token_version ?? 0),
      type: TICKET_TYPE,
      jti
    },
    SECRET,
    { expiresIn: TICKET_TTL_SEC }
  );

  // URL 用 hash 路由承载票据，避免随请求发送到服务器
  const url = `${config.aiWorkbenchUrl}/#/sso?ticket=${encodeURIComponent(ticket)}`;

  res.json({
    success: true,
    data: { ticket, url, expiresIn: TICKET_TTL_SEC }
  });
});

/** 校验票据并换取工作台会话（公开端点，票据本身即凭证） */
router.post("/sso/verify", (req, res) => {
  const { ticket } = req.body || {};
  if (!ticket || typeof ticket !== "string") {
    return res.status(400).json({ success: false, message: "缺少票据" });
  }

  let payload;
  try {
    payload = jwt.verify(ticket, SECRET);
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "票据无效或已过期，请返回教务系统重新进入" });
  }

  if (payload.type !== TICKET_TYPE) {
    return res.status(401).json({ success: false, message: "票据类型不正确" });
  }

  const jti = payload.jti;
  if (!jti || usedTickets.has(jti)) {
    return res
      .status(401)
      .json({ success: false, message: "该票据已被使用，请返回教务系统重新进入" });
  }

  const user = db
    .prepare("SELECT id, name, role, token_version FROM users WHERE id = ?")
    .get(payload.id);
  if (!user) {
    return res.status(401).json({ success: false, message: "用户不存在" });
  }

  // 吊销校验：登出 / 改密 / 改角色后，此前签发的票据一并失效
  if (Number(user.token_version ?? 0) !== Number(payload.tv ?? 0)) {
    return res
      .status(401)
      .json({ success: false, message: "登录状态已失效，请重新登录后再进入" });
  }

  usedTickets.set(jti, Date.now() + TICKET_TTL_SEC * 1000);

  // 工作台专用凭证：仅可访问只读的 agent / ai 接口，
  // 由 middleware/auth.js 按 type 做路径校验（最小权限，不授予教务写能力）
  const agentToken = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tv: Number(user.token_version ?? 0),
      type: "ai_agent"
    },
    SECRET,
    { expiresIn: AGENT_TOKEN_TTL }
  );

  res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      role: user.role,
      loginAt: new Date().toISOString(),
      // 工作台据此决定可用范围（教师版 / 教务版）
      scope: user.role === "admin" ? "all" : "own",
      agentToken,
      expiresIn: AGENT_TOKEN_TTL
    }
  });
});

/* ---------------------- 服务端模型生成（可选能力） ---------------------- */

/**
 * POST /api/ai/generate
 * 由**服务端**调用大模型生成文案 —— API Key 只存服务端环境变量，不下发前端。
 * 未配置模型时返回 503，工作台据此自动回退规则引擎（不阻塞教学流程）。
 */
router.post(
  "/generate",
  auth,
  requireRole("admin", "teacher"),
  async (req, res, next) => {
    try {
      const { scene, payload, extra } = req.body || {};

      // 参数校验优先于能力检查：参数错误就是 400，与模型是否配置无关
      if (!prompts.isScene(scene)) {
        return res
          .status(400)
          .json({ success: false, message: `不支持的场景：${scene}` });
      }
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ success: false, message: "缺少 payload" });
      }

      if (!llm.isConfigured()) {
        return res.status(503).json({
          success: false,
          code: "LLM_NOT_CONFIGURED",
          message: "服务端未配置模型（LLM_API_KEY 为空），请回退规则引擎或联系管理员配置"
        });
      }

      // 服务端二次脱敏：不信任前端（工作台是独立部署的静态应用，任何人可改）
      const { safe, removed } = redact.redactDeep(payload);
      const messages = prompts.buildMessages(
        scene,
        safe,
        typeof extra === "string"
          ? redact.scrubText(extra).slice(0, 500)
          : undefined
      );

      const result = await llm.chat(messages);

      res.json({
        success: true,
        data: {
          scene,
          sceneLabel: prompts.sceneLabel(scene),
          text: result.text,
          model: result.model,
          usage: result.usage,
          redactedByServer: removed,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (err) {
      if (err.code === "LLM_NOT_CONFIGURED") {
        return res
          .status(503)
          .json({ success: false, code: err.code, message: err.message });
      }
      if (
        err.code === "LLM_TIMEOUT" ||
        err.code === "LLM_HTTP_ERROR" ||
        err.code === "LLM_EMPTY"
      ) {
        return res
          .status(502)
          .json({ success: false, code: err.code, message: err.message });
      }
      next(err);
    }
  }
);

/** 模型可用状态（工作台据此决定是否展示「服务端模型」选项） */
router.get("/llm-status", auth, (_req, res) => {
  res.json({
    success: true,
    data: {
      configured: llm.isConfigured(),
      model: llm.isConfigured() ? llm.currentModel() : null
    }
  });
});

module.exports = router;
