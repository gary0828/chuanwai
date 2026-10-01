// L3 待办自动生成验证：4 类事件是否生成 + ★ 归属/权限是否符合矩阵
// 用法：node _verify_test/verify-todo-generator.mjs [API]
const API = process.argv[2] || "http://127.0.0.1:3000";

const PASS = [];
const FAIL = [];
function ok(name, cond, extra = "") {
  (cond ? PASS : FAIL).push(name);
  console.log((cond ? "[OK]   " : "[FAIL] ") + name + (extra ? `  -- ${extra}` : ""));
  return cond;
}

async function login(u, p) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p })
  });
  const j = await r.json();
  if (!j?.data?.accessToken) throw new Error(`登录失败 ${u}`);
  return j.data;
}
const H = t => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const get = (p, t) => fetch(`${API}${p}`, { headers: H(t) }).then(r => r.json().then(b => ({ s: r.status, b })));
const del = (p, t) => fetch(`${API}${p}`, { method: "DELETE", headers: H(t) }).then(r => r.json().then(b => ({ s: r.status, b })));

const admin = await login("admin", "admin123456");
const teacher = await login("teacher", "teacher123456");

const users = (await get("/api/users?pageSize=100", admin.accessToken)).b.data.list;
const adminId = users.find(u => u.username === "admin").id;
const teacherId = users.find(u => u.username === "teacher").id;
console.log(`[info] admin=${adminId} teacher=${teacherId}\n`);

// ── 1. 手动触发（force 跳过节流）────────────────────────────────
const gen = await fetch(`${API}/api/todos/generate?force=1`, { method: "POST", headers: H(admin.accessToken) })
  .then(r => r.json());
ok("POST /api/todos/generate 可用（仅 admin）", gen.success === true, JSON.stringify(gen.data));
const g = gen.data || {};
console.log(`[info] 候选 ${g.candidates} · 新增 ${g.created} · 重开 ${g.reopened} · 跳过 ${g.skipped}`);

// ── 2. 全部自动待办（admin 视角）────────────────────────────────
const all = (await get("/api/todos?scope=all&pageSize=300", admin.accessToken)).b.data.list;
const autos = all.filter(t => t.source === "auto");
const byType = {};
for (const t of autos) (byType[t.source_type] ||= []).push(t);
console.log("[info] 各类型分布: " + Object.entries(byType).map(([k, v]) => `${k}=${v.length}`).join(" · "));

// ★ 每一类都必须真的出现了（否则前面对话白定）
for (const [label, key] of [
  ["余额/课时不足", "tuition_low"],
  ["线索待跟进", "lead_follow"],
  ["连续缺勤", "absent_streak"],
  ["课评欠录", "eval_missing"]
]) {
  ok(`★ 生成出了「${label}」类待办`, (byType[key] || []).length > 0, `${key}=${(byType[key] || []).length}`);
}

// ── 3. ★★ 归属矩阵（本次核心）────────────────────────────────
const ownersOf = t => t.owner_id ?? t.ownerId;
for (const t of autos) {
  t.__owner = ownersOf(t);
}
const ownerSet = key => new Set((byType[key] || []).map(t => t.__owner));

// 财务 / 线索类：**只能** admin
for (const key of ["tuition_low", "lead_follow"]) {
  const s = ownerSet(key);
  ok(
    `★★ 「${key}」只发给 admin（老师绝不可见）`,
    s.size > 0 && [...s].every(id => id === adminId),
    `owner=${[...s]}`
  );
}

// 班级类：必须含班主任 + admin
for (const key of ["absent_streak", "eval_missing"]) {
  const s = ownerSet(key);
  ok(
    `★ 「${key}」发给 班主任(${teacherId}) + admin(${adminId})`,
    s.has(teacherId) && s.has(adminId),
    `owner=${[...s]}`
  );
}

// ── 4. ★★ 老师实际看不到财务/线索类 ──────────────────────────
const tView = (await get("/api/todos?scope=all&pageSize=300", teacher.accessToken)).b.data.list;
const tTypes = new Set(tView.map(t => t.source_type).filter(Boolean));
console.log("[info] 老师可见的自动类型: " + [...tTypes].join(", "));
ok("★★ 老师看不到「余额/课时不足」（财务）", !tTypes.has("tuition_low"));
ok("★★ 老师看不到「线索待跟进」（招生）", !tTypes.has("lead_follow"));
ok("   老师能看到本班的「连续缺勤」/「课评欠录」", tTypes.has("absent_streak") || tTypes.has("eval_missing"),
   [...tTypes].join(","));

// 老师的可见项全是自己的（★ 注意：tView 是另一次请求返回的对象，需重新取 owner 字段，
//   不能复用上面给 autos 计算过的 __owner —— 那是测试脚本自己的坑）
ok("★ 老师见到的待办 owner 全是自己", tView.every(t => ownersOf(t) === teacherId), `共 ${tView.length} 条`);

// ── 5. 幂等：再跑一次不重复插入 ──────────────────────────────
const before = autos.length;
const gen2 = await fetch(`${API}/api/todos/generate?force=1`, { method: "POST", headers: H(admin.accessToken) }).then(r => r.json());
const after = (await get("/api/todos?scope=all&pageSize=300", admin.accessToken)).b.data.list.filter(t => t.source === "auto").length;
ok("★ 幂等：重复触发不新增（一条来源=一条待办）", after === before && (gen2.data?.created ?? 0) === 0,
   `前=${before} 后=${after} created=${gen2.data?.created}`);

// ── 6. 正文脱敏：不得出现金额 / 电话 ─────────────────────────
const phoneRe = /1[3-9]\d{9}/;
const moneyRe = /[¥￥]\s?\d|\d+(\.\d+)?\s*元/;
const tainted = autos.filter(t => phoneRe.test(t.title + t.content) || moneyRe.test(t.title + t.content));
ok("★★ 自动待办正文不含电话 / 金额（脱敏）", tainted.length === 0,
   tainted.length ? JSON.stringify(tainted.slice(0, 2).map(t => t.title)) : "无");

// ── 7. 清理（删除本次全部自动待办，恢复干净）───────────────
let n = 0;
for (const t of autos) {
  if ((await del(`/api/todos/${t.id}`, admin.accessToken)).s === 200) n++;
}
const left = (await get("/api/todos?scope=all&pageSize=300", admin.accessToken)).b.data.list.filter(t => t.source === "auto");
console.log(`\n[info] 已清理 ${n}/${autos.length} 条自动待办；残留 ${left.length} 条`);

console.log("\n" + "=".repeat(58));
console.log(`  L3 生成器验证：${PASS.length}/${PASS.length + FAIL.length}`);
console.log("=".repeat(58));
if (FAIL.length) FAIL.forEach(f => console.log("  失败：" + f));
process.exit(FAIL.length ? 1 : 0);
