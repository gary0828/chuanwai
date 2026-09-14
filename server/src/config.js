// 集中配置：所有环境变量在此读取并校验，启动期快速失败（fail fast）
//
// 设计约定（2026-09-12 上线门禁 B1 修复）：
// · 本模块必须在 `seed()` / 建表之前被 require，保证「配置非法」时不触碰数据库；
// · JWT_SECRET 缺失或过弱一律抛错终止，绝不回退到源码中的公开默认值；
// · 其余可选项提供安全的默认值，不需要运维显式配置也能正常启动。
//
// 加载方式：后端不依赖 dotenv，使用 Node 原生 --env-file-if-exists=.env
// （见 server/package.json 的 start / dev 脚本）。环境变量优先级高于 .env 文件。
// 模板见 server/.env.example；Docker 部署由 docker-compose.yml 注入。

/** 读取必填的字符串配置 */
function required(name, { minLength = 1, hint = "" } = {}) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(
      [
        "",
        "════════════════════════════════════════════════════════════════",
        `[致命] 未设置环境变量 ${name}，服务拒绝启动。`,
        "",
        hint,
        "",
        "  修复方式：",
        "    1) 本地开发： 复制 server/.env.example 为 server/.env 并填入该值",
        "    2) Docker：   在 docker-compose.yml 的 server.environment 中注入",
        "    3) 临时运行： export " + `${name}=<值>` + " && node src/index.js",
        "",
        "  详见 server/.env.example、README.md「快速开始 → 方式一」",
        "════════════════════════════════════════════════════════════════",
        ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  if (String(value).length < minLength) {
    throw new Error(
      `[致命] ${name} 过短（当前 ${String(value).length} 位，至少需要 ${minLength} 位），服务拒绝启动。` +
        `\n  请用 \`openssl rand -hex 32\` 生成 64 位随机十六进制字符串。`
    );
  }
  return String(value);
}

/** 读取整数配置，非法或缺失时回退默认值 */
function intOr(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 读取逗号分隔的列表配置 */
function listOr(name, fallback) {
  const list = (process.env[name] || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

const config = {
  /** 服务监听端口 */
  port: intOr("PORT", 3000),

  /**
   * JWT 签名密钥（必填）。
   * 用于签发 accessToken / refreshToken；缺失时任何人持源码即可伪造管理员凭证，
   * 读取全部学员档案、家长电话与缴费金额，因此必须显式注入。
   */
  jwtSecret: required("JWT_SECRET", {
    minLength: 16,
    hint:
      "  该密钥用于签发 accessToken / refreshToken。若允许其回退到默认值，\n" +
      "  任何人持有源码即可伪造 role:\"admin\" 的凭证，读取全部学员与财务数据。\n" +
      "  生成方式： openssl rand -hex 32"
  }),

  /**
   * CORS 来源白名单。
   * 生产环境前端页面与 API 同源（nginx 反代 /api），不经过 CORS 校验；
   * 默认只放行本机开发端口，仅当需要浏览器直连 :3000 时才需扩展。
   */
  corsOrigins: listOr("CORS_ORIGINS", [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8848",
    "http://127.0.0.1:8848",
    "http://localhost:5300",
    "http://127.0.0.1:5300"
  ]),
  corsConfigured: Boolean(process.env.CORS_ORIGINS),

  /**
   * AI 教学工作台地址（免登跳转目标）。
   * 仅用于拼装跳转 URL；生产环境应指向工作台实际入口。
   */
  aiWorkbenchUrl: (
    process.env.AI_WORKBENCH_URL || "http://127.0.0.1:5300"
  ).replace(/\/$/, ""),

  /**
   * 大模型配置（可选）。未配置 apiKey 时 `/api/ai/generate` 返回 503，
   * 工作台自动回退规则引擎，不阻塞主流程。
   *
   * 安全约定：Key 只存服务端环境变量，**绝不下发前端**
   * （前端存 Key 等于对任何能打开工作台的人公开）。
   *
   * 注意（2026-09-14 实测）：
   * - DeepSeek 旧别名 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用；
   * - 当前 `GET /models` 返回的可用模型为 **`deepseek-flash`** / **`deepseek-v4-pro`**；
   * - 两者均为**推理型**（响应含 reasoning_content，思维链约占输出 token 的 60%），
   *   因此 max_tokens 必须给足，否则思维链吃满额度会导致正文为空。
   */
  llm: {
    apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    model: process.env.LLM_MODEL || "deepseek-flash",
    /**
     * 思维链强度。**实测（2026-09-14）**：
     * - 默认（不传）：推理 token 约占输出的 60–100%，长文案任务会被思维链吃满额度而正文为空；
     * - `"none"`：完全关闭推理，输出 token 直降约 90%、耗时减半，文案类任务质量无可见下降；
     * - `"minimal"` / `"low"`：减少但未关闭。
     * 需要模型做多步推理时可改为 `"medium"` / `"high"`（须同步调大 maxTokens）。
     */
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "none",
    /**
     * 单次输出额度上限。推理型模型的思维链**先**占用输出额度，
     * 给不足会导致正文被截断为空（finish_reason=length）。
     * 关闭推理时一份备课方案约 1900 输出 token，8192 余量充足；开启推理后需相应上调。
     */
    maxTokens: intOr("LLM_MAX_TOKENS", 8192),
    timeoutMs: intOr("LLM_TIMEOUT_MS", 60000)
  },

  /** 登录失败限速：15 分钟窗口内同一 IP 允许的失败次数 */
  loginRateLimitMax: intOr("LOGIN_RATE_LIMIT_MAX", 10),

  /** 请求体大小上限（Excel 导入为 JSON 数组，需要留足空间） */
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "5mb"
};

module.exports = config;
