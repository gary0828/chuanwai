/**
 * AI 只读数据网关 + 最小权限凭证 专项验证
 * 覆盖：server/src/routes/agent.js、routes/ai.js（agentToken）、middleware/auth.js（类型路径校验）
 * 运行：node _verify_test/verify-agent.mjs [base]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3100";

let pass = 0;
let fail = 0;

function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${extra ? "  → " + extra : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, raw: JSON.stringify(body) };
}

const post = body => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

console.log(`\n=== AI 只读网关 + 最小权限凭证验证 @ ${BASE} ===\n`);

let r = await req(
  "/api/auth/login",
  post({ type: "password", username: "admin", password: "admin123456" })
);
const adminTok = r.body?.data?.accessToken;
ok("admin 登录成功", !!adminTok);
if (!adminTok) {
  console.log("\n登录失败，后续用例跳过。");
  process.exit(1);
}
const AH = { Authorization: `Bearer ${adminTok}` };

r = await req("/api/agent/context", { headers: AH });
ok(
  "上下文接口可用",
  r.status === 200 && Array.isArray(r.body?.data?.classes),
  r.status + " " + r.raw.slice(0, 120)
);
const caps = r.body?.data?.capabilities || {};
ok(
  "返回 capabilities（如实反映库内数据）",
  typeof caps.students === "boolean" && typeof caps.scores === "boolean",
  JSON.stringify(caps)
);
ok("返回 data_version", /^v\d+$/.test(r.body?.data?.data_version || ""), r.body?.data?.data_version);
const classes = r.body?.data?.classes || [];

r = await req("/api/agent/context");
ok("未登录访问被拒（401）", r.status === 401, String(r.status));

if (classes.length) {
  const cid = classes[0].id;
  r = await req(`/api/agent/classes/${cid}/overview`, { headers: AH });
  ok(
    "班级概览可用",
    r.status === 200 && Array.isArray(r.body?.data?.students),
    r.status + " " + r.raw.slice(0, 120)
  );
  ok("返回 summary 聚合", typeof r.body?.data?.summary?.student_count === "number");
  ok("不含家长电话 / 手机号字段", !/parent_phone|"phone"|"email"/.test(r.raw));
  ok("不含任何金额字段", !/"amount"|"paid"|"balance"/.test(r.raw));
  ok(
    "学员含考勤聚合结构",
    r.body?.data?.students?.every(s => typeof s.attendance?.total === "number") ?? false
  );
}

r = await req("/api/agent/classes/999999/overview", { headers: AH });
ok("不存在的班级返回 404", r.status === 404, String(r.status));

r = await req("/api/agent/classes/abc/overview", { headers: AH });
ok("非法班级 ID 返回 400", r.status === 400, String(r.status));

// ── 只读凭证（agentToken）权限边界 ─────────────────────────────
r = await req("/api/ai/sso/ticket", { method: "POST", headers: AH });
const ticket = r.body?.data?.ticket;
ok("可取免登票据", !!ticket);

r = await req("/api/ai/sso/verify", post({ ticket }));
const agentToken = r.body?.data?.agentToken;
ok(
  "换会话时返回只读凭证",
  typeof agentToken === "string" && agentToken.length > 20,
  r.raw.slice(0, 120)
);

if (agentToken) {
  const agentClaims = JSON.parse(
    Buffer.from(agentToken.split(".")[1], "base64url").toString("utf8")
  );
  ok("只读凭证类型为 ai_agent", agentClaims.type === "ai_agent", String(agentClaims.type));

  const TH = { Authorization: `Bearer ${agentToken}` };

  r = await req("/api/agent/context", { headers: TH });
  ok("只读凭证可访问 /api/agent", r.status === 200, String(r.status));

  r = await req("/api/ai/sso/ticket", { method: "POST", headers: TH });
  ok("只读凭证可用于 /api/ai", r.status === 200, String(r.status));

  r = await req("/api/students", { headers: TH });
  ok("只读凭证不能读学生列表（403）", r.status === 403, String(r.status));

  r = await req("/api/finance/orders", { headers: TH });
  ok("只读凭证不能读财务（403）", r.status === 403, String(r.status));

  r = await req("/api/analytics/overview", { headers: TH });
  ok("只读凭证不能读经营分析（403）", r.status === 403, String(r.status));

  r = await req("/api/students", {
    method: "POST",
    headers: { ...TH, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "越权写入测试", class_id: 1 })
  });
  ok("只读凭证不能写学生（403）", r.status === 403, String(r.status));
}

// ── 教师数据范围 ────────────────────────────────────────────────
r = await req(
  "/api/auth/login",
  post({ type: "password", username: "teacher", password: "teacher123456" })
);
const teacherTok = r.body?.data?.accessToken;
ok("teacher 登录成功", !!teacherTok);

if (teacherTok) {
  const TH2 = { Authorization: `Bearer ${teacherTok}` };
  r = await req("/api/agent/context", { headers: TH2 });
  ok("teacher 可用只读网关", r.status === 200, String(r.status));
  const ownClasses = r.body?.data?.classes || [];

  // 找一个不属于该教师的班级尝试访问（若存在）
  r = await req("/api/agent/context", { headers: AH });
  const allClasses = r.body?.data?.classes || [];
  const foreign = allClasses.find(c => !ownClasses.some(o => o.id === c.id));

  if (foreign) {
    r = await req(`/api/agent/classes/${foreign.id}/overview`, { headers: TH2 });
    ok("teacher 访问非本班被拒（403）", r.status === 403, String(r.status));
  } else {
    console.log("  SKIP  teacher 非本班校验（当前无其他班级可比对）");
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
