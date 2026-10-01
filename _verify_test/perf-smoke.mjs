// 性能与容量冒烟（一次性脚本，位于 .gitignore 忽略的 _verify_test/）
// 用法：node _verify_test/perf-smoke.mjs [baseUrl]
const BASE = process.argv[2] || "http://localhost:3000";

async function req(method, url, { token, body } = {}) {
  const t0 = performance.now();
  const r = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  const ms = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, ms, bytes: Buffer.byteLength(text) };
}

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const at = p => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { min: s[0], p50: at(0.5), p95: at(0.95), max: s[s.length - 1], n: s.length };
}
const f = n => `${n.toFixed(0)}ms`;

const tk = (await req("POST", "/api/auth/login", { body: { type: "password", username: "admin", password: "admin123456" } })).json.data.accessToken;

console.log(`\n${"═".repeat(70)}\n性能与容量冒烟　目标：${BASE}\n${"═".repeat(70)}`);

// ── 1. 读接口响应时间（每项 20 次，含 P95）──────────────────────────
console.log("\n[1] 读接口响应时间（预热 3 次 + 采样 20 次）");
const GETS = [
  ["学生列表(分页10)", "/api/students?page=1&pageSize=10", 300],
  ["学生列表(分页100)", "/api/students?page=1&pageSize=100", 500],
  ["班级列表", "/api/classes?page=1&pageSize=10", 300],
  ["订单列表(分页10)", "/api/finance/orders?page=1&pageSize=10", 400],
  ["考勤记录(分页10)", "/api/attendance/records?page=1&pageSize=10", 400],
  ["考勤统计", "/api/attendance/statistics?dimension=class", 600],
  ["缺勤预警", "/api/attendance/warnings", 600],
  ["首页概览", "/api/dashboard/overview", 600],
  ["课消统计(学生维度)", "/api/finance/stats/consumption?dimension=student&page=1&pageSize=100", 600],
  ["经营报表(重查询)", "/api/finance/stats/business", 1500],
  ["AI 指标概览", "/api/analytics/overview", 1500],
  ["审计日志", "/api/audit-logs?page=1&pageSize=10", 400]
];
const slow = [];
for (const [label, url, budget] of GETS) {
  for (let i = 0; i < 3; i++) await req("GET", url, { token: tk });
  const times = [];
  let bytes = 0;
  for (let i = 0; i < 20; i++) {
    const r = await req("GET", url, { token: tk });
    times.push(r.ms);
    bytes = r.bytes;
    if (r.status !== 200) console.log(`    ⚠️ ${label} 返回 ${r.status}`);
  }
  const s = stats(times);
  const flag = s.p95 > budget ? "⚠️ 超预算" : "✅";
  console.log(`  ${flag} ${label.padEnd(22)} P50=${f(s.p50).padStart(7)} P95=${f(s.p95).padStart(7)} max=${f(s.max).padStart(7)} 响应=${(bytes / 1024).toFixed(1)}KB (预算 P95<${budget}ms)`);
  if (s.p95 > budget) slow.push(`${label} P95=${f(s.p95)} > ${budget}ms`);
}

// ── 2. 写接口响应时间 ─────────────────────────────────────────────
console.log("\n[2] 写接口响应时间（各 10 次，用无效/幂等入参避免污染数据）");
const cls = (await req("GET", "/api/classes/all", { token: tk })).json.data;
const crs = (await req("GET", "/api/courses/all", { token: tk })).json.data;
const classId = cls[0].id, courseId = crs[0].id;
const WRITES = [
  ["考勤批量(1人 upsert)", "POST", "/api/attendance/batch", { date: "2026-01-01", course_id: courseId, records: [{ student_id: 1, status: "正常" }] }, 800],
  ["参数校验拒绝(400)", "POST", "/api/students", {}, 200],
  ["订单校验拒绝(400)", "POST", "/api/finance/orders", { student_id: 999999, amount: 1 }, 300]
];
for (const [label, m, url, body, budget] of WRITES) {
  const times = [];
  for (let i = 0; i < 10; i++) {
    const r = await req(m, url, { token: tk, body });
    times.push(r.ms);
  }
  const s = stats(times);
  const flag = s.p95 > budget ? "⚠️ 超预算" : "✅";
  console.log(`  ${flag} ${label.padEnd(22)} P50=${f(s.p50).padStart(7)} P95=${f(s.p95).padStart(7)} (预算 P95<${budget}ms)`);
  if (s.p95 > budget) slow.push(`${label} P95=${f(s.p95)} > ${budget}ms`);
}

// ── 3. 批量考勤：真实班级规模 ─────────────────────────────────────
console.log("\n[3] 批量考勤容量（真实班级规模）");
const roster = await req("GET", `/api/classes/${classId}/students?page=1&pageSize=200`, { token: tk });
const students = (roster.json?.data?.students || []).map(s => s.id).filter(Boolean);
if (students.length) {
  const recs = students.map(id => ({ student_id: id, status: "正常" }));
  const t0 = performance.now();
  const r = await req("POST", "/api/attendance/batch", { token: tk, body: { date: "2026-01-02", course_id: courseId, records: recs } });
  const ms = performance.now() - t0;
  console.log(`  班级人数=${students.length} → HTTP ${r.status}，耗时 ${f(ms)}（${(ms / students.length).toFixed(1)}ms/人）`);
  console.log(`  提示：该实现为每人 8~10 次查询的 O(N) 写法，人数增长时耗时线性上升`);
} else {
  console.log("  ⚠️ 未取到班级名册，跳过");
}

// ── 4. Excel 导入容量（200 行，测后清理）────────────────────────────
console.log("\n[4] 批量导入容量（200 行，测后清理）");
const sfx = String(Date.now()).slice(-6);
const records = Array.from({ length: 200 }, (_, i) => ({
  student_no: `PERF${sfx}${String(i).padStart(3, "0")}`,
  name: `压测学员${i}`,
  class_id: classId,
  gender: i % 2 ? "女" : "男"
}));
const t0 = performance.now();
const imp = await req("POST", "/api/students/import", { token: tk, body: { records } });
const impMs = performance.now() - t0;
console.log(`  200 行导入 → HTTP ${imp.status}，耗时 ${f(impMs)} 成功=${imp.json?.data?.successCount ?? "?"} 失败=${imp.json?.data?.failCount ?? "?"}`);
console.log(`  吞吐 ≈ ${(200 / (impMs / 1000)).toFixed(0)} 行/秒（每行一个独立事务 + 一次权限查询）`);

// 清理导入数据
const t1 = performance.now();
let cleaned = 0;
for (let page = 0; page < 5; page++) {
  const lst = await req("GET", `/api/students?keyword=压测学员&page=1&pageSize=200`, { token: tk });
  const rows = (lst.json?.data?.list || []);
  if (!rows.length) break;
  for (const row of rows) {
    const d = await req("DELETE", `/api/students/${row.id}`, { token: tk });
    if (d.status === 200) cleaned++;
  }
  if (rows.length < 200) break;
}
console.log(`  已清理压测学员 ${cleaned} 条，耗时 ${f(performance.now() - t1)}`);

// ── 5. 导出与大数据响应体 ────────────────────────────────────────
console.log("\n[5] 导出接口（大数据响应体）");
for (const [label, url] of [
  ["学生全量导出", "/api/students/export"],
  ["考勤导出(JSON)", "/api/analytics/attendance/export"],
  ["考勤导出(CSV)", "/api/analytics/attendance/export?format=csv"]
]) {
  const r = await req("GET", url, { token: tk });
  console.log(`  ${r.status === 200 ? "✅" : "⚠️"} ${label.padEnd(18)} HTTP ${r.status} 耗时 ${f(r.ms)} 响应体 ${(r.bytes / 1024).toFixed(1)}KB`);
}

// ── 汇总 ─────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
if (slow.length === 0) {
  console.log("✅ 全部接口均在预算内");
} else {
  console.log(`⚠️ ${slow.length} 项超出预算：`);
  slow.forEach(s => console.log(`   · ${s}`));
}
console.log(`${"═".repeat(70)}\n`);
