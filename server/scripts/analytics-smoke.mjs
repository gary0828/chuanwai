// analytics 端点冒烟测试：登录 → metrics / overview / 各 dataset 导出（json+csv）→ 权限校验
const BASE = process.env.BASE || "http://localhost:3000";

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, type: "password" })
  });
  const j = await r.json();
  const token = j?.data?.accessToken || j?.accessToken;
  if (!token) throw new Error("登录失败: " + JSON.stringify(j).slice(0, 300));
  return token;
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`[PASS] ${name} ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} ${detail}`); }
}

async function get(path, token, raw = false) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (raw) {
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(buf);
    return { status: r.status, text, bytes: buf, ct: r.headers.get("content-type") };
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  return { status: r.status, json: j };
}

(async () => {
  const admin = await login("admin", "admin123456");
  const teacher = await login("teacher", "teacher123456");
  console.log("== 登录完成 ==");

  // 1. metrics
  let r = await get("/api/analytics/metrics", admin);
  check("A1 metrics 200", r.status === 200, `status=${r.status}`);
  check(
    "A2 metrics 含指标字典",
    !!r.json?.metric_definitions?.attendance_rate?.formula,
    `count=${Object.keys(r.json?.metric_definitions || {}).length}`
  );
  check("A3 metrics 含 data_version", /^v\d+$/.test(r.json?.data?.meta?.data_version || ""), r.json?.data?.meta?.data_version);

  // 2. overview
  r = await get("/api/analytics/overview", admin);
  check("A4 overview 200", r.status === 200, `status=${r.status}`);
  const m = r.json?.data?.metrics || {};
  check("A5 overview 含核心指标", ["student_total", "attendance_rate", "revenue_total", "lead_conversion_rate"].every(k => k in m), Object.keys(m).length + " 个指标");
  check("A6 overview 含营收趋势", Array.isArray(r.json?.data?.meta?.revenue_trend), `trend=${r.json?.data?.meta?.revenue_trend?.length}`);
  check("A7 overview 含渠道统计", Array.isArray(r.json?.data?.meta?.channel_stats), `channels=${r.json?.data?.meta?.channel_stats?.length}`);
  console.log("   metrics 快照:", JSON.stringify(m).slice(0, 400));

  // 3. 四个导出（json）
  for (const ds of ["attendance", "finance", "leads", "scores"]) {
    const rr = await get(`/api/analytics/${ds}/export`, admin);
    check(`A8.${ds} export json 200`, rr.status === 200, `status=${rr.status}`);
    check(`A8.${ds} export 信封完整`, !!rr.json?.data?.meta && Array.isArray(rr.json?.data?.records), `records=${rr.json?.data?.records?.length}`);
  }

  // 4. CSV 导出
  r = await get("/api/analytics/attendance/export?format=csv", admin, true);
  check("A9 CSV 200 + text/csv", r.status === 200 && /text\/csv/.test(r.ct || ""), `ct=${r.ct}`);
  check("A10 CSV 带 UTF-8 BOM", r.bytes[0] === 0xef && r.bytes[1] === 0xbb && r.bytes[2] === 0xbf, `bytes=${r.bytes[0]},${r.bytes[1]},${r.bytes[2]}`);
  check("A11 CSV 含表头", r.text.includes("student_name") && r.text.includes("status"), "");

  // 5. 日期过滤
  r = await get("/api/analytics/overview?start=2020-01-01&end=2020-01-31", admin);
  check("A12 overview 支持日期过滤", r.status === 200 && r.json?.data?.meta?.period?.start === "2020-01-01", JSON.stringify(r.json?.data?.meta?.period));

  // 6. 权限：teacher 403，未登录 401
  r = await get("/api/analytics/overview", teacher);
  check("A13 teacher 访问被拒 403", r.status === 403, `status=${r.status}`);
  r = await get("/api/analytics/metrics", null);
  check("A14 未登录 401", r.status === 401, `status=${r.status}`);

  // 7. 未知数据集 404
  r = await get("/api/analytics/unknown/export", admin);
  check("A15 未知数据集 404", r.status === 404, `status=${r.status}`);

  console.log(`\n==== analytics 汇总: PASS ${pass} / ${pass + fail} ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
