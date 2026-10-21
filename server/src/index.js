// 学生考勤系统后端入口
//
// 注意 require 顺序：config 必须最先加载并在建表/写种子数据之前完成校验，
// 避免「配置非法却已污染数据库」的半启动状态（上线门禁 B1）。
const config = require("./config");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const seed = require("./seed");
// 健康检查要真实探活数据库（P1-9）：seed 内部已建连，这里拿到同一实例
const db = require("./db");
const { scheduleAutoBackup } = require("./utils/backup");
const { audit } = require("./utils/audit");
const { isConstraintError, constraintMessage } = require("./utils/validate");
// ★ 2026-10-18（P1-5 DATA_DIR 收口）：静态资源目录唯一解析入口在 utils/paths
const { assetsDir } = require("./utils/paths");

// 启动时自动建表并初始化种子数据（数据持久化在 <DATA_DIR>/attendance.db，默认 server/data/）
seed();
// 启动自检：仍在使用初始默认口令的账号给出醒目告警（H9）
seed.warnDefaultPasswords();
// 定时自动备份（每 6 小时一次，保留最近 20 份）
scheduleAutoBackup();

const app = express();
const PORT = config.port;

// 反向代理（nginx / Docker Compose）后的真实客户端 IP，限速与审计依赖它
app.set("trust proxy", 1);

// ── 请求 ID（P1-9 可观测性；2026-10-18 新增）──────────────────────────
// 每个请求生成唯一 id 并回写 `X-Request-Id`：前端报错、nginx 日志、后端日志
// 可以用同一个 id 对齐（多个容器/多份日志排查时尤其重要）。零依赖
// （crypto.randomUUID 为 Node 22+ 内置），放在最前以便访问日志/错误处理都能带上。
app.use((req, res, next) => {
  const id = crypto.randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
});

// ── 安全响应头（H7）───────────────────────────────────────────────────
// 本服务只输出 JSON（页面由 nginx 托管），因此关闭 CSP 避免误伤，
// 并放开 crossOriginResourcePolicy 以便前端从其他来源读取响应。
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

// ── CORS 来源白名单（H7）─────────────────────────────────────────────
// 默认仅放行本机常用开发端口。生产环境前端与 API 同源（nginx 反代 /api），
// 不受 CORS 限制；仅当需要「浏览器直接访问 :3000」时才需追加来源。
// 可用环境变量 CORS_ORIGINS 覆盖（逗号分隔）。
const allowOrigins = config.corsOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // 无 Origin 头的请求（curl / 服务端脚本 / 同源请求）直接放行
      if (!origin) return callback(null, true);
      if (allowOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true
  })
);

app.use(express.json({ limit: config.jsonBodyLimit }));

// ── 静态资源：站点上传的图片（Logo / favicon）────────────────────────
// 见 docs/decisions/ADR-008：文件本体存磁盘 <DATA_DIR>/assets/，DB 只存路径。
// 只暴露 /assets 子目录，禁止越权访问 data/ 下的数据库与备份。
// ★ 2026-10-18（P1-5）：目录改由 utils/paths 解析，跟随 DATA_DIR（隔离实例不碰生产目录）。
// ★ 2026-10-18（P2-7 SVG 加固）：上传入口已禁止 SVG/XML，但历史版本允许过、
//   磁盘上可能残留 .svg 文件。这里对 .svg 响应强制 `Content-Disposition: attachment`：
//   浏览器**顶层直接打开**时只会下载、不会在本站 origin 下渲染执行内嵌脚本，
//   从而把「残留 SVG 被直接访问」的存储型 XSS 风险降为 0（图片 <img> 子资源不受影响）。
app.use(
  "/assets",
  express.static(assetsDir, {
    maxAge: "1d",
    fallthrough: true,
    index: false,
    dotfiles: "deny",
    setHeaders(res, filePath) {
      if (String(filePath).toLowerCase().endsWith(".svg")) {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="image.svg"'
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
      }
    }
  })
);

// ── 登录限速（H7：防口令爆破）────────────────────────────────────────
// 只统计「失败」的登录请求（skipSuccessfulRequests），成功登录不占额度，
// 避免正常员工因同事多次输错而被连带锁死。
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "登录失败次数过多，请 15 分钟后再试"
  }
});
app.use("/api/auth/login", loginLimiter);

// ── 自助改密码限速（同样只计失败）─────────────────────────────────────
// 2026-09-23 新增：登录有限速，但"已登录后改密码"此前没有 —— 凭证一旦被窃，
// 攻击者可在这里离线式地反复猜原密码，猜中即可**持久化**接管（改密不像 token 可被吊销）。
// skipSuccessfulRequests：正常改密成功不该占额度。
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "原密码错误次数过多，请 15 分钟后再试"
  }
});
app.use("/api/auth/password", passwordLimiter);

// ── 审计中间件：自动记录登录用户的所有 /api 写操作（成功响应后写入）──
// 注：finance / leads / exams / schedule-adjustments / makeup-classes 这 5 个模块
//     在各自路由内已调用 audit() 写入语义化动作名（如「修改报班订单」），
//     此处跳过以免同一操作写入两条审计记录。
const AUDIT_MODULES = [
  { re: /^\/api\/users/, name: "用户" },
  { re: /^\/api\/classes/, name: "班级" },
  { re: /^\/api\/students/, name: "学生" },
  { re: /^\/api\/courses/, name: "课程" },
  { re: /^\/api\/attendance/, name: "考勤" },
  { re: /^\/api\/leaves/, name: "请假" },
  { re: /^\/api\/schedules/, name: "课表" },
  { re: /^\/api\/terms/, name: "学期" },
  { re: /^\/api\/settings/, name: "系统参数" },
  { re: /^\/api\/notices/, name: "公告" },
  { re: /^\/api\/backups/, name: "备份" },
  { re: /^\/api\/finance/, name: "财务" },
  { re: /^\/api\/leads/, name: "招生线索" },
  { re: /^\/api\/notifications/, name: "通知" },
  { re: /^\/api\/todos/, name: "待办" },
  { re: /^\/api\/exams/, name: "考试" },
  { re: /^\/api\/reports/, name: "报表" },
  { re: /^\/api\/schedule-adjustments/, name: "调课" },
  { re: /^\/api\/makeup-classes/, name: "补课" },
  { re: /^\/api\/analytics/, name: "分析" },
  { re: /^\/api\/feedback/, name: "使用反馈" },
  { re: /^\/api\/growth/, name: "成长记录" },
  { re: /^\/api\/sessions/, name: "课次" },
  { re: /^\/api\/teaching-assignments/, name: "任课关系" },
  { re: /^\/api\/period-times/, name: "节次时间" }
];
// 路由内已自行写审计的模块前缀（保持与上面注释一致，勿随意增删）
const SELF_AUDITED =
  /^\/api\/(finance|leads|exams|schedule-adjustments|makeup-classes)(\/|$)/;
const METHOD_NAME = { POST: "新增", PUT: "修改", DELETE: "删除" };
app.use((req, res, next) => {
  if (
    ["POST", "PUT", "DELETE"].includes(req.method) &&
    req.originalUrl.startsWith("/api/")
  ) {
    const fullPath = req.originalUrl.split("?")[0];
    if (!SELF_AUDITED.test(fullPath)) {
      const meta = { method: req.method, path: fullPath, ip: req.ip };
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          const mod = AUDIT_MODULES.find(m => m.re.test(fullPath));
          const action = mod
            ? `${METHOD_NAME[req.method] || req.method}${mod.name}`
            : `${req.method} ${fullPath}`;
          audit(req.user, action, fullPath, meta);
        }
      });
    }
  }
  next();
});

// ── 访问日志（H8：不记录请求体，避免明文密码 / 家长电话落盘）──────────
// ★ 2026-10-18（P1-9）：加 ISO 时间戳 + request-id。容器时区已由 TZ 固定为
//   Asia/Shanghai（见 docker-compose.yml / Dockerfile），ISO 串带时区偏移，
//   跨容器排查时不会因「本地时间 vs UTC」对不上。
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[req] ${new Date().toISOString()} id=${req.id} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`
      );
    });
  }
  next();
});

// 健康检查（供 Docker Compose healthcheck 探测）
// ★ 2026-10-18（P1-9）：真正的探活 —— 旧实现只返回静态 {status:"ok"}，
//   数据库文件损坏/只读时容器仍被判健康。现在执行 `SELECT 1`，失败返回 503，
//   让 compose / 外部监控如实发现「进程活着但库不可用」。
app.get("/api/health", (req, res) => {
  try {
    db.prepare("SELECT 1 AS ok").get();
    res.json({
      success: true,
      data: { status: "ok", db: "ok", time: new Date().toISOString() }
    });
  } catch (e) {
    console.error(`[health] 数据库探活失败 id=${req.id}:`, e.message);
    res.status(503).json({
      success: false,
      message: "数据库不可用",
      data: { status: "error", db: "error" }
    });
  }
});

// 业务路由
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/classes", require("./routes/classes"));
app.use("/api/students", require("./routes/students"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/leaves", require("./routes/leaves"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/schedules", require("./routes/schedules"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/terms", require("./routes/terms"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/site-info", require("./routes/site-info"));
app.use("/api/notices", require("./routes/notices"));
app.use("/api/backups", require("./routes/backups"));
app.use("/api/audit-logs", require("./routes/audit-logs"));
app.use("/api/finance", require("./routes/finance"));
app.use("/api/leads", require("./routes/leads"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/todos", require("./routes/todos"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/schedule-adjustments", require("./routes/adjustments"));
app.use("/api/makeup-classes", require("./routes/makeups"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/feedback", require("./routes/feedback"));
app.use("/api/agent", require("./routes/agent"));
app.use("/api/growth", require("./routes/growth"));
app.use("/api/sessions", require("./routes/sessions"));
app.use("/api/teaching-assignments", require("./routes/teaching-assignments"));
app.use("/api/period-times", require("./routes/period-times"));
// 智能题库系统（一期）。凭证：qb_agent 类型放行 /api/qbank（见 middleware/auth.js）。
// 教务系统正式登录 token 也能访问 —— 老师从教务端跳转过来时可能仍带教务 token。
app.use("/api/qbank", require("./routes/qbank"));
app.use("/api/qbank", require("./routes/qbank-ocr"));
// 知识点与章节管理（2026-10-07 新增）。挂在同一前缀下，
// 因此 qb_agent 凭证的路径白名单自动覆盖，无需改中间件。
app.use("/api/qbank", require("./routes/qbank-taxonomy"));

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "接口不存在" });
});

// 统一错误处理：尊重 err.status（备份等模块会抛 400/404），其余归为 500
//
// 数据库约束类错误（外键/唯一/CHECK/NOT NULL）属「客户端传入了不成立的关联或取值」，
// 应返回 400 而非 500 —— 否则前端把参数错误当服务故障，且响应体直接暴露
// `FOREIGN KEY constraint failed` 这类内部信息（2026-09-12 全面测试发现）。
app.use((err, _req, res, _next) => {
  let status =
    Number.isInteger(err?.status) && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  let message = err?.message || "服务器内部错误";

  if (status >= 500 && isConstraintError(err)) {
    status = 400;
    message = constraintMessage(err);
  }

  // body 超限（body-parser / express.raw 抛出）：原始 message 是
  // "request entity too large"（英文、且不告诉用户上限是多少），
  // 前端只能显示「Request failed with status code 413」这种无信息量的提示。
  // 这里换成中文并保留原始上限说明，让用户知道该把图压到多大。
  if (err?.type === "entity.too.large" || status === 413) {
    status = 413;
    message = err?.limit
      ? `上传内容过大（上限 ${Math.round(Number(err.limit) / 1024 / 1024)}MB），请压缩后重试`
      : "上传内容过大，请压缩后重试";
  }

  // 5xx 才打印堆栈；4xx 属预期内的业务拒绝，避免噪音
  if (status >= 500) {
    console.error("[server error]", err);
  }
  res.status(status).json({ success: false, message });
});

const server = app.listen(PORT, () => {
  console.log(`[attendance-server] 已启动: http://localhost:${PORT}`);
  if (!config.corsConfigured) {
    console.log(
      `[cors] 未设置 CORS_ORIGINS，使用默认白名单：${allowOrigins.join(", ")}`
    );
  }
  // 工作台跳转地址自检：回环地址意味着「跟随访问者 origin」，这在校区部署下是正确行为；
  // 但如果显式配成了回环地址却期望外网访问，必须提醒 —— 这是最常见的部署踩坑点。
  const wbHost = (() => {
    try {
      return new URL(config.aiWorkbenchUrl).hostname;
    } catch {
      return "";
    }
  })();
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(wbHost)) {
    console.log(
      `[ai-workbench] AI_WORKBENCH_URL 为回环地址（${config.aiWorkbenchUrl}），` +
        `跳转地址将自动跟随访问者所用 origin。`
    );
    console.log(
      `[ai-workbench] 若工作台与教务系统同源部署（推荐），无需修改；` +
        `若希望固定指向某个地址，请显式配置为浏览器可访问的地址。`
    );
  } else {
    console.log(
      `[ai-workbench] 工作台跳转地址固定为：${config.aiWorkbenchUrl}`
    );
  }
});

// ── 进程健壮性 ───────────────────────────────────────────────────────
// 未捕获异常只记录不退出（保持可用性）；优雅停机供 Docker 停止容器时使用。
// ── 待办自动生成：定时触发（触发点 C）────────────────────────────────────
// ★ 项目无调度器依赖，用原生 setInterval —— **零新依赖**。
//   每 6 小时一次 + 启动 30 秒后一次（错开启动高峰）。
//   三个触发点：A 打开待办/铃铛时按需（routes/todos.js）｜C 本定时任务｜admin 手动 POST /api/todos/generate
//   ★ 生成器**幂等**（一条来源 = 一条待办），所以"多跑"永远安全，"漏跑"由 A 兜底。
//   `.unref()` 让它不阻塞进程退出（优雅关闭 / 测试友好）。
const TODO_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runTodoGenerator(tag) {
  try {
    const r = require("./utils/todo-generator").generateTodos({ force: true });
    if (r.created || r.reopened) {
      console.log(
        `[todo-generator] ${tag}：新增 ${r.created} 条 · 重开 ${r.reopened} 条 · 跳过 ${r.skipped} 条`
      );
    }
  } catch (e) {
    console.error(`[todo-generator] ${tag} 失败：`, e.message);
  }
}

setTimeout(() => runTodoGenerator("启动"), 30 * 1000).unref();
setInterval(() => runTodoGenerator("定时"), TODO_INTERVAL_MS).unref();

process.on("unhandledRejection", reason => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", err => {
  console.error("[uncaughtException]", err);
});
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[attendance-server] 收到 ${sig}，正在优雅关闭…`);
    server.close(() => process.exit(0));
    // 兜底：5 秒内未关闭完成则强制退出
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
