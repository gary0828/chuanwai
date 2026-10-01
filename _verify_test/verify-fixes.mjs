// 上线门禁修复验证脚本（一次性，位于 .gitignore 忽略的 _verify_test/）
// 用法：node _verify_test/verify-fixes.mjs [baseUrl]
import crypto from "node:crypto";

const BASE = process.argv[2] || "http://127.0.0.1:3101";
const OLD_PUBLIC_SECRET = "attendance-secret-key-change-me";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` → ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? ` → ${detail}` : ""}`);
  }
}

async function req(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 忽略非 JSON 响应 */
  }
  return { status: res.status, json, headers: res.headers };
}

/** 用 base64url 手写 JWT，验证「伪造管理员凭证」是否被拒 */
function forgeToken(secret) {
  const b64 = obj =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    id: 1,
    username: "admin",
    role: "admin",
    tv: 0,
    iat: now,
    exp: now + 3600
  });
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${head}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${head}.${payload}.${sig}`;
}

console.log(`\n=== 验证目标：${BASE} ===\n`);

// ── 1. 健康检查 + 安全响应头（H7）────────────────────────────────────
console.log("[1] 健康检查与安全响应头（H7）");
const health = await req("GET", "/api/health");
check("GET /api/health 返回 200", health.status === 200, `实际 ${health.status}`);
check(
  "已启用 X-Content-Type-Options: nosniff",
  health.headers.get("x-content-type-options") === "nosniff"
);
check(
  "已启用 X-Frame-Options（helmet）",
  Boolean(health.headers.get("x-frame-options"))
);
check(
  "未返回 X-Powered-By（express 指纹已隐藏）",
  !health.headers.get("x-powered-by")
);

// ── 2. CORS 白名单（H7）──────────────────────────────────────────────
console.log("\n[2] CORS 来源白名单（H7）");
const evil = await req("GET", "/api/health", {
  headers: { Origin: "http://evil.example.com" }
});
check(
  "非白名单来源未获得 Access-Control-Allow-Origin",
  !evil.headers.get("access-control-allow-origin"),
  `实际=${evil.headers.get("access-control-allow-origin")}`
);
const allowed = await req("GET", "/api/health", {
  headers: { Origin: "http://localhost:8848" }
});
check(
  "白名单来源 http://localhost:8848 被放行",
  allowed.headers.get("access-control-allow-origin") === "http://localhost:8848",
  `实际=${allowed.headers.get("access-control-allow-origin")}`
);

// ── 3. 旧默认密钥伪造凭证必须被拒（B1）───────────────────────────────
console.log("\n[3] 旧默认密钥伪造凭证（B1）");
const forged = await req("GET", "/api/auth/info", {
  token: forgeToken(OLD_PUBLIC_SECRET)
});
check(
  "用公开默认密钥自签的 admin token 被拒绝（401）",
  forged.status === 401,
  `实际 ${forged.status}`
);

// ── 4. 正常登录 + 鉴权 ───────────────────────────────────────────────
console.log("\n[4] 登录与鉴权");
const login = await req("POST", "/api/auth/login", {
  body: { type: "password", username: "admin", password: "admin123456" }
});
check("admin 登录成功", login.status === 200 && login.json?.success, `实际 ${login.status}`);
const accessToken = login.json?.data?.accessToken;
const refreshToken = login.json?.data?.refreshToken;
check("返回 accessToken / refreshToken", Boolean(accessToken && refreshToken));

const info = await req("GET", "/api/auth/info", { token: accessToken });
check("携带 token 访问 /api/auth/info 成功", info.status === 200);

const noToken = await req("GET", "/api/auth/info");
check("无 token 访问返回 401", noToken.status === 401, `实际 ${noToken.status}`);

// ── 5. 登出吊销凭证（H2）─────────────────────────────────────────────
console.log("\n[5] 登出即吊销（H2）");
const logout = await req("POST", "/api/auth/logout", { token: accessToken });
check("登出接口返回 200（此前是空实现）", logout.status === 200, `实际 ${logout.status}`);
const afterLogout = await req("GET", "/api/auth/info", { token: accessToken });
check(
  "登出后原 accessToken 立即失效（401）",
  afterLogout.status === 401,
  `实际 ${afterLogout.status}`
);
const refreshAfterLogout = await req("POST", "/api/auth/refresh-token", {
  body: { refreshToken }
});
check(
  "登出后原 refreshToken 也无法换取新凭证（401）",
  refreshAfterLogout.status === 401,
  `实际 ${refreshAfterLogout.status}`
);

// 重新登录供后续用例使用
const login2 = await req("POST", "/api/auth/login", {
  body: { type: "password", username: "admin", password: "admin123456" }
});
const tk = login2.json?.data?.accessToken;
check("重新登录成功", Boolean(tk));

// ── 6. 财务金额与课时边界校验（B4）───────────────────────────────────
console.log("\n[6] 财务边界校验（B4）");
// 准备一个学员与订单
const cls = await req("GET", "/api/classes/all", { token: tk });
const classId = cls.json?.data?.[0]?.id;
check("取到班级（前置条件）", Boolean(classId));

const stuNo = "VERIFY" + Date.now();
const stu = await req("POST", "/api/students", {
  token: tk,
  body: { student_no: stuNo, name: "验证学员", class_id: classId, gender: "女" }
});
const studentId = stu.json?.data?.id;
check("创建验证学员成功（前置条件）", Boolean(studentId), JSON.stringify(stu.json));

const negAmount = await req("POST", "/api/finance/orders", {
  token: tk,
  body: { student_id: studentId, class_id: classId, amount: -500, total_hours: 10 }
});
check(
  "负数订单金额被拒（400）",
  negAmount.status === 400,
  `实际 ${negAmount.status} ${negAmount.json?.message || ""}`
);

const hugeAmount = await req("POST", "/api/finance/orders", {
  token: tk,
  body: { student_id: studentId, class_id: classId, amount: 99999999999, total_hours: 10 }
});
check(
  "超大订单金额被拒（400）",
  hugeAmount.status === 400,
  `实际 ${hugeAmount.status} ${hugeAmount.json?.message || ""}`
);

const badHours = await req("POST", "/api/finance/orders", {
  token: tk,
  body: { student_id: studentId, class_id: classId, amount: 1000, total_hours: -3 }
});
check(
  "负数课时被拒（400）",
  badHours.status === 400,
  `实际 ${badHours.status} ${badHours.json?.message || ""}`
);

const okOrder = await req("POST", "/api/finance/orders", {
  token: tk,
  body: { student_id: studentId, class_id: classId, amount: 1000, total_hours: 10 }
});
const orderId = okOrder.json?.data?.id;
check("正常订单创建成功（前置条件）", Boolean(orderId), JSON.stringify(okOrder.json));

const negPayment = await req("POST", "/api/finance/payments", {
  token: tk,
  body: { order_id: orderId, student_id: studentId, amount: -100 }
});
check(
  "负数缴费金额被拒（400）",
  negPayment.status === 400,
  `实际 ${negPayment.status}`
);

const overRefund = await req("POST", "/api/finance/refunds", {
  token: tk,
  body: { order_id: orderId, student_id: studentId, amount: 9999, reason: "验证超额退费" }
});
check(
  "退费金额超过已缴金额被拒（400）",
  overRefund.status === 400,
  `实际 ${overRefund.status} ${overRefund.json?.message || ""}`
);

// ── 7. 手工改课时必须留流水（B4）─────────────────────────────────────
console.log("\n[7] 手工调整剩余课时留流水（B4）");
const before = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
const remainBefore = before.json?.data?.remain_hours;
const adjust = await req("PUT", `/api/finance/orders/${orderId}`, {
  token: tk,
  body: { remain_hours: remainBefore - 3 }
});
check("手工调整剩余课时成功", adjust.status === 200, `实际 ${adjust.status}`);
const after = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
check(
  `剩余课时由 ${remainBefore} 变为 ${after.json?.data?.remain_hours}`,
  after.json?.data?.remain_hours === remainBefore - 3
);
const cons = await req(
  "GET",
  `/api/finance/stats/consumption?dimension=student&page=1&pageSize=50`,
  { token: tk }
);
const list = cons.json?.data?.list || [];
const adjRow = list.find(r => Number(r.student_id) === Number(studentId));
check(
  "课消统计已反映该笔手工调整（生成 hours 流水）",
  Boolean(adjRow) && Number(adjRow.consumed) >= 3,
  `consumed=${adjRow?.consumed}`
);

// ── 8. 超上限课时被拒 ────────────────────────────────────────────────
const hugeHours = await req("PUT", `/api/finance/orders/${orderId}`, {
  token: tk,
  body: { total_hours: 999999 }
});
check(
  "超上限课时被拒（400）",
  hugeHours.status === 400,
  `实际 ${hugeHours.status} ${hugeHours.json?.message || ""}`
);

// ── 8. 退班后已消耗课时收入不得消失（B3）─────────────────────────────
console.log("\n[8] 退班后收入确认口径（B3）");
const revBefore = Number(
  (await req("GET", "/api/finance/stats/consumption", { token: tk })).json?.data
    ?.summary?.revenue_recognized
);
// 先缴费（退费上限校验以实缴为准），再提交并审批退费
const pay = await req("POST", "/api/finance/payments", {
  token: tk,
  body: { order_id: orderId, student_id: studentId, amount: 1000 }
});
check("登记缴费 1000 元成功（前置条件）", pay.status === 200, `实际 ${pay.status}`);
const refund = await req("POST", "/api/finance/refunds", {
  token: tk,
  body: { order_id: orderId, student_id: studentId, amount: 300, reason: "验证退班口径" }
});
const refundId = refund.json?.data?.id;
check("提交退费申请成功（前置条件）", Boolean(refundId), JSON.stringify(refund.json));
const approve = await req("PUT", `/api/finance/refunds/${refundId}/approve`, {
  token: tk,
  body: { status: "通过" }
});
check("退费审批通过", approve.status === 200, `实际 ${approve.status}`);
const orderAfterRefund = await req("GET", `/api/finance/orders/${orderId}`, { token: tk });
check(
  "订单已置为「退班」",
  orderAfterRefund.json?.data?.status === "退班",
  `实际 ${orderAfterRefund.json?.data?.status}`
);
check(
  "退班后 orders.remain_hours 保留原值（退款核算依据）",
  Number(orderAfterRefund.json?.data?.remain_hours) === remainBefore - 3,
  `实际 ${orderAfterRefund.json?.data?.remain_hours}`
);
const revAfter = Number(
  (await req("GET", "/api/finance/stats/consumption", { token: tk })).json?.data
    ?.summary?.revenue_recognized
);
check(
  `退班后已确认收入未消失（退班前 ${revBefore} → 退班后 ${revAfter}）`,
  revAfter >= revBefore,
  `退班导致收入下降 ${(revBefore - revAfter).toFixed(2)} 元 —— 修复前该订单 300 元会被整单抹除`
);

// ── 9. 课消统计 revenue_recognized 可用（B3）──────────────────────────
console.log("\n[9] 收入确认口径（B3）");
const consumption = await req("GET", "/api/finance/stats/consumption", { token: tk });
check(
  "课消统计接口正常返回（含 revenue_recognized）",
  consumption.status === 200 &&
    typeof consumption.json?.data?.summary?.revenue_recognized === "number",
  `实际 ${consumption.status} revenue=${consumption.json?.data?.summary?.revenue_recognized}`
);
// 该订单已消耗 3 课时 / 共 10 课时 → 应确认 1000 × 3/10 = 300
const rec = Number(consumption.json?.data?.summary?.revenue_recognized);
check(
  `已确认收入 ≥ 300（本例该订单 1000 元 × 3/10）`,
  rec >= 300,
  `实际 ${rec}`
);

// ── 汇总 ─────────────────────────────────────────────────────────────
console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
if (failures.length) {
  console.log("失败项：");
  failures.forEach(f => console.log(`  · ${f}`));
}
process.exit(fail ? 1 : 0);
