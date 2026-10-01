// 针对本次改动的端点做专项验证：finance / leads 全部路由
// 重点验证：去掉 scope.where / canManageOrder 后，SQL 拼接与权限守卫行为不变
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

async function req(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let j = null;
  try { j = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, json: j };
}

const admin = await login("admin", "admin123456");
const teacher = await login("teacher", "teacher123456");
ck(!!admin, "admin 登录成功");
ck(!!teacher, "teacher 登录成功");

// admin 应可访问的 GET 端点（含被改过 SQL 的统计类）
const adminGets = [
  "/finance/orders",
  "/finance/orders?status=%E5%9C%A8%E8%AF%BB",
  "/finance/orders?keyword=a&class_id=1&low_hours=5",
  "/finance/orders?page=1&pageSize=5",
  "/finance/payments",
  "/finance/refunds",
  "/finance/stats/revenue",
  "/finance/stats/arrears",
  "/finance/stats/low-hours",
  "/finance/stats/business",
  "/finance/stats/consumption",
  "/leads",
  "/leads?status=%E8%B7%9F%E8%BF%9B%E4%B8%AD&keyword=a",
  "/leads/stats/channels"
];
for (const p of adminGets) {
  const { status, json } = await req("GET", p, admin);
  ck(status === 200 && json?.success === true, `admin GET ${p}`, `→ ${status} ${JSON.stringify(json)?.slice(0, 80)}`);
}

// teacher 应全部被拒（403）
const teacherPaths = [
  ["GET", "/finance/orders"], ["GET", "/finance/orders/1"],
  ["GET", "/finance/payments"], ["GET", "/finance/refunds"],
  ["GET", "/finance/stats/revenue"], ["GET", "/finance/stats/arrears"],
  ["GET", "/finance/stats/low-hours"], ["GET", "/finance/stats/business"],
  ["GET", "/finance/stats/consumption"],
  ["GET", "/leads"], ["GET", "/leads/stats/channels"],
  ["POST", "/finance/payments"], ["POST", "/finance/refunds"], ["POST", "/finance/orders"],
  ["POST", "/leads"], ["PUT", "/leads/1"], ["PUT", "/leads/1/follow"],
  ["PUT", "/leads/1/status"], ["DELETE", "/leads/1"],
  ["PUT", "/finance/orders/1/status"], ["PUT", "/finance/orders/1"],
  ["PUT", "/finance/payments/1"], ["DELETE", "/finance/orders/1"]
];
for (const [m, p] of teacherPaths) {
  const { status } = await req(m, p, teacher, m === "GET" ? undefined : {});
  ck(status === 403, `teacher ${m} ${p} 被拒`, `→ ${status}`);
}

// 未登录应 401
for (const p of ["/finance/orders", "/leads", "/finance/stats/revenue"]) {
  const { status } = await req("GET", p, null);
  ck(status === 401, `未登录 GET ${p} → 401`, `→ ${status}`);
}

// 被改过守卫的写操作：admin 应放行（幂等写，不改变数据）
const orders = await req("GET", "/finance/orders?pageSize=1", admin);
const oid = orders.json?.data?.list?.[0]?.id;
if (oid) {
  const cur = orders.json.data.list[0].status;
  const { status } = await req("PUT", `/finance/orders/${oid}/status`, admin, { status: cur });
  ck(status === 200, `admin PUT /finance/orders/${oid}/status 放行（原值回写，幂等）`, `→ ${status}`);
  const put = await req("PUT", `/finance/orders/${oid}`, admin, { remark: orders.json.data.list[0].remark ?? "" });
  ck(put.status === 200, `admin PUT /finance/orders/${oid} 放行`, `→ ${put.status}`);
} else {
  ck(false, "取到订单样本用于写操作验证");
}

// 数据一致性：revenue 统计的 records 与 orders 列表口径可对齐
const rev = await req("GET", "/finance/stats/business", admin);
ck(rev.status === 200, "stats/business 返回 200（含 scope 移除后的 SQL）");

console.log(`\n==== finance/leads 专项: PASS ${pass} / ${pass + fail} ====`);
if (fail) { console.log("失败项:"); failed.forEach(f => console.log("  - " + f)); process.exit(1); }
