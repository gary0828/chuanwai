/**
 * 「恒为空字段」探针（内容清点 C4 的运行时佐证）
 *
 * 用途：静态扫代码只能看出"接口有没有这个列"，看不出"这个列在真实数据里是不是恒空"。
 * 本脚本登录后逐个列表接口取数，把**所有行都为空**（null / "" / undefined）的字段列出来，
 * 供内容清点报告引用。
 *
 * 用法：node _verify_test/probe-empty-fields.mjs [API_BASE]
 *
 * ⚠ 诚实边界：本地库是**演示/种子数据**，某字段为空可能只是"没人填过"，
 *   不等于生产数据也恒空。报告里必须带这个前提，不能直接断言"字段没用"。
 */
const API = process.argv[2] || "http://127.0.0.1:18080";

const ENDPOINTS = [
  "/api/students?page=1&pageSize=200",
  "/api/classes?page=1&pageSize=200",
  "/api/courses?page=1&pageSize=200",
  "/api/schedules?page=1&pageSize=200",
  "/api/terms",
  "/api/leaves?page=1&pageSize=200",
  "/api/adjustments?page=1&pageSize=200",
  "/api/makeups?page=1&pageSize=200",
  "/api/exams?page=1&pageSize=200",
  "/api/leads?page=1&pageSize=200",
  "/api/notifications?page=1&pageSize=200",
  "/api/notices?page=1&pageSize=200",
  "/api/todos?page=1&pageSize=200",
  "/api/audit-logs?page=1&pageSize=200",
  "/api/users?page=1&pageSize=200",
  "/api/finance/orders?page=1&pageSize=200",
  "/api/finance/payments?page=1&pageSize=200",
  "/api/finance/refunds?page=1&pageSize=200",
  "/api/attendance/records?page=1&pageSize=200"
];

function rowsOf(body) {
  const d = body?.data;
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.list)) return d.list;
  return [];
}

const isEmpty = v => v === null || v === undefined || v === "";

async function main() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123456" })
  });
  const token = (await r.json())?.data?.accessToken;
  if (!token) {
    console.error("[FATAL] 登录失败");
    process.exit(1);
  }
  const H = { Authorization: `Bearer ${token}` };

  let totalAlwaysEmpty = 0;
  let checked = 0;

  for (const path of ENDPOINTS) {
    let body;
    try {
      const res = await fetch(`${API}${path}`, { headers: H });
      body = await res.json();
    } catch (e) {
      console.log(`\n### ${path}\n  请求失败：${e.message}`);
      continue;
    }
    const rows = rowsOf(body);
    if (!rows.length) {
      console.log(`\n### ${path}\n  （0 行，跳过）`);
      continue;
    }
    checked++;
    // 字段集合取全部行的并集（避免第一行缺字段就漏掉）
    const keys = new Set();
    rows.forEach(row => Object.keys(row || {}).forEach(k => keys.add(k)));
    const alwaysEmpty = [...keys].filter(k => rows.every(row => isEmpty(row[k])));
    totalAlwaysEmpty += alwaysEmpty.length;
    console.log(
      `\n### ${path}  （${rows.length} 行，字段 ${keys.size} 个）` +
        (alwaysEmpty.length ? `\n  ⚠ 恒为空：${alwaysEmpty.join(", ")}` : "\n  ✅ 无恒为空字段")
    );
  }

  console.log(
    `\n======= 共检查 ${checked} 个列表接口，恒为空字段合计 ${totalAlwaysEmpty} 个 =======`
  );
  console.log("注：本地为演示/种子数据，空字段可能只是「没人填过」，不等于生产恒空。");
}

main();
