// 学生考勤系统后端入口
const express = require("express");
const cors = require("cors");
const seed = require("./seed");
const { scheduleAutoBackup } = require("./utils/backup");
const { audit } = require("./utils/audit");

// 启动时自动建表并初始化种子数据（数据持久化在 ./data/attendance.db）
seed();
// 定时自动备份（每 6 小时一次，保留最近 20 份）
scheduleAutoBackup();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 审计中间件：自动记录登录用户的所有 /api 写操作（成功响应后写入）
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
const METHOD_NAME = { POST: "新增", PUT: "修改", DELETE: "删除" };
app.use((req, res, next) => {
  if (
    ["POST", "PUT", "DELETE"].includes(req.method) &&
    req.originalUrl.startsWith("/api/")
  ) {
    const fullPath = req.originalUrl.split("?")[0];
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
  next();
});

// 调试日志：打印 /api 请求（定位联调问题用，可随时移除）
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(
      `[req] ${req.method} ${req.path} body=${JSON.stringify(req.body)}`
    );
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

// 统一错误处理
app.use((err, _req, res, _next) => {
  console.error("[server error]", err);
  res.status(500).json({ success: false, message: "服务器内部错误" });
});

app.listen(PORT, () => {
  console.log(`[attendance-server] 已启动: http://localhost:${PORT}`);
});
