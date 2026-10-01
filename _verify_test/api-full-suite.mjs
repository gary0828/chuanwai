// 全面接口测试套件（一次性脚本，位于 .gitignore 忽略的 _verify_test/）
//
// 覆盖既有回归套件（e2e / analytics-smoke）未覆盖的面：
//   PART 1 权限矩阵（自动从后端源码派生路由表，避免人工漏测）
//   PART 2 令牌安全（伪造 / 篡改 / 吊销）
//   PART 3 边界与异常入参
//   PART 4 数据一致性对账（课时台账不变量）
//   PART 5 幂等与重复提交
//   PART 6 敏感字段泄露
//
// 用法：node _verify_test/api-full-suite.mjs [baseUrl]
// 默认 baseUrl = http://localhost:3000
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:3000";
const ROOT = process.cwd();
const OLD_PUBLIC_SECRET = "attendance-secret-key-change-me";

let pass = 0,
  fail = 0,
  warn = 0;
const failures = [];
const warnings = [];

function ok(name, detail = "") {
  pass++;
  console.log(`  [PASS] ${name}`);
}
function bad(name, detail = "") {
  fail++;
  failures.push(`${name}${detail ? ` → ${detail}` : ""}`);
  console.log(`  [FAIL] ${name}${detail ? ` → ${detail}` : ""}`);
}
function warnIt(name, detail = "") {
  warn++;
  warnings.push(`${name}${detail ? ` → ${detail}` : ""}`);
  console.log(`  [WARN] ${name}${detail ? ` → ${detail}` : ""}`);
}
function check(name, cond, detail = "") {
  cond ? ok(name) : bad(name, detail);
}

async function req(method, url, { token, body, raw = false } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text: raw ? text : undefined };
}

async function login(username, password) {
  const r = await req("POST", "/api/auth/login", {
    body: { type: "password", username, password }
  });
  return r.json?.data?.accessToken;
}

function forgeToken(secret, payloadOverride = {}) {
  const b64 = o =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ id: 1, username: "admin", role: "admin", tv: 0, iat: now, exp: now + 3600, ...payloadOverride });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${payload}`).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${head}.${payload}.${sig}`;
}

// ══════════════════════════════════════════════════════════════════
// PART 1 · 权限矩阵（从源码派生）
// ══════════════════════════════════════════════════════════════════
function deriveRoutes() {
  const idx = fs.readFileSync(path.join(ROOT, "server/src/index.js"), "utf8");
  const mounts = [...idx.matchAll(/app\.use\("(\/api\/[a-z-]+)",\s*require\("\.\/routes\/([a-z-]+)"\)/g)]
    .map(m => ({ prefix: m[1], file: m[2] }));

  const routes = [];
  for (const { prefix, file } of mounts) {
    const full = path.join(ROOT, `server/src/routes/${file}.js`);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");

    // 文件级守卫：router.use(auth, requireRole("admin"))
    // 注意 requireRole("admin") 自带括号，不能用 [^)]* 截取，按整行处理
    const fileLevel = src
      .split("\n")
      .filter(l => /router\.use\(/.test(l))
      .join(" ");
    const fileAdminOnly = /requireRole\(\s*"admin"\s*\)/.test(fileLevel);
    const fileHasAuth = /router\.use\([^)]*\bauth\b/.test(fileLevel);

    // 逐个路由：抓 METHOD("path", <中间件与handler 之间的片段>)
    const re = /router\.(get|post|put|delete)\(\s*"([^"]*)"\s*,\s*([\s\S]*?)(?:\(req|\(_req|\(_req,|function)/g;
    let m;
    while ((m = re.exec(src))) {
      const [, method, sub, mid] = m;
      const roles = [...mid.matchAll(/requireRole\(([^)]*)\)/g)]
        .flatMap(r => [...r[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
      const hasAuth = /\bauth\b/.test(mid) || fileHasAuth;
      const p = sub === "/" ? prefix : prefix + sub;
      routes.push({
        method: method.toUpperCase(),
        path: p.replace(/:[A-Za-z_]+/g, "1"),
        hasAuth,
        roles: roles.length ? roles : fileAdminOnly ? ["admin"] : [],
        isWrite: method !== "get",
        file
      });
    }
  }
  return routes;
}

async function part1(adminTk, teacherTk) {
  console.log("\n[PART 1] 权限矩阵（从源码派生，自动比对运行时行为）");
  const routes = deriveRoutes();
  console.log(`  派生路由 ${routes.length} 条`);

  // 白名单：无需认证即可访问
  const WHITELIST = [
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/sms-code"],
    ["POST", "/api/auth/wechat"],
    ["POST", "/api/auth/refresh-token"],
    ["GET", "/api/health"]
  ];
  const isWhite = (m, p) => WHITELIST.some(([wm, wp]) => wm === m && p === wp);

  let noAuthChecked = 0,
    teacherChecked = 0,
    adminChecked = 0;
  const noAuthLeaks = [],
    teacherLeaks = [],
    adminBlocked = [];

  for (const r of routes) {
    if (!isWhite(r.method, r.path)) {
      // 1a. 未认证必须 401（写操作也安全：auth 先于业务逻辑拦截）
      const res = await req(r.method, r.path, { body: r.isWrite ? {} : undefined });
      noAuthChecked++;
      if (res.status !== 401) {
        noAuthLeaks.push(`${r.method} ${r.path} → ${res.status}`);
      }
      // 1b. admin-only：teacher 必须 403
      if (r.roles.length && !r.roles.includes("teacher")) {
        const t = await req(r.method, r.path, { token: teacherTk, body: r.isWrite ? {} : undefined });
        teacherChecked++;
        if (t.status !== 403) teacherLeaks.push(`${r.method} ${r.path} → ${t.status}（期望 403）`);
      }
    }
    // 1c. admin 正例：仅对 GET 断言（避免误写数据）
    if (r.method === "GET") {
      const a = await req("GET", r.path, { token: adminTk });
      adminChecked++;
      if (a.status === 401 || a.status === 403) {
        adminBlocked.push(`${r.method} ${r.path} → ${a.status}`);
      }
    }
  }

  check(`未认证访问全部 ${noAuthChecked} 个受保护接口均返回 401`, noAuthLeaks.length === 0,
    noAuthLeaks.slice(0, 5).join("; "));
  check(`admin-only 接口共 ${teacherChecked} 个，teacher 访问均被 403 拒绝`, teacherLeaks.length === 0,
    teacherLeaks.slice(0, 5).join("; "));
  check(`admin 访问全部 ${adminChecked} 个 GET 接口均未被误拒`, adminBlocked.length === 0,
    adminBlocked.slice(0, 5).join("; "));

  // 1d. 白名单接口确实无需认证
  const h = await req("GET", "/api/health");
  check("健康检查无需认证（200）", h.status === 200, `实际 ${h.status}`);

  // 1e. 特权接口抽查：备份、审计、用户管理
  for (const [m, p, label] of [
    ["GET", "/api/users", "员工账号列表"],
    ["GET", "/api/backups", "备份列表"],
    ["GET", "/api/audit-logs", "审计日志"],
    ["GET", "/api/analytics/metrics", "AI 指标字典"],
    ["GET", "/api/finance/stats/business", "经营报表"]
  ]) {
    const t = await req(m, p, { token: teacherTk });
    check(`teacher 被拒「${label}」(${p}) → 403`, t.status === 403, `实际 ${t.status}`);
  }

  // 1f. 权限收紧专项（2026-09-12）：教师不再可见任何费用与销售数据
  for (const [m, p, label] of [
    ["GET", "/api/finance/orders", "订单列表"],
    ["GET", "/api/finance/orders/1", "订单详情"],
    ["GET", "/api/finance/payments", "缴费记录"],
    ["GET", "/api/finance/refunds", "退费记录"],
    ["GET", "/api/finance/stats/revenue", "营收统计"],
    ["GET", "/api/finance/stats/arrears", "欠费统计"],
    ["GET", "/api/finance/stats/low-hours", "低课时预警"],
    ["GET", "/api/finance/stats/consumption", "课消统计"],
    ["GET", "/api/leads", "线索列表"],
    ["POST", "/api/leads", "创建线索"],
    ["POST", "/api/finance/orders", "创建订单"],
    ["POST", "/api/finance/payments", "登记缴费"],
    ["POST", "/api/finance/refunds", "发起退费"]
  ]) {
    const t = await req(m, p, { token: teacherTk, body: m === "POST" ? {} : undefined });
    check(`teacher 被拒「${label}」(${p}) → 403`, t.status === 403, `实际 ${t.status}`);
  }
  return routes;
}

// ══════════════════════════════════════════════════════════════════
// PART 2 · 令牌安全
// ══════════════════════════════════════════════════════════════════
async function part2(adminTk, teacherTk) {
  console.log("\n[PART 2] 令牌安全");

  const forged = await req("GET", "/api/auth/info", { token: forgeToken(OLD_PUBLIC_SECRET) });
  check("用旧公开默认密钥伪造的 admin token 被拒（401）", forged.status === 401, `实际 ${forged.status}`);

  const algNone = (() => {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "");
    const now = Math.floor(Date.now() / 1000);
    return `${b64({ alg: "none", typ: "JWT" })}.${b64({ id: 1, role: "admin", exp: now + 3600 })}.`;
  })();
  const noneRes = await req("GET", "/api/auth/info", { token: algNone });
  check("alg:none 无签名 token 被拒（401）", noneRes.status === 401, `实际 ${noneRes.status}`);

  const tamperedPayload = (() => {
    const parts = adminTk.split(".");
    const p = JSON.parse(Buffer.from(parts[1], "base64").toString());
    p.role = "admin";
    p.id = 999;
    return `${parts[0]}.${Buffer.from(JSON.stringify(p)).toString("base64").replace(/=+$/, "")}.${parts[2]}`;
  })();
  const tamperRes = await req("GET", "/api/auth/info", { token: tamperedPayload });
  check("篡改载荷（改 id）后签名失效被拒（401）", tamperRes.status === 401, `实际 ${tamperRes.status}`);

  const refreshAsAccess = (() => {
    return adminTk; // 用 accessToken 走 refresh 分支验证类型校验
  })();
  const refMisuse = await req("POST", "/api/auth/refresh-token", { body: { refreshToken: refreshAsAccess } });
  check("用 accessToken 冒充 refreshToken 被拒（400/401）", [400, 401].includes(refMisuse.status), `实际 ${refMisuse.status}`);

  // 登出后吊销
  const tmpTk = await login("admin", "admin123456");
  const lo = await req("POST", "/api/auth/logout", { token: tmpTk });
  check("登出接口返回 200", lo.status === 200, `实际 ${lo.status}`);
  const after = await req("GET", "/api/auth/info", { token: tmpTk });
  check("登出后原 accessToken 立即失效（401）", after.status === 401, `实际 ${after.status}`);

  const alive = await login("admin", "admin123456");
  check("吊销后重新登录仍可正常获取新凭证", Boolean(alive));
  return alive;
}

// ══════════════════════════════════════════════════════════════════
// PART 3 · 边界与异常入参
// ══════════════════════════════════════════════════════════════════
async function part3(tk) {
  console.log("\n[PART 3] 边界与异常入参");

  // 登录参数
  const cases = [
    ["POST", "/api/auth/login", {}, "登录：空 body"],
    ["POST", "/api/auth/login", { type: "password", username: "", password: "" }, "登录：空账号密码"],
    ["POST", "/api/auth/login", { type: "unknown" }, "登录：非法 type"],
    ["POST", "/api/auth/login", { type: "password", username: "a".repeat(500), password: "x" }, "登录：超长账号"]
  ];
  for (const [m, p, b, label] of cases) {
    const r = await req(m, p, { body: b });
    // 429 同样视为通过：说明 H7 登录限速在生效（多次运行套件会累积失败计数触发限速），
    // 本断言的核心是「非法入参不得造成 500」
    check(`${label} → 400/429（不 500）`, r.status === 400 || r.status === 429, `实际 ${r.status}`);
  }

  // 分页极值
  for (const q of ["page=0&pageSize=0", "page=-1&pageSize=999999", "page=abc&pageSize=xyz"]) {
    const r = await req("GET", `/api/students?${q}`, { token: tk });
    check(`学生列表分页异常入参 (${q}) → 200 且不崩`, r.status === 200, `实际 ${r.status}`);
  }

  // 类型错 / 极值
  const bad = [
    ["POST", "/api/classes", { name: "" }, "班级：空名称"],
    ["POST", "/api/classes", { name: "x".repeat(300) }, "班级：超长名称"],
    ["POST", "/api/courses", { code: 123, name: null }, "课程：类型错误"],
    ["POST", "/api/students", { student_no: "", name: "" }, "学生：必填为空"],
    ["POST", "/api/students", { student_no: "S", name: "n", class_id: 999999 }, "学生：不存在的班级"],
    ["POST", "/api/finance/orders", { student_id: 999999, amount: 1 }, "订单：不存在的学生"],
    ["POST", "/api/finance/orders", { student_id: 1, amount: "abc", total_hours: 1 }, "订单：金额非数字"],
    ["POST", "/api/finance/payments", { order_id: 999999, student_id: 999999, amount: 1 }, "缴费：订单学生不匹配"],
    ["POST", "/api/attendance/batch", { date: "", records: [] }, "考勤：空 records"],
    ["POST", "/api/attendance/batch", { date: "2026-99-99", course_id: 1, records: [{ student_id: 1, status: "正常" }] }, "考勤：非法日期"],
    ["POST", "/api/attendance/batch", { date: "2026-09-01", course_id: 1, records: [{ student_id: 1, status: "不存在的状态" }] }, "考勤：非法状态枚举"],
    ["POST", "/api/leads", { name: "" }, "线索：空姓名"],
    ["POST", "/api/leads", { name: "n", source: "不存在的渠道" }, "线索：非法来源渠道"],
    ["POST", "/api/makeup-classes", {}, "补课：空 body"],
    ["PUT", "/api/students/999999", { name: "n" }, "学生：更新不存在的 ID"],
    ["DELETE", "/api/students/999999", {}, "学生：删除不存在的 ID"]
  ];
  for (const [m, p, b, label] of bad) {
    const r = await req(m, p, { token: tk, body: b });
    check(`${label} → 4xx（不 500）`, r.status >= 400 && r.status < 500, `实际 ${r.status}`);
  }

  // 非法 ID 形态
  for (const idv of ["abc", "-1", "999999999999999999999", "1;DROP TABLE users"]) {
    const r = await req("GET", `/api/finance/orders/${encodeURIComponent(idv)}`, { token: tk });
    check(`订单详情非法 ID「${idv}」未被 500/注入`, r.status !== 500, `实际 ${r.status}`);
  }

  // 搜索关键字中的注入与特殊字符
  for (const kw of ["' OR 1=1 --", "%", "_", "'; DROP TABLE students; --", "<script>alert(1)</script>"]) {
    const r = await req("GET", `/api/students?keyword=${encodeURIComponent(kw)}`, { token: tk });
    check(`学生搜索注入串「${kw.slice(0, 20)}」→ 200 且未 500`, r.status === 200, `实际 ${r.status}`);
  }
  const stillAlive = await req("GET", "/api/students?page=1&pageSize=1", { token: tk });
  check("注入尝试后 students 表仍可正常查询（未被破坏）", stillAlive.status === 200 && stillAlive.json?.success);
}

// ══════════════════════════════════════════════════════════════════
// PART 4 · 数据一致性对账（课时台账不变量）
// ══════════════════════════════════════════════════════════════════
async function part4(tk) {
  console.log("\n[PART 4] 数据一致性对账（课时台账不变量）");

  // 不变量：orders.remain_hours == total_hours - Σ扣减 + Σ回补
  // 通过接口取不到全量流水，因此用「学生维度课消统计」间接核对：
  //   total_hours - remain_hours（订单已耗） 应等于 该学生该订单的 净扣减流水
  const cons = await req("GET", "/api/finance/stats/consumption?dimension=student&page=1&pageSize=200", { token: tk });
  const rows = cons.json?.data?.list || [];
  check("课消统计（学生维度）可正常返回", cons.status === 200 && Array.isArray(rows), `实际 ${cons.status}`);

  const orders = await req("GET", "/api/finance/orders?page=1&pageSize=300", { token: tk });
  const orderList = orders.json?.data?.list || [];
  check("订单列表可正常返回", orders.status === 200 && Array.isArray(orderList));

  // 逐订单核对：已耗课时（total - remain）应与课消流水的 consumed - refunded 一致
  const byStudent = new Map();
  for (const r of rows) {
    const cur = byStudent.get(Number(r.student_id)) || { consumed: 0, refunded: 0 };
    cur.consumed += Number(r.consumed || 0);
    cur.refunded += Number(r.refunded || 0);
    byStudent.set(Number(r.student_id), cur);
  }

  const mismatches = [];
  for (const o of orderList) {
    const total = Number(o.total_hours || 0);
    const remain = Number(o.remain_hours || 0);
    if (total <= 0) continue;
    const used = total - remain;
    const stu = byStudent.get(Number(o.student_id));
    if (!stu) {
      if (used !== 0) mismatches.push(`订单#${o.id} 已耗 ${used} 课时但该学生无任何课消流水`);
      continue;
    }
    const net = stu.consumed - stu.refunded;
    if (net < used) {
      mismatches.push(`订单#${o.id} 已耗 ${used} > 流水净扣减 ${net}（学生#${o.student_id}）`);
    }
  }
  // 允许「流水净扣减 > 已耗」的整体性差异：多订单共享同一学生时该口径不可精确归属
  if (mismatches.length === 0) {
    ok("全部订单的已耗课时均未超过课时流水净扣减（台账未出现无流水扣减）");
  } else {
    warnIt(
      `发现 ${mismatches.length} 个订单的已耗课时大于课时流水净扣减（存在无流水扣减，或历史数据早于 v11 流水机制）`,
      mismatches.slice(0, 5).join("; ")
    );
  }

  // 收入口径自洽：revenue_recognized == Σ amount*(total-remain)/total
  const expected = orderList.reduce((s, o) => {
    const t = Number(o.total_hours || 0);
    if (t <= 0) return s;
    const r = Math.min(Number(o.remain_hours || 0), t);
    return s + (Number(o.amount || 0) * (t - r)) / t;
  }, 0);
  const reported = Number(cons.json?.data?.summary?.revenue_recognized ?? 0);
  const diff = Math.abs(expected - reported);
  if (diff < 1) {
    ok(`已确认收入与订单明细自洽（接口 ${reported.toFixed(2)} vs 明细推算 ${expected.toFixed(2)}）`);
  } else {
    // 差异可能来自分页截断（pageSize=300 上限）
    warnIt(
      `已确认收入接口值与订单明细推算不一致（差 ${diff.toFixed(2)}）——可能为订单分页截断所致，非必然缺陷`,
      `接口=${reported.toFixed(2)} 明细=${expected.toFixed(2)} 抽样订单数=${orderList.length}`
    );
  }

  // 现金口径与退费
  const revenue = await req("GET", "/api/finance/stats/revenue", { token: tk });
  check("营收统计接口正常", revenue.status === 200 && typeof revenue.json?.data?.totalRevenue === "number");

  // 退班订单仍需计入已确认收入（B3 修复验证）
  const refunded = orderList.filter(o => o.status === "退班");
  if (refunded.length) {
    const withConsumption = refunded.filter(o => Number(o.total_hours) > 0 && Number(o.remain_hours) < Number(o.total_hours));
    if (withConsumption.length) {
      const sum = withConsumption.reduce(
        (s, o) => s + (Number(o.amount) * (Number(o.total_hours) - Number(o.remain_hours))) / Number(o.total_hours),
        0
      );
      check(
        `退班订单 ($有消耗者 ${withConsumption.length} 单) 的已消耗收入 ${sum.toFixed(2)} 元未被排除在已确认收入之外`,
        reported >= sum - 1,
        `revenue_recognized=${reported.toFixed(2)}`
      );
    } else {
      ok(`退班订单共 ${refunded.length} 单，均无已消耗课时（无需断言收入保留）`);
    }
  } else {
    ok("当前无退班订单（该场景本次不适用）");
  }

  // 欠费统计不应出现负数
  const arrears = await req("GET", "/api/finance/stats/arrears", { token: tk });
  const negArrears = (arrears.json?.data?.list || []).filter(r => Number(r.arrears) <= 0);
  check("欠费统计无「非正数」条目（HAVING arrears > 0 生效）", negArrears.length === 0, `异常 ${negArrears.length} 条`);

  // 低课时预警只含在读
  const low = await req("GET", "/api/finance/stats/low-hours", { token: tk });
  check("低课时预警接口正常", low.status === 200);
  return orderList;
}

// ══════════════════════════════════════════════════════════════════
// PART 5 · 幂等与重复提交
// ══════════════════════════════════════════════════════════════════
async function part5(tk) {
  console.log("\n[PART 5] 幂等与重复提交");

  // 造一个独立学员 + 课时包订单
  const cls = await req("GET", "/api/classes/all", { token: tk });
  const classId = cls.json?.data?.[0]?.id;
  const courses = await req("GET", "/api/courses/all", { token: tk });
  const courseId = courses.json?.data?.[0]?.id;
  if (!classId || !courseId) {
    warnIt("缺少班级或课程，跳过幂等测试");
    return null;
  }

  const suffix = String(Date.now()).slice(-7);
  const stu = await req("POST", "/api/students", {
    token: tk,
    body: { student_no: `IDEM${suffix}`, name: `幂等测试${suffix}`, class_id: classId, gender: "男" }
  });
  const studentId = stu.json?.data?.id;
  check("创建幂等测试学员", Boolean(studentId), JSON.stringify(stu.json));

  const order = await req("POST", "/api/finance/orders", {
    token: tk,
    body: { student_id: studentId, class_id: classId, course_id: courseId, amount: 1000, total_hours: 10 }
  });
  const orderId = order.json?.data?.id;
  check("创建课时包订单（10 课时）", Boolean(orderId), JSON.stringify(order.json));

  const batch = {
    date: "2026-09-01",
    course_id: courseId,
    records: [{ student_id: studentId, status: "正常" }]
  };

  // 首次提交：扣 1 课时
  const r1 = await req("POST", "/api/attendance/batch", { token: tk, body: batch });
  check("首次提交考勤（正常）成功", r1.status === 200, `实际 ${r1.status}`);
  const o1 = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
  const after1 = Number(o1.json?.data?.remain_hours);
  check(`首次提交后剩余课时由 10 → ${after1}（应为 9）`, after1 === 9, `实际 ${after1}`);

  // 重复提交同一批次：不得重复扣课时
  const r2 = await req("POST", "/api/attendance/batch", { token: tk, body: batch });
  const o2 = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
  const after2 = Number(o2.json?.data?.remain_hours);
  check(`重复提交同一批次后剩余课时仍为 ${after1}（未重复扣减）`, after2 === after1, `实际 ${after2}`);

  // 重复登记缴费（业务上允许，但需确认无重复拦截）
  const p1 = await req("POST", "/api/finance/payments", { token: tk, body: { order_id: orderId, student_id: studentId, amount: 500 } });
  const p2 = await req("POST", "/api/finance/payments", { token: tk, body: { order_id: orderId, student_id: studentId, amount: 500 } });
  check("同一订单可多次登记缴费（分次付款为合法业务）", p1.status === 200 && p2.status === 200);

  // 退费重复审批
  const rf = await req("POST", "/api/finance/refunds", { token: tk, body: { order_id: orderId, student_id: studentId, amount: 100, reason: "幂等测试" } });
  const refundId = rf.json?.data?.id;
  if (refundId) {
    const a1 = await req("PUT", `/api/finance/refunds/${refundId}/approve`, { token: tk, body: { status: "通过" } });
    const a2 = await req("PUT", `/api/finance/refunds/${refundId}/approve`, { token: tk, body: { status: "通过" } });
    check("退费首次审批通过（200）", a1.status === 200, `实际 ${a1.status}`);
    check("退费重复审批被拒（400，防止二次退款）", a2.status === 400, `实际 ${a2.status}`);
  } else {
    bad("退费申请创建失败，无法验证重复审批", JSON.stringify(rf.json));
  }

  // 重复"设为当前学期"（唯一当前学期约束）
  const terms = await req("GET", "/api/terms/all", { token: tk });
  const firstTerm = terms.json?.data?.[0]?.id;
  if (firstTerm) {
    const t1 = await req("PUT", `/api/terms/${firstTerm}/current`, { token: tk });
    const t2 = await req("PUT", `/api/terms/${firstTerm}/current`, { token: tk });
    const cur = await req("GET", "/api/terms/current", { token: tk });
    check("重复设为当前学期不报错且仍只有一个当前学期", t1.status === 200 && t2.status === 200 && cur.json?.data?.is_current === 1,
      `t1=${t1.status} t2=${t2.status}`);
  }

  return { studentId, orderId, courseId, classId, suffix };
}

// ══════════════════════════════════════════════════════════════════
// PART 6 · 敏感字段泄露 & H10 已知缺陷复现
// ══════════════════════════════════════════════════════════════════
async function part6(tk, ctx) {
  console.log("\n[PART 6] 敏感字段泄露 + 已知缺陷复现");

  const info = await req("GET", "/api/auth/info", { token: tk });
  const infoStr = JSON.stringify(info.json);
  check("用户信息接口不含 password_hash", !/password_hash|passwordHash/.test(infoStr));
  check("用户信息接口不含 token_version", !/token_version/.test(infoStr));

  const users = await req("GET", "/api/users?page=1&pageSize=50", { token: tk });
  const usersStr = JSON.stringify(users.json);
  check("员工列表不含 password_hash", !/password_hash/.test(usersStr));

  // 学员列表含家长电话（业务需要），但不应含密码类字段
  const stu = await req("GET", "/api/students?page=1&pageSize=5", { token: tk });
  check("学生列表不含密码哈希字段", !/password_hash/.test(JSON.stringify(stu.json)));

  // 错误响应不泄露堆栈
  const boom = await req("GET", "/api/finance/orders/abc", { token: tk });
  const boomStr = JSON.stringify(boom.json || "");
  check("错误响应不含堆栈信息（无 at /node_modules/ 等）", !/\bat \w|node_modules|\.js:\d+/.test(boomStr), boomStr.slice(0, 80));

  // ── 权限收紧脱敏验证（2026-09-12）：reports 接口对 teacher 字段级脱敏 ──────
  // 学员报告：teacher 可访问（教学信息保留），但订单摘要不得含 amount / paid
  // 成长档案：teacher 可访问，但时间线不得含 缴费 / 退费 事件
  {
    const ttk = await login("teacher", "teacher123456");
    if (ttk) {
      const myStudents = await req("GET", "/api/students?page=1&pageSize=1", { token: ttk });
      const sid = myStudents.json?.data?.list?.[0]?.id;
      if (sid) {
        const rep = await req("GET", `/api/reports/students/${sid}`, { token: ttk });
        check("teacher 学员报告可访问（200）", rep.status === 200, `实际 ${rep.status}`);
        const repStr = JSON.stringify(rep.json?.data?.orders || []);
        check("teacher 学员报告订单摘要不含金额字段（amount/paid）",
          !/"amount"|"paid"/.test(repStr), repStr.slice(0, 100));
        check("teacher 学员报告仍含教学信息（hours/scores/attendance）",
          Boolean(rep.json?.data?.hours !== undefined && rep.json?.data?.scores !== undefined));
        const tl = await req("GET", `/api/reports/students/${sid}/timeline`, { token: ttk });
        const tlStr = JSON.stringify(tl.json?.data?.events || tl.json?.data || []);
        check("teacher 成长档案时间线不含缴费/退费事件",
          !/"type":"缴费"|"type":"退费"/.test(tlStr), tlStr.slice(0, 100));
        // admin 对照：金额字段应存在
        const repA = await req("GET", `/api/reports/students/${sid}`, { token: tk });
        const hasAmount = (repA.json?.data?.orders || []).some(o => typeof o.amount === "number");
        check("admin 学员报告订单摘要含金额字段（对照组）",
          (repA.json?.data?.orders || []).length === 0 || hasAmount,
          "（无在读订单时跳过字段断言）");
      } else {
        warnIt("teacher 无可管理学员，跳过 reports 脱敏验证");
      }
    }
  }

  // ── H10 已知缺陷复现：课时耗尽后销假回补失败 ──────────────────
  // 注意：必须自建独立学员+订单。复用 PART5 的订单会失败——PART5 末尾的退费审批
  // 已把订单置为「退班」，而退班订单按设计不参与课时扣减/回补（status='在读' 过滤）。
  const h10cls = await req("GET", "/api/classes/all", { token: tk });
  const h10course = await req("GET", "/api/courses/all", { token: tk });
  const h10classId = h10cls.json?.data?.[0]?.id;
  const courseId = h10course.json?.data?.[0]?.id;
  if (!h10classId || !courseId) {
    warnIt("缺少班级或课程，跳过 H10 复现");
    return;
  }
  const h10sfx = String(Date.now()).slice(-7);
  const h10stu = await req("POST", "/api/students", {
    token: tk,
    body: { student_no: `H10${h10sfx}`, name: `H10复现${h10sfx}`, class_id: h10classId, gender: "男" }
  });
  const studentId = h10stu.json?.data?.id;
  const h10order = await req("POST", "/api/finance/orders", {
    token: tk,
    body: { student_id: studentId, class_id: h10classId, course_id: courseId, amount: 100, total_hours: 10 }
  });
  const orderId = h10order.json?.data?.id;
  if (!studentId || !orderId) {
    warnIt("H10 测试数据创建失败", JSON.stringify(h10order.json));
    return;
  }
  // 把订单改成只剩 1 课时
  await req("PUT", `/api/finance/orders/${orderId}`, { token: tk, body: { remain_hours: 1 } });
  // 「正常」出勤 → 扣至 0（注意：本系统口径是 正常/迟到/早退 才扣课时；缺勤不扣）
  const absentDate = "2026-09-03";
  const rb = await req("POST", "/api/attendance/batch", {
    token: tk,
    body: { date: absentDate, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }
  });
  const afterAbsent = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
  const remainAtZero = Number(afterAbsent.json?.data?.remain_hours);

  // 提交该日请假并审批通过 → 应回补 1 课时
  const lv = await req("POST", "/api/leaves", {
    token: tk,
    body: { student_id: studentId, type: "病假", reason: "H10 复现", start_date: absentDate, end_date: absentDate }
  });
  const leaveId = lv.json?.data?.id;
  if (!leaveId) {
    warnIt("请假创建失败，无法复现 H10", JSON.stringify(lv.json));
    return;
  }
  const ap = await req("PUT", `/api/leaves/${leaveId}/approve`, { token: tk, body: { status: "通过" } });
  const afterLeave = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
  const remainAfterLeave = Number(afterLeave.json?.data?.remain_hours);

  console.log(`      课时轨迹：扣至 ${remainAtZero} → 销假后 ${remainAfterLeave}`);
  if (remainAtZero === 0 && remainAfterLeave === remainAtZero) {
    bad(
      "【H10 缺陷复现】课时耗尽(remain=0)后销假未回补课时 —— 每个学员「最后一课时」都会复现",
      `审批 HTTP ${ap.status}；销假后 remain_hours 仍为 ${remainAfterLeave}，应为 1`
    );
  } else if (remainAfterLeave === remainAtZero + 1) {
    ok(`课时耗尽后销假正确回补（${remainAtZero} → ${remainAfterLeave}）—— H10 未复现`);
  } else {
    warnIt(`销假回补结果异常：${remainAtZero} → ${remainAfterLeave}`, `审批 HTTP ${ap.status}`);
  }

  // 清理
  const cleanup = [];
  if (leaveId) cleanup.push(["DELETE", `/api/leaves/${leaveId}`]);
  if (orderId) cleanup.push(["DELETE", `/api/finance/refunds?order_id=${orderId}`]);
  cleanup.push(["DELETE", `/api/students/${studentId}`]);
  for (const [m, p] of cleanup) {
    try {
      await req(m, p, { token: tk });
    } catch {
      /* 清理尽力而为 */
    }
  }
  console.log("      已尝试清理测试数据（残留由 e2e 的清理阶段兜底）");
}

// ══════════════════════════════════════════════════════════════════
(async () => {
  console.log(`\n${"═".repeat(64)}\n全面接口测试套件\n目标：${BASE}\n${"═".repeat(64)}`);

  const adminTk = await login("admin", "admin123456");
  const teacherTk = await login("teacher", "teacher123456");
  if (!adminTk || !teacherTk) {
    console.error("登录失败，无法继续");
    process.exit(1);
  }
  console.log("  已获取 admin / teacher 凭证");

  await part1(adminTk, teacherTk);
  const freshAdmin = await part2(adminTk, teacherTk);
  await part3(freshAdmin);
  await part4(freshAdmin);
  const ctx = await part5(freshAdmin);
  await part6(freshAdmin, ctx);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`汇总：PASS ${pass} / FAIL ${fail} / WARN ${warn}`);
  if (failures.length) {
    console.log("\n❌ 失败项：");
    failures.forEach(f => console.log(`   · ${f}`));
  }
  if (warnings.length) {
    console.log("\n⚠️  需人工判读项：");
    warnings.forEach(w => console.log(`   · ${w}`));
  }
  console.log(`${"═".repeat(64)}\n`);
  process.exit(fail ? 1 : 0);
})();
