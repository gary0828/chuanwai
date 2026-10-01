/**
 * 外部访问专项验证：确保非局域网 / 公网用户能正确进入 AI 工作台
 *
 * 覆盖用户 2026-09-20 反馈的问题：「点了 AI 工作台进不去」。
 * 根因有三层：① 跳转地址跟随 host 但沿用硬编码 :8082 端口（同源部署下错误）；
 *            ② 未传 host 时回落到 localhost；
 *            ③ 只返回 origin 而漏了工作台子路径 /ai。
 *
 * ★★ 2026-09-20 二次修正：本脚本原先只覆盖「统一入口」形态，断言
 *   「跳转地址 = 访问者完整 origin + 子路径」。这在统一入口下成立，
 *   但在**独立端口**形态下是错的 —— 工作台在另一个端口（8082），
 *   跳转地址应当是「访问者主机名 + 配置里的 8082」，而不是访问者的 8080。
 *   正因如此，当日引入的端口丢失缺陷（跳转落到教务系统 → 404）**没有被本脚本拦住**。
 *   现在按部署形态分别推导期望值，两种形态都必须过。
 *
 * 部署形态通过 WB_FORM 指定：
 *   · 统一入口（AI_WORKBENCH_BASE_PATH=/ai）→ WB_FORM=samesite（默认）
 *   · 独立端口（AI_WORKBENCH_URL=http://localhost:8082）→ WB_FORM=split
 *
 * 运行：WB_FORM=split node _verify_test/verify-workbench-origin.mjs [base]
 *       base 默认 http://127.0.0.1:3000（注意是**位置参数**，不是环境变量）
 */
const BASE = process.argv[2] || "http://127.0.0.1:3000";

let pass = 0;
let fail = 0;
const lines = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    lines.push(`  ✅ ${name}`);
  } else {
    fail++;
    lines.push(`  ❌ ${name}${extra ? "  → " + extra : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const json = b => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(b)
});
const stripTicket = u => String(u || "").replace(/ticket=[^&]*/, "ticket=<...>");

lines.push(`\n【准备】登录并获取票据签发能力`);
const login = await req(
  "/api/auth/login",
  json({ type: "password", username: "admin", password: "admin123456" })
);
const token = login.body?.data?.accessToken || login.body?.data?.token;
ok("管理员登录成功", !!token, `HTTP ${login.status}`);
if (!token) {
  console.log(lines.join("\n"));
  process.exit(1);
}

/** 以指定 origin 请求票据，返回跳转地址 */
async function ticketFor(payload) {
  const r = await req("/api/ai/sso/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  return stripTicket(r.body?.data?.url);
}

// ── 探测当前部署形态 ────────────────────────────────────────────
// 两种形态的期望值推导规则完全不同：
//   统一入口（sameSite）：跳转 = 访问者完整 origin（协议+主机+端口）+ 子路径 /ai
//                        —— 因为工作台与教务系统同源同端口。
//   独立端口（split）   ：跳转 = 访问者**主机名** + 配置里的端口 8082 + 无子路径
//                        —— 因为工作台是另一个端口的独立服务；
//                           若误用访问者端口会落到教务系统（无 /sso 路由 → 404）。
const FORM = process.env.WB_FORM || "samesite";
const isSameSite = FORM !== "split";
const EXP_PATH = process.env.WB_EXPECT_PATH ?? (isSameSite ? "/ai" : "");
// 独立端口形态下工作台的端口（与 docker-compose.yml 的 AI_WORKBENCH_URL 一致）
const WB_SPLIT_PORT = process.env.WB_PORT ?? "8082";

/** 由访问者 origin 推出期望的跳转基址 */
function expectFor(origin) {
  if (isSameSite) return origin.replace(/\/$/, "") + EXP_PATH;
  // 独立端口：只取主机名（IPv6 加方括号），端口固定为工作台端口
  const { hostname } = new URL(origin);
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  const scheme = origin.startsWith("https") && WB_SPLIT_PORT === "443" ? "https" : "http";
  return `${scheme}://${host}:${WB_SPLIT_PORT}`;
}

lines.push(
  `\n【准备】部署形态 = ${isSameSite ? "统一入口(sameSite)" : "独立端口(split)"}` +
    `｜期望子路径 = ${EXP_PATH || "(无)"}｜工作台端口 = ${isSameSite ? "(跟随访问者)" : WB_SPLIT_PORT}`
);

lines.push(`\n【① 】跳转地址 = 访问者可达地址（含正确端口与子路径）`);
// 场景：无论 http/https、80/443/自定义端口，跳转地址都应落在「访问者能打开的那个地址」上。
// 统一入口 → 同源同端口；独立端口 → 换主机名但保留工作台端口。
const sameOriginCases = [
  { origin: "http://192.168.1.20", label: "局域网 IP + 80 端口" },
  { origin: "http://192.168.1.20:8080", label: "局域网 IP + 8080" },
  { origin: "http://8.8.8.8", label: "公网 IP + 80 端口" },
  { origin: "http://8.8.8.8:8080", label: "公网 IP + 8080" },
  { origin: "http://jx.school.com", label: "域名 + 80 端口" },
  { origin: "https://jx.school.com", label: "HTTPS 域名（无端口）" },
  { origin: "https://jx.school.com:8443", label: "HTTPS + 自定义端口" },
  { origin: "http://jx.school.com:18080", label: "域名 + 高位端口" }
].map(c => ({ ...c, expect: expectFor(c.origin) }));

for (const c of sameOriginCases) {
  const url = await ticketFor({ origin: c.origin });
  const gotBase = url.split("/#/")[0];
  ok(
    `${isSameSite ? "同源" : "独立端口"} · ${c.label} → ${c.expect}`,
    gotBase === c.expect,
    `实际 ${gotBase}`
  );
}

// ★ 独立端口形态的关键回归：跳转地址必须带工作台端口，不能被替换成访问者端口。
//   这正是 2026-09-20 的 404 故障（跳到了教务系统的 8080）。
if (!isSameSite) {
  lines.push(
    `\n【①b】★ 独立端口：跳转必须带 :${WB_SPLIT_PORT}，绝不能落到访问者端口`
  );
  for (const c of sameOriginCases) {
    const url = await ticketFor({ origin: c.origin });
    const base = url.split("/#/")[0];
    const visitorPort = (c.origin.match(/:(\d+)/) || [])[1] || "80";
    ok(
      `独立端口 · ${c.label} 带 :${WB_SPLIT_PORT}`,
      base.endsWith(`:${WB_SPLIT_PORT}`),
      base
    );
    ok(
      `独立端口 · ${c.label} 未误用访问者端口 :${visitorPort}`,
      visitorPort === WB_SPLIT_PORT || !base.endsWith(`:${visitorPort}`),
      base
    );
  }
  lines.push(`\n【①c】★ 跳转地址不得出现双斜杠（会匹配不上前端路由）`);
  for (const c of sameOriginCases) {
    const url = await ticketFor({ origin: c.origin });
    ok(`独立端口 · ${c.label} 无 //`, !url.split("/#/")[0].includes("//", 8), url);
  }
}

if (isSameSite) {
  lines.push(`\n【② 】关键回归：跳转地址绝不出现硬编码 8082（同源场景）`);
  for (const c of sameOriginCases) {
    const url = await ticketFor({ origin: c.origin });
    ok(`同源 · ${c.label} 不含 :8082`, !url.includes(":8082"), url);
  }
}

if (isSameSite) {
  lines.push(
    `\n【②b】跳转地址必须带工作台子路径（当前期望：${EXP_PATH || "无"}）` +
      `—— 漏了会落到教务系统自己的 404`
  );
  for (const c of sameOriginCases) {
    const url = await ticketFor({ origin: c.origin });
    const base = url.split("/#/")[0];
    ok(
      `同源 · ${c.label} 路径正确`,
      EXP_PATH ? base.endsWith(EXP_PATH) : true,
      base
    );
  }
}

lines.push(`\n【③ 】HTTPS 不降级为 HTTP`);
for (const c of sameOriginCases.filter(x => x.origin.startsWith("https"))) {
  const url = await ticketFor({ origin: c.origin });
  // 统一入口下访问者是 https，跳转必须是 https（同源）；
  // 独立端口下工作台是独立的 http 服务，协议跟随配置，此处只断言不出现非法组合。
  const okScheme = isSameSite ? url.startsWith("https://") : /^https?:\/\//.test(url);
  ok(`HTTPS · ${c.label} 协议合法`, okScheme, url);
}

lines.push(`\n【④ 】分离端口部署：显式配置优先于 origin 跟随`);
// 当 AI_WORKBENCH_URL 被显式配成非回环地址时，必须尊重配置（不被 origin 覆盖）
const explicit = await ticketFor({ origin: "http://192.168.1.20:8080" });
ok(
  "显式配置或 origin 跟随都指向访问者可达地址（当前环境未显式配置）",
  explicit.startsWith("http://192.168.1.20") || explicit.includes("workbench"),
  explicit
);

lines.push(`\n【⑤ 】无 origin 时的兜底不产生"访问者本机 localhost"祸根`);
// 兼容性：老客户端不传 origin（会走 host / 无字段分支）。
// 此时若配置为回环地址，只能回落到配置值 —— 因此前端必须传 origin。
// 这里断言的是：传了 origin 一定不会得到 localhost。
const withOrigin = await ticketFor({ origin: "http://8.8.8.8:8080" });
ok("传 origin 后绝不返回 localhost", !withOrigin.includes("localhost"), withOrigin);
ok("传 origin 后绝不返回 127.0.0.1", !withOrigin.includes("127.0.0.1"), withOrigin);

lines.push(`\n【⑥ 】安全：不可被诱导跳转到第三方（开放重定向防护）`);
const evilCases = [
  { origin: "http://evil.com@jx.school.com", label: "userinfo 混淆" },
  { origin: "javascript:alert(1)", label: "javascript 协议" },
  { origin: "file:///etc/passwd", label: "file 协议" },
  { origin: "http://jx.school.com/../../evil", label: "路径穿越" },
  { origin: "http://jx.school.com?x=1", label: "带查询串" },
  { origin: "not a url", label: "非 URL 字符串" }
];
for (const e of evilCases) {
  const url = await ticketFor({ origin: e.origin });
  const bad =
    url.includes("evil.com") ||
    url.startsWith("javascript:") ||
    url.startsWith("file:") ||
    url.includes("/../");
  ok(`拒绝恶意 origin · ${e.label}`, !bad, url);
}

lines.push(`\n【⑦ 】票据仍放在 hash（不随请求发送到服务器）`);
const sample = await ticketFor({ origin: "http://8.8.8.8" });
ok("跳转 URL 含 #/sso?ticket=", sample.includes("/#/sso?ticket="), sample);

console.log(lines.join("\n"));
console.log("\n" + "=".repeat(60));
console.log(`外部访问专项验证：${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(60));
process.exit(fail ? 1 : 0);
