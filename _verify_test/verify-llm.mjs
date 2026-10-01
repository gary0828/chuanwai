/**
 * 真实模型链路验证：llm-status → generate → 脱敏检查 → 成本核算
 * 运行：node _verify_test/verify-llm.mjs [base]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3000";

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "password",
    username: "admin",
    password: "admin123456"
  })
}).then(r => r.json());

const token = login?.data?.accessToken;
if (!token) {
  console.log("❌ 登录失败，无法继续");
  process.exit(1);
}
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const status = await fetch(`${BASE}/api/ai/llm-status`, { headers: H }).then(r => r.json());
console.log(`模型状态：configured=${status.data.configured} model=${status.data.model}`);

// 载荷故意混入敏感字段，用于验证服务端脱敏
const payload = {
  subject: "数学",
  grade: "八年级",
  textbook: "人教版 · 八年级上册",
  unitName: "第十二章 全等三角形",
  lessonNo: 7,
  lessonTitle: "全等三角形的综合应用",
  lessonDate: "2026-09-15",
  weakKpNames: [
    "截长补短（掌握度 55.2%）",
    "倍长中线（掌握度 61.4%）",
    "到角两边距离相等的点在角平分线上（掌握度 66.1%）"
  ],
  studentCount: 24,
  focusStudentCount: 5,
  // ↓ 以下为敏感字段，服务端必须剔除
  focusStudentNames: ["郑一鸣", "顾泊舟"],
  parentPhone: "13800000000",
  amount: 5800
};

console.log("\n发送载荷含敏感字段：focusStudentNames / parentPhone / amount（用于验证脱敏）\n");

const t0 = Date.now();
const gen = await fetch(`${BASE}/api/ai/generate`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ scene: "lesson_plan", payload })
}).then(r => r.json());
const ms = Date.now() - t0;

if (!gen.success) {
  console.log("❌ 生成失败：", JSON.stringify(gen));
  process.exit(1);
}

const d = gen.data;
const cost =
  (d.usage.prompt_tokens / 1_000_000) * 3.0 +
  (d.usage.completion_tokens / 1_000_000) * 9.0;

console.log("=".repeat(60));
console.log(`模型　　　：${d.model}`);
console.log(`耗时　　　：${ms} ms`);
console.log(`Token 　　：输入 ${d.usage.prompt_tokens} / 输出 ${d.usage.completion_tokens}`);
console.log(`单次成本　：¥${cost.toFixed(4)}（按 Flash 高峰价：输入 3 元、输出 9 元 / 百万 token）`);
console.log(`服务端脱敏：${d.redactedByServer.length ? d.redactedByServer.join("、") : "无"}`);
console.log("=".repeat(60));
console.log("\n========== 模型生成内容 ==========\n");
console.log(d.text);

// 敏感信息泄漏检查
const leaked = [];
for (const name of payload.focusStudentNames) {
  if (d.text.includes(name)) leaked.push(`学生姓名：${name}`);
}
if (d.text.includes("13800000000")) leaked.push("家长手机号");
if (/5800|5,800/.test(d.text)) leaked.push("金额");

console.log("\n========== 泄漏检查 ==========");
console.log(leaked.length === 0 ? "✅ 生成内容中未出现姓名 / 手机号 / 金额" : `❌ 发现泄漏：${leaked.join("、")}`);
