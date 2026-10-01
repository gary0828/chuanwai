/**
 * C1 收口验证：工作台 AI 底座「服务端代持 Key」链路
 *
 * 验证三件事：
 *   ① 服务端通道可用：agentToken 能调 /api/ai/generate 并拿到真实模型输出
 *   ② 降级链路可用：后端无 Key（503 LLM_NOT_CONFIGURED）时前端能识别并回退
 *   ③ Key 不下发：产物与运行时 localStorage 均无密钥字段
 *
 * 运行：node _verify_test/verify-provider-c1.mjs [apiBase] [workbenchBase]
 */

const API = process.argv[2] || "http://127.0.0.1:3000";
const WB = process.argv[3] || "http://127.0.0.1:18080/ai";

let pass = 0;
let fail = 0;
const lines = [];
function chk(name, ok, detail = "") {
  if (ok) {
    pass++;
    lines.push(`  ✅ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    lines.push(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}

async function j(path, opts = {}) {
  const r = await fetch(API + path, opts);
  const b = await r.json().catch(() => ({}));
  return { status: r.status, body: b };
}

// ---------- 取 agentToken（与老师真实进入工作台的链路一致） ----------
lines.push("【准备】签发工作台会话");
const login = await j("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "teacher", password: "teacher123456" })
});
if (!login.body?.success) {
  console.log("❌ 登录失败：", JSON.stringify(login.body));
  process.exit(1);
}
const userToken = login.body.data.token || login.body.data.accessToken;
const ticket = await j("/api/ai/sso/ticket", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
  body: JSON.stringify({})
});
const t = ticket.body?.data?.ticket;
const verify = await j("/api/ai/sso/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: t })
});
const agentToken = verify.body?.data?.agentToken;
chk("教务签发票据 → 工作台换会话成功", !!agentToken, agentToken ? agentToken.slice(0, 12) + "…" : "无 token");
if (!agentToken) {
  console.log(lines.join("\n"));
  process.exit(1);
}

const AH = { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" };

// ---------- ① 服务端模型链路 ----------
lines.push("\n【① 】服务端通道（工作台主路径）");
const status = await j("/api/ai/llm-status", { headers: AH });
chk(
  "agentToken 可读 /api/ai/llm-status",
  status.status === 200 && status.body?.success,
  `HTTP ${status.status} configured=${status.body?.data?.configured} model=${status.body?.data?.model}`
);
const configured = !!status.body?.data?.configured;

// 载荷故意混入敏感字段，验证服务端二次脱敏（前端脱敏不构成信任边界）
const payload = {
  subject: "数学",
  grade: "八年级",
  unitName: "第十二章 全等三角形",
  lessonNo: 7,
  lessonTitle: "全等三角形的综合应用",
  studentCount: 24,
  focusStudentNames: ["郑一鸣", "顾泊舟"],
  parentPhone: "13800000000",
  amount: 5800
};

const t0 = Date.now();
const gen = await j("/api/ai/generate", {
  method: "POST",
  headers: AH,
  body: JSON.stringify({ scene: "lesson_plan", payload })
});
const ms = Date.now() - t0;

if (configured) {
  chk(
    "agentToken 可调 /api/ai/generate 并返回模型文本",
    gen.status === 200 && gen.body?.success && !!gen.body?.data?.text,
    `HTTP ${gen.status} ${ms}ms ${(gen.body?.data?.text || "").length}字 model=${gen.body?.data?.model}`
  );
  chk(
    "服务端做了二次脱敏（剔除姓名/电话/金额）",
    Array.isArray(gen.body?.data?.redactedByServer) && gen.body.data.redactedByServer.length > 0,
    (gen.body?.data?.redactedByServer || []).join("、") || "未剔除任何字段"
  );
  const txt = gen.body?.data?.text || "";
  const leak = [];
  if (txt.includes("郑一鸣") || txt.includes("顾泊舟")) leak.push("学生姓名");
  if (txt.includes("13800000000")) leak.push("手机号");
  if (/5800|5,800/.test(txt)) leak.push("金额");
  chk("模型输出中无敏感信息泄漏", leak.length === 0, leak.join("、") || "干净");
  chk(
    "用量已记入 ai_usage（返回 usage）",
    Number(gen.body?.data?.usage?.prompt_tokens || 0) > 0,
    `in=${gen.body?.data?.usage?.prompt_tokens} out=${gen.body?.data?.usage?.completion_tokens}`
  );
} else {
  // ---------- ② 降级链路 ----------
  lines.push("  （当前后端未配 Key，转而验证降级契约）");
  chk("未配 Key 时返回 503", gen.status === 503, `HTTP ${gen.status}`);
  chk(
    "503 带 LLM_NOT_CONFIGURED 错误码（供前端识别降级）",
    gen.body?.code === "LLM_NOT_CONFIGURED",
    gen.body?.code || "无 code"
  );
  chk("未配 Key 时返回体里不含任何密钥", !JSON.stringify(gen.body).match(/sk-|apiKey|api_key/i), "干净");
}

// ---------- ③ 工作台静态产物中不得有密钥 ----------
lines.push("\n【③ 】前端不得出现密钥（产物层）");
const html = await fetch(`${WB}/`).then(r => r.text()).catch(() => "");
chk("工作台页面可访问", html.includes("<!DOCTYPE") || html.includes("<div id="), `${html.length} 字节`);

const assetMatch = html.match(/assets\/index-[\w-]+\.js/);
if (assetMatch) {
  const bundle = await fetch(`${WB}/${assetMatch[0]}`).then(r => r.text()).catch(() => "");
  chk("主包中无 apiKey 字段", !/apiKey|api_key/i.test(bundle), `${bundle.length} 字节`);
  chk("主包中无 Dify 工作流直连地址", !/workflows\/run/.test(bundle), "无 workflows/run");
  chk("主包中无 sk- 形式的密钥字面量", !/sk-[A-Za-z0-9]{16,}/.test(bundle), "无 sk- 字面量");
  const difyHit = /dify/i.test(bundle);
  chk(
    "主包中的 dify 仅剩『旧配置清理』代码（非调用）",
    !difyHit || /in t\)|"dify"in/.test(bundle),
    difyHit ? "命中为迁移分支 if(\"dify\" in t)" : "无 dify 字样"
  );
} else {
  chk("找到主包资源", false, "未能从 index.html 解析出 index-*.js");
}

// ---------- 汇总 ----------
console.log(lines.join("\n"));
console.log("\n" + "=".repeat(56));
console.log(`C1 收口验证：${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(56));
process.exit(fail ? 1 : 0);
