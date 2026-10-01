// 菜单重构 + 出勤率口径统一 + 备份改造 —— 端到端验证
// 跑法：node _verify_test/verify-menu-refactor.mjs
// 前提：统一入口在 18080 运行中（docker compose up）
const BASE = process.env.BASE || "http://127.0.0.1:18080";

let pass = 0;
let fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    fails.push(name);
    console.log("  ❌ " + name + (extra ? "  → " + extra : ""));
  }
}
function section(t) {
  console.log("\n=== " + t + " ===");
}

async function login(username, password) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await r.json();
  if (!j.success) throw new Error(`登录失败(${username}): ${JSON.stringify(j)}`);
  return j.data.accessToken;
}
async function api(path, token, opt = {}) {
  const r = await fetch(BASE + path, {
    ...opt,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opt.headers || {}) }
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* 非 JSON 忽略 */
  }
  return { status: r.status, body };
}

// ── 重构前的原始菜单 path 全集（取自 HEAD 版本的 ROUTES，用于证明"没丢功能"）
const ADMIN_PATHS_BEFORE = [
  "/todos",
  "/user",
  "/attendance/checkin",
  "/attendance/records",
  "/attendance/leaves",
  "/attendance/statistics",
  "/attendance/sessions",
  "/attendance/sessions/migration-report",
  "/attendance/teaching-assignments",
  "/attendance/period-times",
  "/recruit/leads",
  "/family/notifications",
  "/teaching/exams",
  "/teaching/reports",
  "/teaching/growth",
  "/finance/orders",
  "/finance/payments",
  "/finance/refunds",
  "/finance/statistics",
  "/finance/business",
  "/finance/consumption",
  "/data/classes",
  "/data/students",
  "/data/courses",
  "/data/schedules",
  "/data/terms",
  "/data/adjustments",
  "/data/makeups",
  "/system/settings",
  "/system/notices",
  "/system/backups",
  "/system/audit-logs"
];
const TEACHER_PATHS_BEFORE = [
  "/todos",
  "/attendance/checkin",
  "/attendance/records",
  "/attendance/leaves",
  "/attendance/statistics",
  "/attendance/sessions",
  "/family/notifications",
  "/teaching/exams",
  "/teaching/reports",
  "/teaching/growth",
  "/data/classes",
  "/data/students",
  "/data/schedules",
  "/data/makeups"
];

function flatten(routes) {
  const leaves = [];
  const walk = arr =>
    arr.forEach(r => {
      if (r.children && r.children.length) walk(r.children);
      else leaves.push(r);
    });
  walk(routes);
  return leaves;
}
function groups(routes) {
  return [...routes].sort((a, b) => (a.meta.rank ?? 99) - (b.meta.rank ?? 99));
}

const adminToken = await login("admin", "admin123456");
const teacherToken = await login("teacher", "teacher123456");

// ─────────────────────────────────────────────────────────
section("1. 菜单结构（admin）");
const ar = await api("/api/auth/async-routes", adminToken);
const adminRoutes = ar.body.data;
ok("admin 菜单下发成功", ar.status === 200 && Array.isArray(adminRoutes));

const adminGroups = groups(adminRoutes);
const adminTitles = adminGroups.filter(g => g.children).map(g => g.meta.title);
const expectAdminTitles = [
  "考勤管理",
  "排课与课表",
  "学员管理",
  "教学成果",
  "招生与报名",
  "财务",
  "家校沟通",
  "系统管理"
];
ok(
  `admin 分组共 8 个（不含独立项）`,
  adminTitles.length === 8,
  `实际 ${adminTitles.length}: ${adminTitles.join("/")}`
);
ok("admin 分组标题与顺序正确", JSON.stringify(adminTitles) === JSON.stringify(expectAdminTitles), adminTitles.join("/"));
ok("已无「数据管理」筐式分组", !adminTitles.includes("数据管理"));
ok("已无「教学结果」含糊命名", !adminTitles.includes("教学结果"));

const adminLeaves = flatten(adminRoutes).map(r => r.path);
const missingAdmin = ADMIN_PATHS_BEFORE.filter(p => !adminLeaves.includes(p));
ok("★ admin 菜单覆盖重构前全部 32 项（无功能丢失）", missingAdmin.length === 0, "缺失: " + missingAdmin.join(", "));
ok("admin 无重复 path", new Set(adminLeaves).size === adminLeaves.length);

const rankArr = adminRoutes.map(g => g.meta.rank);
ok("admin rank 无冲突", new Set(rankArr).size === rankArr.length, rankArr.join(","));

// 抽查归属
const byPath = Object.fromEntries(flatten(adminRoutes).map(r => [r.path, r.meta.title]));
ok("课表类已归入「排课与课表」组", adminGroups.find(g => g.meta.title === "排课与课表")?.children.length === 6);
ok("报班管理已从财务移入「招生与报名」", adminGroups.find(g => g.meta.title === "招生与报名")?.children.some(c => c.path === "/finance/orders"));
ok("课消统计仍在「财务」组", adminGroups.find(g => g.meta.title === "财务")?.children.some(c => c.path === "/finance/consumption"));
ok("员工账号已移入「系统管理」", adminGroups.find(g => g.meta.title === "系统管理")?.children.some(c => c.path === "/user"));
ok("考勤管理已瘦身为 4 项", adminGroups.find(g => g.meta.title === "考勤管理")?.children.length === 4);
ok("页面标题仍叫「统计报表」（未误改名）", byPath["/attendance/statistics"] === "统计报表");

// ─────────────────────────────────────────────────────────
section("2. 菜单结构（teacher）");
const tr = await api("/api/auth/async-routes", teacherToken);
const teacherRoutes = tr.body.data;
const teacherGroups = groups(teacherRoutes);
const teacherTitles = teacherGroups.filter(g => g.children).map(g => g.meta.title);
const expectTeacherTitles = ["考勤管理", "排课与课表", "学员管理", "教学成果", "家校沟通"];
ok("teacher 分组数 5", teacherTitles.length === 5, teacherTitles.join("/"));
ok("teacher 分组标题与顺序正确", JSON.stringify(teacherTitles) === JSON.stringify(expectTeacherTitles), teacherTitles.join("/"));

const teacherLeaves = flatten(teacherRoutes).map(r => r.path);
const missingTeacher = TEACHER_PATHS_BEFORE.filter(p => !teacherLeaves.includes(p));
ok("★ teacher 菜单覆盖重构前全部 14 项", missingTeacher.length === 0, "缺失: " + missingTeacher.join(", "));
ok("teacher 看不到「财务」组", !teacherTitles.includes("财务"));
ok("teacher 看不到「系统管理」组", !teacherTitles.includes("系统管理"));
ok("teacher 看不到「招生与报名」组", !teacherTitles.includes("招生与报名"));
ok("teacher 看不到 admin-only 项（任课关系/节次时间/回填报告）", !teacherLeaves.includes("/attendance/teaching-assignments") && !teacherLeaves.includes("/attendance/period-times") && !teacherLeaves.includes("/attendance/sessions/migration-report"));

// ─────────────────────────────────────────────────────────
section("3. 权限边界（teacher 越权应 403）");
for (const [label, path] of [
  ["财务-报班管理", "/api/finance/orders"],
  ["财务-统计", "/api/finance/stats/revenue"],
  ["招生-线索", "/api/leads"],
  ["系统-员工账号", "/api/users"],
  ["分析-经营概览", "/api/analytics/overview"]
]) {
  const r = await api(path, teacherToken);
  ok(`teacher 访问 ${label} 被拒（403）`, r.status === 403, "实际 " + r.status);
}
const aOwn = await api("/api/finance/orders", adminToken);
ok("admin 访问财务正常（非 403）", aOwn.status !== 403, "实际 " + aOwn.status);

// ─────────────────────────────────────────────────────────
section("4. 出勤率口径一致性（核心修复）");
const start = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
const end = new Date().toISOString().slice(0, 10);
const qs = `?start=${start}&end=${end}`;

const ov = await api("/api/analytics/overview" + qs, adminToken);
const st = await api("/api/attendance/statistics" + qs + "&dimension=student", adminToken);
ok("analytics/overview 可访问", ov.status === 200);
ok("attendance/statistics 可访问", st.status === 200);

const anaRate = ov.body?.data?.metrics?.attendance_rate;
const anaTotal = ov.body?.data?.metrics?.attendance_total;
const anaAbsent = ov.body?.data?.metrics?.attendance_absent;
const stTotal = st.body?.data?.summary?.total;
const stAbsent = st.body?.data?.summary?.absent_count;
// ★ 注意：/api/attendance/statistics 的 summary **不含** attendance_rate 字段
//   （出勤率在 list 的每个学生/班级行里），故此处用它的 total/absent 按统一公式复算后再比对。
const stRate = Number(stTotal) > 0 ? Number(((Number(stTotal) - Number(stAbsent)) / Number(stTotal) * 100).toFixed(1)) : 0;

console.log(
  `     实测：analytics  total=${anaTotal} absent=${anaAbsent} rate=${anaRate}%`
);
console.log(
  `     实测：statistics total=${stTotal} absent=${stAbsent} → 按统一公式复算 rate=${stRate}%`
);
ok("两接口考勤总数一致", Number(anaTotal) === Number(stTotal), `${anaTotal} vs ${stTotal}`);
ok("两接口缺勤数一致", Number(anaAbsent) === Number(stAbsent), `${anaAbsent} vs ${stAbsent}`);
ok(
  "★ 两接口出勤率完全一致（修复目标）",
  Number(anaRate) === Number(stRate),
  `${anaRate}% vs ${stRate}%`
);
ok("出勤率 = (总数−缺勤)/总数（口径正确）", Number(anaRate) === stRate, `期望 ${stRate}%`);
ok("出勤率 + 缺勤率 = 100%", Number((Number(anaRate) + Number(ov.body?.data?.metrics?.absent_rate)).toFixed(1)) === 100, `${anaRate} + ${ov.body?.data?.metrics?.absent_rate}`);

const md = ov.body?.metric_definitions?.attendance_rate;
ok("口径字典已同步（不再写旧公式）", !!md && !/不计入分母/.test(md.note || ""), JSON.stringify(md));

// ─────────────────────────────────────────────────────────
section("5. 备份改造（VACUUM INTO）");
const b1 = await api("/api/backups", adminToken, { method: "POST" });
ok("创建备份成功", b1.status === 200 && b1.body?.success, JSON.stringify(b1.body)?.slice(0, 120));
const bList = await api("/api/backups", adminToken);
const items = bList.body?.data?.list || bList.body?.data || [];
const created = Array.isArray(items) && items.length > 0 ? items[0] : null;
ok("备份列表非空", Array.isArray(items) && items.length > 0);
if (created) {
  console.log(`     最新备份: ${created.file}  ${(created.size / 1024).toFixed(1)} KB`);
  ok("备份文件有实际大小（非 0 字节）", Number(created.size) > 10000, created.size + " bytes");
}

// ─────────────────────────────────────────────────────────
section("6. 回归（核心功能未被破坏）");
// 取一个真实班级 id 供 /sessions/week 使用（该端点 view=class 时必传 class_id，无参数返 400 是正确行为）
const clsRes = await api("/api/classes", adminToken);
const firstClassId = (clsRes.body?.data?.list || clsRes.body?.data || [])[0]?.id;
ok("取到班级 id（供周课表测试）", !!firstClassId, "班级列表为空？");

const reg = [
  ["考勤记录", "/api/attendance/records?page=1&pageSize=5"],
  ["学生列表", "/api/students?page=1&pageSize=5"],
  ["班级列表", "/api/classes"],
  ["周课表", `/api/sessions/week?view=class&class_id=${firstClassId}`],
  ["待办", "/api/todos?scope=mine"],
  ["个人资料", "/api/auth/info"]
];
for (const [label, path] of reg) {
  const r = await api(path, adminToken);
  ok(`admin ${label} 正常（200）`, r.status === 200, "实际 " + r.status);
}

// ★ 教师侧必须用**教师自己的班级**：用 admin 的班级测会得到 403，
//   那是「数据隔离生效」而不是故障（本脚本首版就踩了这个坑）。
const tClsRes = await api("/api/classes", teacherToken);
const tIds = (tClsRes.body?.data?.list || tClsRes.body?.data || []).map(c => c.id);
ok("取到教师本人班级 id（供周课表测试）", tIds.length > 0, "教师无绑定班级？");
ok(
  "教师看不到非本班（用 admin 首个班级应 403，证明数据隔离生效）",
  tIds.length > 0 && !tIds.includes(firstClassId)
    ? (await api(`/api/sessions/week?view=class&class_id=${firstClassId}`, teacherToken)).status === 403
    : true,
  "跳过：教师恰好也是该班负责人"
);
const tReg = [
  ["教师-考勤记录", "/api/attendance/records?page=1&pageSize=5"],
  ["教师-学生列表", "/api/students?page=1&pageSize=5"],
  ["教师-周课表", `/api/sessions/week?view=class&class_id=${tIds[0] ?? ""}`],
  ["教师-统计报表", "/api/attendance/statistics"]
];
for (const [label, path] of tReg) {
  const r = await api(path, teacherToken);
  ok(`${label} 正常（200）`, r.status === 200, "实际 " + r.status);
}

// ─────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(56));
console.log(`结果：PASS ${pass}  FAIL ${fail}`);
if (fail) {
  console.log("失败项：");
  fails.forEach(f => console.log("  - " + f));
}
console.log("═".repeat(56));
process.exit(fail ? 1 : 0);
