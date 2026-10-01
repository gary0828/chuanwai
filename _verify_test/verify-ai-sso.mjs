/**
 * AI 免登链路专项验证（针对 server/src/routes/ai.js）
 * 运行：node _verify_test/verify-ai-sso.mjs [base]
 * 默认 base = http://127.0.0.1:3100（独立数据目录的测试实例）
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
  return { status: res.status, body };
}

const json = body => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

console.log(`\n=== AI 免登链路验证 @ ${BASE} ===\n`);

let r = await req("/api/health");
ok("健康检查返回 200", r.status === 200, String(r.status));

r = await req(
  "/api/auth/login",
  json({ type: "password", username: "admin", password: "admin123456" })
);
const token = r.body?.data?.accessToken;
ok("管理员登录成功", r.status === 200 && !!token, JSON.stringify(r.body).slice(0, 160));
if (!token) {
  console.log("\n无法登录，后续用例跳过。");
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(1);
}

r = await req("/api/ai/sso/ticket", { method: "POST" });
ok("未登录取票据被拒（401）", r.status === 401, String(r.status));

r = await req("/api/ai/sso/ticket", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` }
});
const { ticket, url, expiresIn } = r.body?.data || {};
ok("登录后可取票据", r.status === 200 && !!ticket, JSON.stringify(r.body).slice(0, 160));
ok("票据有效期 60 秒", expiresIn === 60, String(expiresIn));
ok(
  "跳转地址把票据放在 hash 中",
  typeof url === "string" && url.includes("#/sso?ticket=")
);
ok("跳转地址不含姓名等身份信息", typeof url === "string" && !/[李王张陈刘赵周吴]/.test(url));

const claims = ticket
  ? JSON.parse(Buffer.from(ticket.split(".")[1], "base64url").toString("utf8"))
  : {};
ok("票据类型为 ai_sso", claims.type === "ai_sso", String(claims.type));
ok("票据携带 token_version（可吊销）", typeof claims.tv === "number");
ok("票据含一次性标识 jti", typeof claims.jti === "string" && claims.jti.length > 10);
ok("票据不含姓名 / 电话 / 金额字段", !("name" in claims) && !("phone" in claims));

r = await req("/api/ai/sso/verify", json({ ticket }));
ok("票据换会话成功", r.status === 200 && !!r.body?.data?.id, JSON.stringify(r.body).slice(0, 160));
ok("返回姓名与角色", typeof r.body?.data?.name === "string" && r.body?.data?.role === "admin");
ok("按角色返回数据范围 scope", r.body?.data?.scope === "all");

r = await req("/api/ai/sso/verify", json({ ticket }));
ok("同一票据不可重放（401）", r.status === 401, String(r.status));

const forged = ticket.slice(0, -4) + "abcd";
r = await req("/api/ai/sso/verify", json({ ticket: forged }));
ok("签名被篡改的票据被拒（401）", r.status === 401, String(r.status));

r = await req("/api/ai/sso/verify", json({}));
ok("缺少票据返回 400", r.status === 400, String(r.status));

r = await req("/api/ai/sso/verify", json({ ticket: "not-a-jwt" }));
ok("非 JWT 字符串被拒（401）", r.status === 401, String(r.status));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
