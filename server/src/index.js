// 学生考勤系统后端入口
//
// 注意 require 顺序：config 必须最先加载并在建表/写种子数据之前完成校验，
// 避免「配置非法却已污染数据库」的半启动状态（上线门禁 B1）。
const config = require("./config");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const seed = require("./seed");
const { scheduleAutoBackup } = require("./utils/backup");
const { audit } = require("./utils/audit");
const { isConstraintError, constraintMessage } = require("./utils/validate");

// 启动时自动建表并初始化种子数据（数据持久化在 ./data/attendance.db）
seed();
// 启动自检：仍在使用初始默认口令的账号给出醒目告警（H9）
seed.warnDefaultPasswords();
// 定时自动备份（每 6 小时一次，保留最近 20 份）
scheduleAutoBackup();

const app = express();
const PORT = config.port;

// 反向代理（nginx / Docker Compose）后的真实客户端 IP，限速与审计依赖它
app.set("trust proxy", 1);

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
  { re: /^\/api\/exams/, name: "考试" },
  { re: /^\/api\/reports/, name: "报表" },
  { re: /^\/api\/schedule-adjustments/, name: "调课" },
  { re: /^\/api\/makeup-classes/, name: "补课" },
  { re: /^\/api\/analytics/, name: "分析" }
];
// 路由内已自行写审计的模块前缀（保持与上面注释一致，勿随意增删）
const SELF_AUDITED = /^\/api\/(finance|leads|exams|schedule-adjustments|makeup-classes)(\/|$)/;
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
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[req] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`
      );
    });
  }
  next();
});

// 健康检查（供 Docker Compose healthcheck 探测）
app.get("/api/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
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
app.use("/api/terms", require("./routes/terms"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/notices", require("./routes/notices"));
app.use("/api/backups", require("./routes/backups"));
app.use("/api/audit-logs", require("./routes/audit-logs"));
app.use("/api/finance", require("./routes/finance"));
app.use("/api/leads", require("./routes/leads"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/schedule-adjustments", require("./routes/adjustments"));
app.use("/api/makeup-classes", require("./routes/makeups"));
app.use("/api/analytics", require("./routes/analytics"));

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
});

// ── 进程健壮性 ───────────────────────────────────────────────────────
// 未捕获异常只记录不退出（保持可用性）；优雅停机供 Docker 停止容器时使用。
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
