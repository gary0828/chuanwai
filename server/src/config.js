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
    "http://127.0.0.1:8848"
  ]),
  corsConfigured: Boolean(process.env.CORS_ORIGINS),

  /** 登录失败限速：15 分钟窗口内同一 IP 允许的失败次数 */
  loginRateLimitMax: intOr("LOGIN_RATE_LIMIT_MAX", 10),

  /** 请求体大小上限（Excel 导入为 JSON 数组，需要留足空间） */
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "5mb"
};

module.exports = config;
