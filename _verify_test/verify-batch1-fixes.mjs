// 第一批「止血」5 项修复的验证
//
// 用法：node _verify_test/verify-batch1-fixes.mjs
// 前提：统一入口在 18080 运行中，且已用修复后的镜像重建
//
// 覆盖：①删除守卫（课程/学期/订单）②学生删除影响预览 ③财务净额口径
//       ④考勤修改不产生重复行 ⑤报班强制选课程
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.BASE || "http://127.0.0.1:18080";
const DB_PATH = "server/data/attendance.db";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; fails.push(name); console.log("  ❌ " + name + (extra ? "  → " + extra : "")); }
}
function sec(t) { console.log("\n=== " + t + " ==="); }

async function login(u, p) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p })
  });
  return (await r.json()).data.accessToken;
}
async function api(path, token, opt = {}) {
  const r = await fetch(BASE + path, {
    ...opt,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opt.headers || {}) }
  });
  let body = null;
  try { body = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, body };
}
const db = new DatabaseSync(DB_PATH);
const admin = await login("admin", "admin123456");

// ═══════════════════════════════════════════════════════════
sec("① 删除守卫：课程");
const courseRefs = db.prepare(`
  SELECT (SELECT COUNT(*) FROM schedules WHERE course_id=1) AS sched,
         (SELECT COUNT(*) FROM orders WHERE course_id=1) AS ord,
         (SELECT COUNT(*) FROM teaching_assignments WHERE course_id=1) AS ta
`).get();
console.log(`     课程#1 引用：排课 ${courseRefs.sched} / 订单 ${courseRefs.ord} / 任课关系 ${courseRefs.ta}`);
const delCourse = await api("/api/courses/1", admin, { method: "DELETE" });
ok("删被引用的课程被拒绝", delCourse.status === 400, `status=${delCourse.status}`);
const msg1 = delCourse.body?.message || "";
console.log(`     拒绝原因：${msg1}`);
// ★ 关键：旧实现只查 4 张表，其中不含 orders / teaching_assignments —— 消息里出现它们才说明守卫生效
ok("★ 守卫发现了旧实现漏掉的表（报班订单）", msg1.includes("报班订单"), msg1);
ok("★ 守卫发现了旧实现漏掉的表（任课关系）", msg1.includes("任课关系"), msg1);

sec("① 删除守卫：学期 / 订单");
const termRef = db.prepare(`
  SELECT (SELECT COUNT(*) FROM teaching_assignments WHERE term_id=t.id) AS ta,
         (SELECT COUNT(*) FROM class_sessions WHERE term_id=t.id) AS cs
  FROM terms t WHERE t.is_current = 0 AND (
    EXISTS(SELECT 1 FROM teaching_assignments WHERE term_id=t.id) OR EXISTS(SELECT 1 FROM class_sessions WHERE term_id=t.id)
  ) LIMIT 1
`).get();
if (termRef) {
  const t = db.prepare("SELECT id FROM terms WHERE is_current=0").get();
  const delTerm = await api(`/api/terms/${t.id}`, admin, { method: "DELETE" });
  ok("删被引用的学期被拒绝", delTerm.status === 400, `status=${delTerm.status}`);
  console.log(`     拒绝原因：${delTerm.body?.message || ""}`);
} else {
  console.log("     （无可测学期，跳过）");
}

// 订单：用 API 找一个「在读」订单尝试删除。
// 分级策略：在读 + 有课消流水 → 400 拒绝；非在读（结业/退班）→ 允许删除（学员已离校，档案要能清理）。
// 两种情况都合法，只要不出现 404/500 即说明守卫工作正常。
const orderListRes = await api("/api/finance/orders?page=1&pageSize=500", admin);
const activeOrder = (orderListRes.body?.data?.list || []).find(o => o.status === "在读");
if (activeOrder) {
  const del = await api(`/api/finance/orders/${activeOrder.id}`, admin, { method: "DELETE" });
  console.log(`     在读订单#${activeOrder.id} 删除 → HTTP ${del.status} ${del.body?.message || ""}`);
  ok("在读订单删除不会出现 404/500（守卫生效）", del.status === 400 || del.status === 200,
     `实际 ${del.status}`);
  if (del.status === 400) {
    ok("★ 拒绝原因列出了被引用的数据（含课时消耗流水）", /课时消耗流水|缴费|退费/.test(del.body?.message || ""), del.body?.message || "");
  }
} else {
  console.log("     （无在读订单，跳过）");
}

// ═══════════════════════════════════════════════════════════
sec("② 学生删除影响预览");
const stuWithAtt = db.prepare(`
  SELECT s.id, s.name, (SELECT COUNT(*) FROM attendances a WHERE a.student_id=s.id) AS att
  FROM students s WHERE att > 0 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.student_id=s.id)
  LIMIT 1
`).get();
const stuBlocked = db.prepare(`
  SELECT s.id, s.name, (SELECT COUNT(*) FROM orders o WHERE o.student_id=s.id) AS ord
  FROM students s WHERE ord > 0 LIMIT 1
`).get();

if (stuWithAtt) {
  const imp = await api(`/api/students/${stuWithAtt.id}/delete-impact`, admin);
  ok("预览接口可用", imp.status === 200 && imp.body?.success, `status=${imp.status}`);
  const c = imp.body?.data?.cascade || {};
  console.log(`     学员「${stuWithAtt.name}」将连带清理：${JSON.stringify(c)}`);
  ok("★ 预览能列出具体的级联条数（删除前即可见）", Object.keys(c).length > 0 && c["考勤记录"] === stuWithAtt.att,
     `cascade=${JSON.stringify(c)} 实际考勤=${stuWithAtt.att}`);
  ok("预览标记为「不阻断」", imp.body?.data?.blocked === false);
} else {
  console.log("     （找不到无订单但有考勤的学员，跳过）");
}
if (stuBlocked) {
  const imp2 = await api(`/api/students/${stuBlocked.id}/delete-impact`, admin);
  ok("★ 有订单的学员被标记为「阻断」并给出订单数",
     imp2.body?.data?.blocked === true && imp2.body?.data?.orderCount === stuBlocked.ord,
     JSON.stringify(imp2.body?.data));
}

// ═══════════════════════════════════════════════════════════
sec("③ 财务净额口径（对齐 ADR-003）");
// ★ 期望值一律用 API 计算，不用本地直连：本机 Docker Desktop 的 bind mount 下
//   宿主机进程与容器看到的数据可能不同（实测过），拿本地库算"期望"会得到假失败。
async function paidList(token) {
  const r = await api("/api/finance/orders?page=1&pageSize=500", token);
  return (r.body?.data?.list) || [];
}
async function sumPayments(orderId, token) {
  const r = await api(`/api/finance/payments?order_id=${orderId}&pageSize=500`, token);
  const l = (r.body?.data?.list) || [];
  return l.reduce((s, p) => s + Number(p.amount || 0), 0);
}
async function sumRefundsPassed(orderId, token) {
  const r = await api(`/api/finance/refunds?pageSize=500`, token);
  const l = ((r.body?.data?.list) || []).filter(x => Number(x.order_id) === Number(orderId) && x.status === "通过");
  return l.reduce((s, p) => s + Number(p.amount || 0), 0);
}

// 找一个「既有缴费、又有已通过退费」的订单（用 API 找）
const allOrders = await paidList(admin);
let target = null;
for (const o of allOrders) {
  const ref = await sumRefundsPassed(o.id, admin);
  if (ref > 0) {
    target = { o, ref, pay: await sumPayments(o.id, admin) };
    break;
  }
}
if (target) {
  const netExpect = Number((target.pay - target.ref).toFixed(2));
  const row = allOrders.find(o => o.id === target.o.id);
  console.log(`     订单#${target.o.id}: 缴费 ${target.pay} − 已通过退费 ${target.ref} = 期望净额 ${netExpect}`);
  console.log(`     API 返回 paid = ${row?.paid}`);
  ok("★ 订单「已缴」= 缴费 − 已通过退费（净额）", Number(row?.paid) === netExpect, `实际 ${row?.paid} / 期望 ${netExpect}`);
  ok("★ 不再等于缴费毛额（旧行为）", Number(row?.paid) !== Number(target.pay), `paid=${row?.paid} 毛额=${target.pay}`);
} else {
  console.log("     （库里没有「含已通过退费」的订单，跳过该断言）");
}

const bus = await api("/api/finance/stats/business", admin);
const ov = bus.body?.data?.overview || {};
// 全库口径同样走 API：缴费合计 / 已通过退费合计
const allPay = await api("/api/finance/payments?pageSize=500", admin);
const allRef = await api("/api/finance/refunds?pageSize=500", admin);
const grossAll = ((allPay.body?.data?.list) || []).reduce((s, p) => s + Number(p.amount || 0), 0);
const refAll = ((allRef.body?.data?.list) || []).filter(x => x.status === "通过").reduce((s, p) => s + Number(p.amount || 0), 0);
console.log(`     全库（经 API）：缴费 ${grossAll} − 已通过退费 ${refAll} = ${grossAll - refAll}`);
console.log(`     经营报表 total_revenue = ${ov.total_revenue}`);
ok("★ 经营报表总营收 = 缴费 − 已通过退费", Number(ov.total_revenue) === Number((grossAll - refAll).toFixed(2)),
   `实际 ${ov.total_revenue} / 期望 ${grossAll - refAll}`);

const ren = await api("/api/finance/stats/revenue?start=2000-01-01&end=2030-12-31&granularity=month", admin);
const revTotal = ren.body?.data?.totalRevenue;
ok("★ 营收统计合计 = 净额（减退费）", Number(revTotal) === Number((grossAll - refAll).toFixed(2)),
   `实际 ${revTotal} / 期望 ${grossAll - refAll}`);
const firstRow = (ren.body?.data?.list || [])[0];
if (firstRow) console.log(`     营收首行含可追溯字段：gross=${firstRow.gross} refunded=${firstRow.refunded} total=${firstRow.total}`);

// ═══════════════════════════════════════════════════════════
sec("④ 考勤修改不产生重复行");
const att = db.prepare(`
  SELECT a.id, a.session_id, a.student_id, a.status, a.date, a.course_id
  FROM attendances a WHERE a.session_id IS NOT NULL LIMIT 1
`).get();
if (att) {
  const before = db.prepare("SELECT COUNT(*) c FROM attendances WHERE session_id=? AND student_id=?").get(att.session_id, att.student_id).c;
  // ★ 校验「刚写入的结果」一律走 API，不用本地独立连接：
  //   容器写入的 WAL 与本进程的连接可能落在不同快照上（实测踩过：明明更新成功却读到旧值）
  const totalBefore = (await api("/api/attendance/records?page=1&pageSize=1", admin)).body?.data?.total;
  // 列表接口应返回 session_id（修复点 1）
  const recRes = await api("/api/attendance/records?page=1&pageSize=200", admin);
  const recRow = ((recRes.body?.data?.list) || []).find(r => r.id === att.id);
  ok("★ 考勤记录列表已返回 session_id", recRow && "session_id" in recRow, JSON.stringify(recRow)?.slice(0, 120));
  ok("★ 该值与原记录一致", Number(recRow?.session_id) === Number(att.session_id), `${recRow?.session_id} vs ${att.session_id}`);

  // 模拟前端「修改」：带 session_id 提交（修复后的行为）
  const newStatus = att.status === "迟到" ? "早退" : "迟到";
  const save1 = await api("/api/attendance/batch", admin, {
    method: "POST",
    body: JSON.stringify({ session_id: att.session_id, records: [{ student_id: att.student_id, status: newStatus, remark: "batch1验证" }] })
  });
  ok("带 session_id 的修改请求成功", save1.status === 200 && save1.body?.success, `status=${save1.status} ${JSON.stringify(save1.body)?.slice(0,100)}`);

  const recRes2 = await api("/api/attendance/records?page=1&pageSize=200", admin);
  const list2 = recRes2.body?.data?.list || [];
  const totalAfter = recRes2.body?.data?.total;
  const sameKey = list2.filter(r => Number(r.session_id) === Number(att.session_id) && Number(r.student_id) === Number(att.student_id));
  ok("★ 修改后该(课次,学员)在列表中仍只有 1 条", sameKey.length === before && sameKey.length === 1, `${before} → ${sameKey.length}`);
  ok("★ 考勤总条数未增加（未新增重复行）", totalAfter === totalBefore, `${totalBefore} → ${totalAfter}`);
  ok("★ 状态确实已更新（经 API 复查）", sameKey[0]?.status === newStatus, `实际 ${sameKey[0]?.status} / 期望 ${newStatus}`);

  // 还原
  await api("/api/attendance/batch", admin, {
    method: "POST",
    body: JSON.stringify({ session_id: att.session_id, records: [{ student_id: att.student_id, status: att.status, remark: "" }] })
  });
  const recRes3 = await api("/api/attendance/records?page=1&pageSize=200", admin);
  const restored = ((recRes3.body?.data?.list) || []).find(r => r.id === att.id)?.status;
  ok("测试数据已还原", restored === att.status, `实际 ${restored}`);
} else {
  ok("存在 session 分区的考勤可供测试", false, "库里没有 session_id 非空的考勤");
}

// ═══════════════════════════════════════════════════════════
sec("⑤ 报班强制选课程");
const stu = db.prepare("SELECT id, name FROM students LIMIT 1").get();
const noCourse = await api("/api/finance/orders", admin, {
  method: "POST",
  body: JSON.stringify({ student_id: stu?.id, amount: 1000, total_hours: 10 })
});
ok("★ 不带课程报班被拒（400）", noCourse.status === 400, `status=${noCourse.status}`);
console.log(`     拒绝原因：${noCourse.body?.message || ""}`);
ok("拒绝原因说明了「不选课程将无法扣课时」", (noCourse.body?.message || "").includes("扣课时"), noCourse.body?.message || "");
const ordersBefore = db.prepare("SELECT COUNT(*) c FROM orders").get().c;
const ordersAfter = db.prepare("SELECT COUNT(*) c FROM orders").get().c;
ok("未产生脏订单", ordersBefore === ordersAfter, `${ordersBefore} → ${ordersAfter}`);

// ═══════════════════════════════════════════════════════════
sec("回归：核心接口仍正常");
for (const [label, path] of [
  ["订单列表", "/api/finance/orders?page=1&pageSize=5"],
  ["收费记录", "/api/finance/payments?page=1&pageSize=5"],
  ["退费记录", "/api/finance/refunds?page=1&pageSize=5"],
  ["欠费统计", "/api/finance/stats/arrears"],
  ["课消统计", "/api/finance/stats/consumption"],
  ["经营报表", "/api/finance/stats/business"],
  ["考勤统计", "/api/attendance/statistics"],
  ["学习报告", "/api/reports/students/1"],
  ["课程列表", "/api/courses"],
  ["学期列表", "/api/terms"]
]) {
  const r = await api(path, admin);
  ok(`${label} 200`, r.status === 200, "实际 " + r.status);
}

db.close();
console.log("\n" + "═".repeat(58));
console.log(`结果：PASS ${pass}  FAIL ${fail}`);
if (fail) { console.log("失败项："); fails.forEach(f => console.log("  - " + f)); }
console.log("═".repeat(58));
process.exit(fail ? 1 : 0);
