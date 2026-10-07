// 图表数据契约验证（2026-10-03 新增）
//
// 目的：6 个新图表全部依赖既有后端接口的**返回字段名**。
// 字段名一旦猜错，图表会静默变成空态（前端 computed 返回 null）——
// 这正是 K-050「静默即缺陷」要防的情况，靠肉眼看截图发现不了。
// 本脚本直接断言每个图表实际读取的那个字段是否存在且有值。
//
// 运行： node _verify_test/verify-charts.mjs        （默认打 3000）
//      BASE=http://127.0.0.1:18080/api node _verify_test/verify-charts.mjs
const BASE = (process.env.BASE || "http://127.0.0.1:3000") + "/api";

let pass = 0, fail = 0;
const failed = [];
function ck(cond, label, extra = "") {
  if (cond) { pass++; console.log(`[PASS] ${label}`); }
  else { fail++; failed.push(label); console.log(`[FAIL] ${label} ${extra}`); }
}

async function login(username, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await r.json();
  return j?.data?.accessToken;
}

async function get(path, token) {
  const r = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j };
}

const admin = await login("admin", "admin123456");
const teacher = await login("teacher", "teacher123456");
ck(!!admin, "admin 登录成功");
ck(!!teacher, "teacher 登录成功");
if (!admin) { console.log("无法继续"); process.exit(1); }

/* ── 图表① 财务营收折线：读 list[].period / gross / refunded / total ── */
{
  const { status, json } = await get("/finance/stats/revenue?granularity=month", admin);
  ck(status === 200 && json?.success, "营收接口 200", `status=${status}`);
  const list = json?.data?.list;
  ck(Array.isArray(list), "营收返回 list 数组");
  if (Array.isArray(list) && list.length) {
    const r = list[0];
    // 这四个字段是折线图的三条线 + X 轴，少任何一个图表就画不出来
    ["period", "gross", "refunded", "total"].forEach(k =>
      ck(k in r, `营收行含字段 ${k}`, JSON.stringify(r))
    );
  } else {
    console.log("[SKIP] 营收无数据（空库）—— 空态分支由前端 empty-* 文案覆盖");
  }
}

/* ── 图表② 课程收入环形：读 data.revenue_by_course（snake_case！） ── */
{
  const { status, json } = await get("/finance/stats/business", admin);
  ck(status === 200 && json?.success, "经营报表接口 200", `status=${status}`);
  ck("revenue_by_course" in (json?.data || {}),
    "★ 存在 revenue_by_course（易错：不是 courseRevenue）");
  const rows = json?.data?.revenue_by_course;
  ck(Array.isArray(rows), "revenue_by_course 是数组");
  if (Array.isArray(rows) && rows.length) {
    ck("course_name" in rows[0] && "total" in rows[0],
      "课程行含 course_name / total", JSON.stringify(rows[0]));
  }
}

/* ── 图表③ 课消排名条形：course 维度读 course_name，teacher 维度读 class_name ── */
{
  const c = await get("/finance/stats/consumption?dimension=course", admin);
  ck(c.status === 200 && c.json?.success, "课消 course 维度 200");
  ck(Array.isArray(c.json?.data?.list), "课消返回 list");
  if (c.json?.data?.list?.length) {
    ck("consumed" in c.json.data.list[0], "课消行含 consumed");
  }
  const t = await get("/finance/stats/consumption?dimension=teacher", admin);
  ck(t.status === 200 && t.json?.success, "课消 teacher 维度 200");
  if (t.json?.data?.list?.length) {
    ck("class_name" in t.json.data.list[0],
      "teacher 维度含 class_name（图例取 course_name || class_name）");
  }
}

/* ── 图表④ 招生漏斗 + 渠道条形：读 summary.{total,following,converted} 与 list[].{source,total,converted} ── */
{
  const { status, json } = await get("/leads/stats/channels", admin);
  ck(status === 200 && json?.success, "渠道统计接口 200", `status=${status}`);
  const s = json?.data?.summary;
  ck(!!s, "存在 summary");
  if (s) {
    ["total", "following", "converted"].forEach(k =>
      ck(k in s, `summary 含 ${k}（漏斗三段依赖）`, JSON.stringify(s))
    );
  }
  const list = json?.data?.list;
  if (Array.isArray(list) && list.length) {
    ["source", "total", "converted"].forEach(k =>
      ck(k in list[0], `渠道行含 ${k}`, JSON.stringify(list[0]))
    );
  } else {
    console.log("[SKIP] 无线索数据（空库）");
  }
}

/* ── 图表⑤⑥ 剩余课时分布：读 list[].remain_hours（dimension=student） ── */
{
  const { status, json } = await get("/finance/stats/consumption?dimension=student", admin);
  ck(status === 200 && json?.success, "课消 student 维度 200", `status=${status}`);
  if (json?.data?.list?.length) {
    const r = json.data.list[0];
    ["student_name", "remain_hours", "consumed"].forEach(k =>
      ck(k in r, `student 维度含 ${k}（课时分布依赖）`, JSON.stringify(r))
    );
  } else {
    console.log("[SKIP] 无学员课时数据（空库）");
  }
}

/* ── 权限：这些接口都是 requireRole("admin")，教师端必须 403（前端据此隐藏图表） ── */
{
  const r = await get("/finance/stats/business", teacher);
  ck(r.status === 403, "教师访问经营报表 403（图表仅 admin 可见的前提）", `实际 ${r.status}`);
  const l = await get("/leads/stats/channels", teacher);
  ck(l.status === 403, "教师访问渠道统计 403", `实际 ${l.status}`);
}

/* ── 首页看板（图表参照范本所在接口，确认未被本次改动影响） ── */
{
  const { status, json } = await get("/dashboard/overview", admin);
  ck(status === 200 && json?.success, "首页看板 200（既有图表未受影响）");
  ck(Array.isArray(json?.data?.trend), "看板 trend 数组仍在");
}

console.log(`\n=== 图表数据契约：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log("失败项：", failed.join(" | ")); process.exit(1); }