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
const aiSettings = require("../utils/aiSettings");

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

/**
 * 解析工作台跳转基址。
 *
 * 背景（2026-09-16 校区部署实测暴露的缺陷）：
 * `AI_WORKBENCH_URL` 默认 `http://localhost:8082`，而 **localhost 指的是打开浏览器的
 * 那台电脑**。老师用自己的电脑访问校区机器上的教务系统时，免登链接会把他们带到
 * "自己电脑的 8082" —— 必然打不开（表现：页面空白 / 回落到演示身份）。
 * 所以配置是回环地址时，必须把主机换成「访问者正在访问的那个主机」。
 *
 * ★★ 关键：换的只是**主机名**，不是整个 origin（2026-09-20 二次修正）
 *   代码需同时兼容两种配置（本项目默认且唯一形态是 B 统一入口）：
 *
 *   A. 工作台在**另一台机器 / 另一个端口**（AI_WORKBENCH_BASE_PATH 为空）：
 *      ⇒ 必须**保留配置里的端口**，只把 host 换掉。
 *        `localhost:8082` + 访问者 192.168.1.20 → `192.168.1.20:8082` ✅
 *        若误用访问者 origin，会得到 `192.168.1.20:80` —— 那台机器没有这个服务，打不开。
 *
 *   B. 统一入口（docker-compose.yml，2026-09-23 起唯一部署形态）：
 *      一个 nginx 同时托管两端，工作台挂在 /ai/ 子路径，
 *      配置是 `http://localhost` + BASE_PATH=/ai。
 *      ⇒ 此时端口应跟随访问者（访问者用 80/443/自定义端口都能对），
 *        `localhost` + 访问者 https://school.com → `https://school.com/ai` ✅
 *        若硬套配置端口，会跳到 `school.com:80`（HTTPS 下协议降级 + 错端口）。
 *
 *   区分依据：**BASE_PATH 非空即同源部署**（同源才有可能挂子路径），
 *   此时才跟随访问者 origin；否则一律「换 host、留端口与路径」。
 *
 * 安全：只接受合法主机名/IPv4，拒绝路径、查询串等可疑输入，
 * 防止被当成开放重定向（open redirect）—— 跳转目标始终是「访问者正在访问的这个主机」，
 * 无法被诱导跳去第三方域名。
 */
function resolveWorkbenchUrl(origin) {
  const raw = String(config.aiWorkbenchUrl || "").trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }

  const basePath = config.aiWorkbenchBasePath || "";
  // 同源部署的判据：挂了子路径。此时端口应跟随访问者。
  const sameSite = basePath !== "";

  // 配置已是真实地址（非回环）→ 尊重配置，只补子路径
  if (!LOOPBACK_HOSTS.includes(u.hostname)) return withBasePath(raw);

  // 配置是回环 → 借访问者的主机名（可能连端口一起，见 sameSite）
  const o = parseSafeOrigin(origin);
  if (!o) return withBasePath(raw);

  if (sameSite) {
    // 形态 B：跟随访问者完整 origin（协议 + 主机 + 端口），再补子路径
    return o.origin + basePath;
  }

  // 形态 A：只换 hostname，保留配置的端口与协议。
  // 刻意不用 u.origin —— 它带的是配置里的回环主机名，正是要替换掉的那个。
  // 也刻意不拼 u.pathname —— pathname 至少是 "/"，会拼出 `:8082//`，
  // 再叠加票据的 `/#/sso` 就成了 `:8082//#/sso`（前端路由匹配不上）。
  const host = o.hostname.includes(":") ? `[${o.hostname}]` : o.hostname;
  const base = `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}`;
  return withBasePath(base);
}

/** 解析并校验访问者 origin；不合法返回 null */
function parseSafeOrigin(origin) {
  const s = String(origin || "").trim();
  if (!s) return null;
  let o;
  try {
    o = new URL(s);
  } catch {
    return null;
  }
  if (o.protocol !== "http:" && o.protocol !== "https:") return null;
  if (!isSafeHost(o.hostname)) return null;
  return o;
}

/** 兜底路径也要带上子路径前缀，否则同源部署下会落到教务系统的 404 */
function withBasePath(base) {
  const s = String(base || "");
  const path = config.aiWorkbenchBasePath || "";
  if (!path) return s;
  try {
    const u = new URL(s);
    // 配置里已自带路径就不叠加，避免 /ai/ai
    const hasOwnPath = u.pathname && u.pathname !== "/";
    return hasOwnPath ? s : s + path;
  } catch {
    return s;
  }
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];

/** 只接受纯主机名 / IPv4，拒绝路径、查询串、用户信息等 */
function isSafeHost(host) {
  if (!host || host.length > 253) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?$/.test(host);
}

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

  // 前端把自己访问教务系统用的 origin 传过来，避免跳到「访问者本机的 localhost」。
  // 同时兼容旧的 `host` 字段（老版本前端），但新前端一律传 origin。
  const base = resolveWorkbenchUrl(req.body?.origin || req.body?.host);
  // URL 用 hash 路由承载票据，避免随请求发送到服务器
  const url = `${base}/#/sso?ticket=${encodeURIComponent(ticket)}`;

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

      // 用量落库供配置中心统计；这里失败绝不能影响生成结果
      try {
        db.prepare(
          `INSERT INTO ai_usage
             (username, scene, model, tokens_in, tokens_out, cost, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          req.user?.username || "",
          scene,
          result.model || "",
          Number(result.usage?.prompt_tokens || 0),
          Number(result.usage?.completion_tokens || 0),
          Number(result.cost || 0),
          new Date().toISOString()
        );
      } catch {
        /* 忽略：用量统计不是主流程 */
      }

      res.json({
        success: true,
        data: {
          scene,
          sceneLabel: prompts.sceneLabel(scene),
          text: result.text,
          model: result.model,
          cost: result.cost,
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

/* ---------------------- AI 配置中心（仅管理员） ---------------------- */

/**
 * GET /api/ai/admin/config —— 读取 AI 配置（敏感值只返回掩码）
 * PUT /api/ai/admin/config —— 保存 AI 配置（立即生效，无需重启容器）
 * GET /api/ai/admin/balance —— 查询模型账户余额（Key 不出服务端）
 * GET /api/ai/admin/usage —— 本月用量与成本
 *
 * 教师角色一律 403；前端页面也不出现在菜单里，只能凭地址进入。
 */
router.get("/admin/config", auth, requireRole("admin"), (_req, res) => {
  res.json({ success: true, data: aiSettings.readForDisplay() });
});

router.put("/admin/config", auth, requireRole("admin"), (req, res, next) => {
  try {
    const patch = req.body || {};
    if (Object.prototype.toString.call(patch) !== "[object Object]") {
      return res.status(400).json({ success: false, message: "请求体应为对象" });
    }
    const changed = aiSettings.save(patch, req.user?.username || "");
    res.json({ success: true, data: { changed, ...aiSettings.readForDisplay() } });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/balance", auth, requireRole("admin"), async (_req, res) => {
  const cfg = llm.effective();
  if (!cfg.apiKey) {
    return res
      .status(503)
      .json({ success: false, message: "未配置 API Key，无法查询余额" });
  }
  try {
    const base = cfg.baseUrl.replace(/\/$/, "");
    const r = await fetch(`${base}/user/balance`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` }
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!r.ok) {
      return res.status(502).json({
        success: false,
        message: `余额查询失败：${json?.message || text.slice(0, 120)}`
      });
    }
    // 只回传余额数字，绝不回传 Key 或其它账户信息
    const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
    res.json({
      success: true,
      data: {
        available: Boolean(json?.is_available),
        balances: infos.map(i => ({
          currency: i.currency,
          total: i.total_balance,
          granted: i.granted_balance,
          toppedUp: i.topped_up_balance
        }))
      }
    });
  } catch (err) {
    res.status(502).json({ success: false, message: `余额查询异常：${err.message}` });
  }
});

router.get("/admin/usage", auth, requireRole("admin"), (_req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const since = monthStart.toISOString();

  const row = db
    .prepare(
      `SELECT COUNT(*) times,
              COALESCE(SUM(tokens_in), 0) tin,
              COALESCE(SUM(tokens_out), 0) tout,
              COALESCE(SUM(cost), 0) cost
       FROM ai_usage WHERE created_at >= ?`
    )
    .get(since);
  const byScene = db
    .prepare(
      `SELECT scene, COUNT(*) times, COALESCE(SUM(cost), 0) cost
       FROM ai_usage WHERE created_at >= ? GROUP BY scene ORDER BY times DESC`
    )
    .all(since);

  res.json({
    success: true,
    data: { month: since.slice(0, 7), ...row, byScene }
  });
});

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
