#!/usr/bin/env node
// e2e-lifecycle.mjs —— 学生全生命周期端到端测试
// 覆盖：招生线索 → 转化建档 → 报班 → 缴费/退费 → 考勤/课时联动 → 缺勤通知 → 家校绑定
//       → 结业/退班 → 经营报表联动 → 教学成绩与课消 → 排课优化（调课/补课/冲突检测）
//       → 删除场景关联性 → 数据自清理与基线校验
//
// 运行：node server/scripts/e2e-lifecycle.mjs   （Node >= 18 支持 fetch / top-level await）
// 说明：
//   - 所有测试数据以 e2e_ 为前缀，结束后在 finally 中逆序清理，可重复运行。
//   - 阶段 6.2（删除有业务记录的学生）为已知 bug 的「预期失败」断言：当前后端
//     未做业务校验，删除时触发外键 RESTRICT 抛 500（详见最终报告），脚本捕获后继续。
//   - 阶段 1 中任务描述的 GET /leads/:id 接口不存在（404），改用 GET /leads 列表
//     断言 status=已转化 与 converted_name（列表通过 JOIN converted_student_id 关联学员）。

const BASE = "http://localhost:3000/api";

// ==================== 断言工具 ====================
let passed = 0;
let failed = 0;
const failedLabels = [];

class AssertionError extends Error {
  constructor(label) {
    super(label);
    this.name = "AssertionError";
  }
}

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`[PASS] ${label}`);
  } else {
    failed++;
    failedLabels.push(label);
    console.log(`[FAIL] ${label}`);
    throw new AssertionError(label);
  }
}

// ==================== HTTP 封装 ====================
async function api(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** 期望 2xx 且 success=true，否则打印实际响应并断言失败 */
async function ok(method, path, body, token, label) {
  const r = await api(method, path, body, token);
  if (!(r.status >= 200 && r.status < 300 && r.json && r.json.success === true)) {
    console.log(`   → ${method} ${path} → HTTP ${r.status} ${JSON.stringify(r.json)}`);
    assert(false, label);
  }
  return r.json.data;
}

// ==================== 资源注册表（清理用） ====================
const created = [];
function track(type, id) {
  if (id != null && !created.some(x => x.type === type && x.id === id)) {
    created.push({ type, id });
  }
}
function untrack(type, id) {
  const i = created.findIndex(x => x.type === type && x.id === id);
  if (i >= 0) created.splice(i, 1);
}

// 清理顺序（先订单→缴费/退费，学生→线索→考试→班级→课程→课表→补课→调课），外键安全
const CLEANUP_ORDER = { order: 0, payment: 1, refund: 2, student: 3, lead: 4, exam: 5, class: 6, course: 7, schedule: 8, makeup: 9, adjustment: 10 };
function pathOf(type, id) {
  switch (type) {
    case "order": return `/finance/orders/${id}`;
    case "payment": return `/finance/payments/${id}`;
    case "refund": return `/finance/refunds/${id}`;
    case "student": return `/students/${id}`;
    case "lead": return `/leads/${id}`;
    case "class": return `/classes/${id}`;
    case "course": return `/courses/${id}`;
    case "exam": return `/exams/${id}`;
    case "schedule": return `/schedules/${id}`;
    case "makeup": return `/makeup-classes/${id}`;
    case "adjustment": return `/schedule-adjustments/${id}`;
    default: return null;
  }
}

function q(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, v);
  }
  return sp.toString();
}

function todayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 每次运行唯一的后缀（用户名/学号/课程码/班级名/手机号）
const STAMP = Date.now();
const leadName = `e2e_线索_${STAMP}`;
const leadPhone = `13${String(STAMP).slice(-9)}`;
const courseCode = `e2e_C${STAMP}`;
const className = `e2e_班_${STAMP}`;
const parentName = `e2e_家长_${STAMP}`;

// ==================== 主流程 ====================
let adminToken = null; // 模块级：异常中断后 finally 仍可清理

/** 预清理：扫描并删除上次运行可能遗留的 e2e_ 数据（自修复，保证可重复运行）
 *  按外键依赖顺序：调课→课表→补课→考试→订单→家长→学生→线索→班级→课程 */
async function preClean(token) {
  console.log("[preClean] 清理上次可能遗留的 e2e_ 数据...");
  // 0. 调课申请（v13：admin 可删任意状态；先删以免残留课表携带已通过调课历史导致课表删不掉）
  const adjs = (await ok("GET", `/schedule-adjustments?${q({ pageSize: 100 })}`, undefined, token, "preClean.查询残留调课")).list.filter(a => String(a.class_name).startsWith("e2e_"));
  for (const a of adjs) {
    try { await api("DELETE", `/schedule-adjustments/${a.id}`, undefined, token); console.log(`[preClean] 已删调课#${a.id}`); } catch { /* 忽略 */ }
  }
  // 0.1 课表（残留课表会占用班级时段，干扰本轮调课冲突检测）
  const scheds = (await ok("GET", `/schedules?${q({ pageSize: 100 })}`, undefined, token, "preClean.查询残留课表")).list.filter(s => String(s.class_name).startsWith("e2e_"));
  for (const s of scheds) {
    try { await api("DELETE", `/schedules/${s.id}`, undefined, token); console.log(`[preClean] 已删课表#${s.id}`); } catch { /* 忽略 */ }
  }
  // 0.2 补课记录（引用学生/班级，先删避免残留影响学生删除）
  const makeups = (await ok("GET", `/makeup-classes?${q({ pageSize: 100 })}`, undefined, token, "preClean.查询残留补课")).list.filter(m => String(m.student_name).startsWith("e2e_"));
  for (const m of makeups) {
    try { await api("DELETE", `/makeup-classes/${m.id}`, undefined, token); console.log(`[preClean] 已删补课#${m.id}`); } catch { /* 忽略 */ }
  }
  // 0.3 考试（引用班级/课程）
  const exams = (await ok("GET", `/exams?${q({ pageSize: 100 })}`, undefined, token, "preClean.查询残留考试")).list.filter(e => String(e.class_name).startsWith("e2e_"));
  for (const e of exams) {
    try { await api("DELETE", `/exams/${e.id}`, undefined, token); console.log(`[preClean] 已删考试#${e.id}`); } catch { /* 忽略 */ }
  }
  // 1. 订单（级联删除缴费/退费/课时流水）。v13 保护：有缴费/退费记录的订单禁止删除，须先删资金记录
  const orders = (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, token, "preClean.查询残留订单")).list;
  for (const o of orders) {
    // 1.0 先删该订单的缴费/退费记录（否则订单被删除保护拦截）
    const pays = (await ok("GET", `/finance/payments?${q({ order_id: o.id, pageSize: 100 })}`, undefined, token, "preClean.查询残留缴费")).list;
    for (const p of pays) {
      try { await api("DELETE", `/finance/payments/${p.id}`, undefined, token); } catch { /* 忽略 */ }
    }
    const refundsOf = (await ok("GET", `/finance/refunds?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, token, "preClean.查询残留退费")).list.filter(r => r.order_id === o.id);
    for (const r of refundsOf) {
      try { await api("DELETE", `/finance/refunds/${r.id}`, undefined, token); } catch { /* 忽略 */ }
    }
    try { await api("DELETE", `/finance/orders/${o.id}`, undefined, token); console.log(`[preClean] 已删订单#${o.id}`); } catch { /* 忽略 */ }
  }
  // 3. 学生（级联删除考勤/通知；订单需已删）
  const students = (await ok("GET", `/students?${q({ name: "e2e_", pageSize: 100 })}`, undefined, token, "preClean.查询残留学生")).list;
  for (const s of students) {
    try { await api("DELETE", `/students/${s.id}`, undefined, token); console.log(`[preClean] 已删学生#${s.id}`); } catch { /* 忽略 */ }
  }
  // 4. 线索
  const leads = (await ok("GET", `/leads?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, token, "preClean.查询残留线索")).list;
  for (const l of leads) {
    try { await api("DELETE", `/leads/${l.id}`, undefined, token); console.log(`[preClean] 已删线索#${l.id}`); } catch { /* 忽略 */ }
  }
  // 5. 班级
  const classes = (await ok("GET", `/classes?${q({ name: "e2e_", pageSize: 100 })}`, undefined, token, "preClean.查询残留班级")).list;
  for (const c of classes) {
    try { await api("DELETE", `/classes/${c.id}`, undefined, token); console.log(`[preClean] 已删班级#${c.id}`); } catch { /* 忽略 */ }
  }
  // 6. 课程
  const courses = (await ok("GET", `/courses?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, token, "preClean.查询残留课程")).list;
  for (const c of courses) {
    try { await api("DELETE", `/courses/${c.id}`, undefined, token); console.log(`[preClean] 已删课程#${c.id}`); } catch { /* 忽略 */ }
  }
}

async function runAll() {
  // ---------- 登录（admin / teacher 各一次，复用 token） ----------
  const loginAdmin = await api("POST", "/auth/login", { type: "password", username: "admin", password: "admin123456" });
  assert(loginAdmin.status === 200 && loginAdmin.json?.success, "登录 admin（admin/admin123456）");
  adminToken = loginAdmin.json.data.accessToken;

  const loginTeacher = await api("POST", "/auth/login", { type: "password", username: "teacher", password: "teacher123456" });
  assert(loginTeacher.status === 200 && loginTeacher.json?.success, "登录 teacher（teacher/teacher123456）");
  const teacherToken = loginTeacher.json.data.accessToken;

  // 教师 id：e2e 班级绑定 teacher 为班主任，保证教师可看该班缺勤通知（阶段 4.8）
  const usersData = await ok("GET", "/users?role=teacher", undefined, adminToken, "查询教师账号列表");
  const teacherUser = usersData.list.find(u => u.role === "teacher");
  assert(teacherUser && teacherUser.id, "获取教师账号 id");
  const teacherId = teacherUser.id;

  // 预清理：删除上次运行可能遗留的 e2e_ 数据（保证可重复运行）
  await preClean(adminToken);

  // ---------- 准备 e2e 课程与班级（幂等：已有 e2e 残留则复用并纳入清理） ----------
  const courseList = await ok("GET", "/courses/all", undefined, adminToken, "查询课程列表");
  const existingCourse = courseList.find(c => String(c.code).startsWith("e2e_"));
  let courseId;
  if (existingCourse) {
    courseId = existingCourse.id;
    track("course", courseId);
    console.log(`   → 复用已有 e2e 课程 #${courseId}（上次残留，纳入清理）`);
  } else {
    courseId = (await ok("POST", "/courses", { code: courseCode, name: `${courseCode}课程`, teacher: "e2e老师" }, adminToken, "创建 e2e 课程")).id;
    track("course", courseId);
  }

  const classList = await ok("GET", "/classes/all", undefined, adminToken, "查询班级列表");
  const existingClass = classList.find(c => String(c.name).startsWith("e2e_"));
  // 实际使用的班级名（复用残留班时为残留名，新建时为本轮 className），供课消断言使用
  const usedClassName = existingClass ? existingClass.name : className;
  let classId;
  if (existingClass) {
    classId = existingClass.id;
    track("class", classId);
    console.log(`   → 复用已有 e2e 班级 #${classId}（上次残留，纳入清理）`);
  } else {
    classId = (await ok("POST", "/classes", { name: className, grade: "e2e年级", head_teacher: teacherUser.name, head_teacher_id: teacherId }, adminToken, "创建 e2e 班级（班主任=teacher）")).id;
    track("class", classId);
  }

  // ==================== 阶段 1：招生链路（admin） ====================
  const leadData = await ok("POST", "/leads", { name: leadName, phone: leadPhone, source: "转介绍", intent_course_id: courseId }, adminToken, "阶段1.创建招生线索");
  const leadId = leadData.id;
  track("lead", leadId);

  await ok("PUT", `/leads/${leadId}/follow`, { content: "e2e 端到端测试首次跟进" }, adminToken, "阶段1.线索追加跟进");
  const convertData = await ok("PUT", `/leads/${leadId}/convert`, { class_id: classId, amount: 1000, course_id: courseId }, adminToken, "阶段1.线索转化建档");
  const studentId = convertData.student_id;
  const studentNo = convertData.student_no;
  track("student", studentId);

  // 三表联动断言
  const studentsRes = await ok("GET", `/students?${q({ name: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段1.查询学生列表");
  assert(
    studentsRes.list.some(s => s.id === studentId && s.student_no === studentNo && s.name === leadName),
    "阶段1.学生档案已创建（学号/姓名匹配）"
  );
  const ordersRes1 = await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段1.查询订单列表");
  const orderA = ordersRes1.list.find(o => o.student_id === studentId && o.status === "在读");
  assert(orderA && Number(orderA.amount) === 1000, "阶段1.转化自动生成在读订单");
  const orderAId = orderA.id;
  track("order", orderAId);

  const leadsRes = await ok("GET", `/leads?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段1.查询线索列表");
  const leadRow = leadsRes.list.find(l => l.id === leadId);
  assert(leadRow && leadRow.status === "已转化" && leadRow.converted_name === leadName, "阶段1.线索状态=已转化 且 关联学员（GET /leads/:id 接口不存在，用列表 converted_name 验证）");

  // ==================== 阶段 2：财务链路（admin） ====================
  const orderDetail = await ok("GET", `/finance/orders/${orderAId}`, undefined, adminToken, "阶段2.查询订单详情");
  assert(orderDetail.id === orderAId && orderDetail.student_id === studentId, "阶段2.订单详情含学员信息");

  const pay1 = await ok("POST", "/finance/payments", { order_id: orderAId, student_id: studentId, amount: 500, pay_method: "现金" }, adminToken, "阶段2.登记缴费 500");
  const pay1Id = pay1.id;
  track("payment", pay1Id);

  const paidAfter500 = (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段2.查询订单已缴")).list.find(o => o.id === orderAId);
  assert(Number(paidAfter500.paid) === 500, "阶段2.订单已缴=500");

  await ok("PUT", `/finance/payments/${pay1Id}`, { amount: 600 }, adminToken, "阶段2.修改缴费为 600");
  const paidAfter600 = (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段2.查询订单已缴(改后)")).list.find(o => o.id === orderAId);
  assert(Number(paidAfter600.paid) === 600, "阶段2.订单已缴=600");

  await ok("DELETE", `/finance/payments/${pay1Id}`, undefined, adminToken, "阶段2.删除缴费记录");
  untrack("payment", pay1Id);
  const paidAfterDel = (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段2.查询订单已缴(删后)")).list.find(o => o.id === orderAId);
  assert(Number(paidAfterDel.paid) === 0, "阶段2.订单已缴回 0");

  const pay2 = await ok("POST", "/finance/payments", { order_id: orderAId, student_id: studentId, amount: 500, pay_method: "现金" }, adminToken, "阶段2.重新登记缴费 500");
  const pay2Id = pay2.id;
  track("payment", pay2Id);

  const refund1 = await ok("POST", "/finance/refunds", { order_id: orderAId, student_id: studentId, amount: 200, reason: "e2e 测试退费" }, adminToken, "阶段2.提交退费申请 200");
  const refund1Id = refund1.id;
  track("refund", refund1Id);
  await ok("PUT", `/finance/refunds/${refund1Id}/approve`, { status: "通过" }, adminToken, "阶段2.审批退费=通过");

  // ==================== 阶段 3：考勤与课时联动（admin） ====================
  const orderBData = await ok("POST", "/finance/orders", { student_id: studentId, class_id: classId, course_id: courseId, amount: 1000, total_hours: 10 }, adminToken, "阶段3.创建课时订单(total_hours=10)");
  const orderBId = orderBData.id;
  track("order", orderBId);
  const today = todayStr();

  const remainOf = async () => (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段3.查询订单课时剩余")).list.find(o => o.id === orderBId);

  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }, adminToken, "阶段3.提交考勤-正常");
  assert(Number((await remainOf()).remain_hours) === 9, "阶段3.正常考勤扣减课时 remain=9");

  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "缺勤" }] }, adminToken, "阶段3.提交考勤-缺勤(正常改缺勤)");
  assert(Number((await remainOf()).remain_hours) === 10, "阶段3.正常改缺勤回补课时 remain=10");

  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "缺勤" }] }, adminToken, "阶段3.再次提交缺勤(无变化)");
  assert(Number((await remainOf()).remain_hours) === 10, "阶段3.缺勤幂等 remain 仍=10");

  // ==================== 阶段 4：家校链路（admin） ====================
  // v14：家长信息直接写入学生档案（无家长账号），通知以 parent_name 快照留痕
  await ok("PUT", `/students/${studentId}`, { student_no: studentNo, name: leadName, class_id: classId, parent_name: parentName, parent_phone: leadPhone }, adminToken, "阶段4.为学生档案写入家长信息");

  // 当前考勤为缺勤 → 先标记正常再标缺勤，确保状态变化触发通知
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }, adminToken, "阶段4.先标记正常");
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "缺勤" }] }, adminToken, "阶段4.标记缺勤");

  const notifQ = `/notifications?${q({ keyword: "e2e_", type: "考勤缺勤", date_start: today, date_end: today, pageSize: 100 })}`;
  const absentOf = async () =>
    (await ok("GET", notifQ, undefined, adminToken, "阶段4.查询缺勤通知")).list.filter(n => n.student_id === studentId && n.date === today && n.type === "考勤缺勤");

  const n1 = await absentOf();
  assert(n1.length >= 1 && n1.some(n => n.parent_name === parentName && n.is_read === 0), "阶段4.缺勤通知已生成(家长姓名快照/未读)");

  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "缺勤" }] }, adminToken, "阶段4.重复缺勤(无变化)");
  assert((await absentOf()).length === 1, "阶段4.缺勤通知幂等（数量不增加）");

  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }, adminToken, "阶段4.标记回正常");
  assert((await absentOf()).length === 0, "阶段4.标记正常后缺勤通知已撤销");

  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "缺勤" }] }, adminToken, "阶段4.再次标记缺勤");
  const n4 = await absentOf();
  const notice = n4.find(x => x.is_read === 0) || n4[0];
  assert(notice, "阶段4.缺勤通知再次生成");

  await ok("PUT", `/notifications/${notice.id}/read`, undefined, adminToken, "阶段4.标记单条已读");
  assert((await absentOf()).find(x => x.id === notice.id)?.is_read === 1, "阶段4.通知 is_read=1");

  await ok("PUT", "/notifications/read-all", undefined, adminToken, "阶段4.全部标记已读");
  const unreadRes = await ok("GET", `/notifications?${q({ pageSize: 100 })}`, undefined, adminToken, "阶段4.查询未读数");
  assert(unreadRes.unreadCount === 0, "阶段4.全部已读后 unreadCount=0");

  const teacherNotif = await ok("GET", `/notifications?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, teacherToken, "阶段4.教师查询通知");
  assert(teacherNotif.list.some(n => n.student_id === studentId), "阶段4.教师(同班)可见该缺勤通知");

  // ==================== 阶段 5：结课与报表链路（admin） ====================
  const biz1 = await ok("GET", "/finance/stats/business", undefined, adminToken, "阶段5.经营报表(前)");
  const ov1 = biz1.overview;

  await ok("PUT", `/finance/orders/${orderBId}/status`, { status: "结业" }, adminToken, "阶段5.课时订单设为结业");

  const orderCData = await ok("POST", "/finance/orders", { student_id: studentId, class_id: classId, course_id: courseId, amount: 1000, total_hours: 5 }, adminToken, "阶段5.创建第二张在读订单");
  const orderCId = orderCData.id;
  track("order", orderCId);

  const biz2 = await ok("GET", "/finance/stats/business", undefined, adminToken, "阶段5.经营报表(后)");
  const ov2 = biz2.overview;
  assert(Number(ov2.graduated_6m) >= Number(ov1.graduated_6m) + 1, `阶段5.graduated_6m 增量（${ov1.graduated_6m}→${ov2.graduated_6m}）`);
  assert(Number(ov2.renewed_6m) >= Number(ov1.renewed_6m) + 1, `阶段5.renewed_6m 增量（结业后仍有在读订单→续班 ${ov1.renewed_6m}→${ov2.renewed_6m}）`);

  await ok("PUT", `/finance/orders/${orderCId}/status`, { status: "退班" }, adminToken, "阶段5.第二张订单设为退班");
  await ok("DELETE", `/finance/orders/${orderCId}`, undefined, adminToken, "阶段5.删除第二张订单");
  untrack("order", orderCId);

  // ==================== 阶段 8：教学结果与课消（admin，插入在删除语义之前） ====================
  const examName = `e2e_期中考试_${STAMP}`;
  const examData = await ok("POST", "/exams", { name: examName, course_id: courseId, class_id: classId, exam_date: today, type: "期中", full_score: 100 }, adminToken, "阶段8.1.创建考试");
  const examId = examData.id;

  // 8.2 录入成绩（新插入）并断言保存
  await ok("PUT", `/exams/${examId}/scores`, { scores: [{ student_id: studentId, score: 92, remark: "" }] }, adminToken, "阶段8.2.录入成绩 92");
  const scoresForm = await ok("GET", `/exams/${examId}/scores`, undefined, adminToken, "阶段8.2.查询考试学生成绩");
  const scoreRow = scoresForm.students.find(s => s.student_id === studentId);
  assert(scoreRow && Number(scoreRow.score) === 92, "阶段8.2.成绩已保存（92）");

  // 8.3 成绩发布通知（parent_name 快照）且修改成绩幂等（不重复生成）
  const scoreNotifQ = `/notifications?${q({ keyword: "e2e_", type: "成绩发布", date_start: today, date_end: today, pageSize: 100 })}`;
  const scoreNotif1 = await ok("GET", scoreNotifQ, undefined, adminToken, "阶段8.3.查询成绩发布通知");
  assert(
    scoreNotif1.list.some(n => n.student_id === studentId && n.parent_name === parentName && n.is_read === 0),
    "阶段8.3.成绩发布通知已生成(家长姓名快照/未读)"
  );
  await ok("PUT", `/exams/${examId}/scores`, { scores: [{ student_id: studentId, score: 95, remark: "" }] }, adminToken, "阶段8.3.修改成绩 92→95");
  const scoreNotif2 = await ok("GET", scoreNotifQ, undefined, adminToken, "阶段8.3.再次查询成绩通知");
  assert(scoreNotif2.list.filter(n => n.student_id === studentId).length === 1, "阶段8.3.成绩通知幂等（修改成绩不重复生成）");

  // 8.4 成绩单（等级：95/100 → 优）
  const card = await ok("GET", `/exams/${examId}/scorecard`, undefined, adminToken, "阶段8.4.查询成绩单");
  const cardRow = card.list.find(r => r.student_id === studentId);
  assert(cardRow && Number(cardRow.score) === 95 && cardRow.grade === "优", "阶段8.4.成绩单含成绩与等级(95→优)");

  // 8.5 学习报告（最新成绩 + 出勤率；课时包因课时订单已在阶段5结业而不出现在"在读"列表中，课时关联由阶段8.7断言）
  const report = await ok("GET", `/reports/students/${studentId}`, undefined, adminToken, "阶段8.5.查询学习报告");
  assert(report.scores.some(s => Number(s.score) === 95 && s.grade === "优"), "阶段8.5.学习报告含最新成绩 95");
  assert(Array.isArray(report.hours) && typeof report.attendance.attendance_rate === "number", "阶段8.5.学习报告含课时包数组与出勤率");

  // 8.6 成长档案（含成绩事件）
  const timeline = await ok("GET", `/reports/students/${studentId}/timeline`, undefined, adminToken, "阶段8.6.查询成长档案");
  assert(timeline.some(e => e.type === "成绩" && /95/.test(e.content)), "阶段8.6.成长档案含成绩事件");
  assert(timeline.some(e => e.type === "入学") && timeline.some(e => e.type === "报班"), "阶段8.6.成长档案含入学与报班事件");

  // 8.7 课消统计与收入确认：新建在读课时订单 → 考勤正常扣 1 → 断言流水与收入
  const orderDData = await ok("POST", "/finance/orders", { student_id: studentId, class_id: classId, course_id: courseId, amount: 1000, total_hours: 10 }, adminToken, "阶段8.7.创建课消验证订单(total=10,amount=1000)");
  const orderDId = orderDData.id;
  track("order", orderDId);
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }, adminToken, "阶段8.7.考勤正常(扣1课时)");

  const consStudent = await ok("GET", `/finance/stats/consumption?${q({ dimension: "student" })}`, undefined, adminToken, "阶段8.7.查询课消统计(按学员)");
  const consRow = consStudent.list.find(r => r.student_id === studentId);
  // 累计流水：阶段3 扣1回1；阶段4 扣2回2；阶段8.7 再扣1 → 扣减4 / 回补3
  assert(consRow && Number(consRow.consumed) === 4 && Number(consRow.refunded) === 3, `阶段8.7.课消流水累计（扣减4/回补3，实际 ${consRow && consRow.consumed}/${consRow && consRow.refunded}）`);
  assert(consRow && Number(consRow.total_hours) === 10 && Number(consRow.remain_hours) === 9, "阶段8.7.课消统计含课时包余额(total=10/remain=9)");
  assert(typeof consStudent.summary.revenue_recognized === "number" && consStudent.summary.revenue_recognized >= 100, `阶段8.7.课消收入确认 ≥ 100（实际 ${consStudent.summary.revenue_recognized}）`);
  assert(consStudent.summary.can_see_amount === true, "阶段8.7.admin 可见收入金额");

  // teacher：课消统计仅本班可见且不可见金额
  const consTeacher = await ok("GET", `/finance/stats/consumption?${q({ dimension: "teacher" })}`, undefined, teacherToken, "阶段8.7.教师查询课消统计(按老师)");
  assert(consTeacher.list.some(r => r.class_name === usedClassName), "阶段8.7.教师可见本班课消");
  assert(consTeacher.summary.can_see_amount === false, "阶段8.7.teacher 金额不可见");
  const reportByTeacher = await ok("GET", `/reports/students/${studentId}`, undefined, teacherToken, "阶段8.8.教师查看学习报告(同班)");
  assert(reportByTeacher.student.student_no === studentNo, "阶段8.8.教师可查看同班学员报告");

  // 清理课消验证订单（避免影响阶段 6 删除语义断言）
  await ok("DELETE", `/finance/orders/${orderDId}`, undefined, adminToken, "阶段8.7.删除课消验证订单");
  untrack("order", orderDId);
  // 清理考试（成绩级联删除；否则阶段 6.5 删除班级被"存在考试记录"保护拦截）
  track("exam", examId);
  await ok("DELETE", `/exams/${examId}`, undefined, adminToken, "阶段8.9.删除考试记录");
  untrack("exam", examId);

  // ==================== 阶段 9：排课优化（admin + teacher） ====================
  // 9.1 冲突检测：同班同时段重复拒绝 + 同教师跨班同时段警告
  const schedA = await ok("POST", "/schedules", { class_id: classId, course_id: courseId, day_of_week: 1, period: 1 }, adminToken, "阶段9.1.创建课表条目(周一1)");
  const schedAId = schedA.id;
  const dupRes = await api("POST", "/schedules", { class_id: classId, course_id: courseId, day_of_week: 1, period: 1 }, adminToken);
  assert(dupRes.status === 400 && /已安排/.test(dupRes.json?.message || ""), "阶段9.1.同班同时段重复创建被拒绝(400)");

  const courseBData = await ok("POST", "/courses", { code: `e2e_B${STAMP}`, name: "e2e_冲突检测课程", teacher: "e2e老师" }, adminToken, "阶段9.1.创建同教师课程");
  const courseBId = courseBData.id;
  const classBData = await ok("POST", "/classes", { name: `e2e_班B_${STAMP}`, grade: "e2e年级B", head_teacher: teacherUser.name, head_teacher_id: teacherId }, adminToken, "阶段9.1.创建第二班级");
  const classBId = classBData.id;
  const crossRes = await api("POST", "/schedules", { class_id: classBId, course_id: courseBId, day_of_week: 1, period: 1 }, adminToken);
  assert(crossRes.status === 200 && (crossRes.json?.data?.warnings || []).length > 0, "阶段9.1.同教师跨班同时段保存成功且返回警告");
  const schedBId = crossRes.json.data.id;

  // 9.2 调课全链路：teacher 提交 → admin 审批通过 → 课表同步
  const adjData = await ok("POST", "/schedule-adjustments", { schedule_id: schedAId, to_day_of_week: 1, to_period: 2, reason: "e2e调课测试" }, teacherToken, "阶段9.2.teacher提交调课申请(周一1→周一2)");
  const adjId = adjData.id;
  const adjDup = await api("POST", "/schedule-adjustments", { schedule_id: schedAId, to_day_of_week: 1, to_period: 3 }, teacherToken);
  assert(adjDup.status === 400 && /待审批/.test(adjDup.json?.message || ""), "阶段9.2.同一课表条目重复提交调课被拒绝");
  await ok("PUT", `/schedule-adjustments/${adjId}/approve`, { action: "通过" }, adminToken, "阶段9.2.admin审批通过");
  const schedAfter = (await ok("GET", `/schedules?${q({ class_id: classId, pageSize: 100 })}`, undefined, adminToken, "阶段9.2.查询课表")).list.find(s => s.id === schedAId);
  assert(schedAfter && Number(schedAfter.day_of_week) === 1 && Number(schedAfter.period) === 2, "阶段9.2.审批通过后课表同步为周一2");
  const adjStatus = (await ok("GET", `/schedule-adjustments?${q({ status: "通过", pageSize: 100 })}`, undefined, adminToken, "阶段9.2.查询已通过申请")).list.find(a => a.id === adjId);
  assert(adjStatus && adjStatus.status === "通过", "阶段9.2.申请状态=通过");

  // 9.3 调课到同班已占用时段 → 拒绝（目标时段冲突）
  const schedC = await ok("POST", "/schedules", { class_id: classId, course_id: courseId, day_of_week: 1, period: 3 }, adminToken, "阶段9.3.创建课表条目(周一3)");
  const schedCId = schedC.id;
  const adjBlock = await api("POST", "/schedule-adjustments", { schedule_id: schedAId, to_day_of_week: 1, to_period: 3 }, teacherToken);
  assert(adjBlock.status === 400 && /占用/.test(adjBlock.json?.message || ""), "阶段9.3.目标时段已被占用调课被拒绝");

  // 9.4 补课联动课时：登记 → 完成扣课时 → 撤销回补（hour_consumptions 流水）
  const orderEData = await ok("POST", "/finance/orders", { student_id: studentId, class_id: classId, course_id: courseId, amount: 500, total_hours: 5 }, adminToken, "阶段9.4.创建补课验证订单(total=5)");
  const orderEId = orderEData.id;
  track("order", orderEId);
  const consBefore = (await ok("GET", `/finance/stats/consumption?${q({ dimension: "student" })}`, undefined, adminToken, "阶段9.4.查询课消统计(前)")).list.find(r => r.student_id === studentId);
  const mkData = await ok("POST", "/makeup-classes", { student_id: studentId, class_id: classId, course_id: courseId, original_date: today, makeup_date: today, remark: "e2e补课" }, adminToken, "阶段9.4.登记补课");
  const mkId = mkData.id;
  await ok("PUT", `/makeup-classes/${mkId}/status`, { status: "已完成" }, adminToken, "阶段9.4.补课标记完成");
  const orderEAfter = (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段9.4.查询订单课时")).list.find(o => o.id === orderEId);
  assert(Number(orderEAfter.remain_hours) === 4, `阶段9.4.补课完成扣减课时(remain=4，实际 ${orderEAfter.remain_hours})`);
  const consAfter = (await ok("GET", `/finance/stats/consumption?${q({ dimension: "student" })}`, undefined, adminToken, "阶段9.4.查询课消统计(后)")).list.find(r => r.student_id === studentId);
  assert(consAfter && Number(consAfter.consumed) >= Number(consBefore?.consumed || 0) + 1, "阶段9.4.补课扣减已写入课时消耗流水");
  await ok("PUT", `/makeup-classes/${mkId}/status`, { status: "待安排" }, adminToken, "阶段9.4.撤销补课完成(回补)");
  const orderERefund = (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段9.4.查询订单课时(回补后)")).list.find(o => o.id === orderEId);
  assert(Number(orderERefund.remain_hours) === 5, "阶段9.4.撤销补课回补课时(remain=5)");

  // 9.5 教师权限：调课/补课列表仅本班可见
  const adjTeacher = await ok("GET", `/schedule-adjustments?${q({ pageSize: 100 })}`, undefined, teacherToken, "阶段9.5.教师查询调课列表");
  assert(adjTeacher.list.length > 0 && adjTeacher.list.every(a => a.class_id === classId), "阶段9.5.教师调课列表仅本班");
  const mkTeacher = await ok("GET", `/makeup-classes?${q({ pageSize: 100 })}`, undefined, teacherToken, "阶段9.5.教师查询补课列表");
  assert(mkTeacher.list.some(m => m.id === mkId), "阶段9.5.教师可见本班补课记录");

  // 9.6 清理排课测试数据（先删已通过调课申请再删课表，因 G6 保护：有已通过调课历史的课表禁止删除）
  await ok("DELETE", `/schedule-adjustments/${adjId}`, undefined, adminToken, "阶段9.6.删除已通过调课申请");
  await ok("DELETE", `/schedules/${schedCId}`, undefined, adminToken, "阶段9.6.删除占用时段课表");
  await ok("DELETE", `/schedules/${schedAId}`, undefined, adminToken, "阶段9.6.删除调课课表");
  await ok("DELETE", `/schedules/${schedBId}`, undefined, adminToken, "阶段9.6.删除冲突检测课表");
  await ok("DELETE", `/makeup-classes/${mkId}`, undefined, adminToken, "阶段9.6.删除补课记录");
  await ok("DELETE", `/finance/orders/${orderEId}`, undefined, adminToken, "阶段9.6.删除补课验证订单");
  untrack("order", orderEId);
  await ok("DELETE", `/courses/${courseBId}`, undefined, adminToken, "阶段9.6.删除同教师课程");
  await ok("DELETE", `/classes/${classBId}`, undefined, adminToken, "阶段9.6.删除第二班级");

  // ==================== 阶段 10：考勤↔请假双向联动（v13 G3 + G11 反向缺口） ====================
  // 覆盖：考勤标记请假生成同步单 → 审批通过回补+通知 → 改回正常撤销已通过同步单（G11）
  //      手动请假单覆盖日期不重复生成同步单（G11）→ 驳回回滚考勤为缺勤（G11）
  const orderFData = await ok("POST", "/finance/orders", { student_id: studentId, class_id: classId, course_id: courseId, amount: 500, total_hours: 5 }, adminToken, "阶段10.1.创建请假联动验证订单(total=5)");
  const orderFId = orderFData.id;
  track("order", orderFId);
  const remainF = async () => (await ok("GET", `/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段10.查询订单课时")).list.find(o => o.id === orderFId);

  // 10.2 考勤先标"缺勤"再标"正常"（阶段8.7结束时已是"正常"，需先制造状态变化）→ 扣课时 remain=4
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "缺勤" }] }, adminToken, "阶段10.2.考勤先标缺勤");
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }, adminToken, "阶段10.2.考勤标记正常");
  assert(Number((await remainF()).remain_hours) === 4, "阶段10.2.正常考勤扣课时(remain=4)");

  // 10.3 考勤改"请假" → 生成待审批同步单 + 回补课时 remain=5
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "请假" }] }, adminToken, "阶段10.3.考勤标记请假");
  assert(Number((await remainF()).remain_hours) === 5, "阶段10.3.请假回补课时(remain=5)");
  const syncLeavesOf = async () => (await ok("GET", `/leaves?${q({ student_id: studentId, pageSize: 100 })}`, undefined, adminToken, "阶段10.查询请假列表")).list.filter(l => l.source === "考勤同步" && l.start_date <= today && l.end_date >= today);
  const syncL1 = await syncLeavesOf();
  assert(syncL1.length === 1 && syncL1[0].status === "待审批", "阶段10.3.考勤标记请假自动生成待审批同步单");

  // 10.4 审批同步单"通过" → 通知家长（请假审批通过）
  await ok("PUT", `/leaves/${syncL1[0].id}/approve`, { status: "通过" }, adminToken, "阶段10.4.审批同步单通过");
  const leaveNotifQ = `/notifications?${q({ keyword: "e2e_", type: "请假审批通过", date_start: today, date_end: today, pageSize: 100 })}`;
  const leaveNotif = await ok("GET", leaveNotifQ, undefined, adminToken, "阶段10.4.查询请假通过通知");
  assert(leaveNotif.list.some(n => n.student_id === studentId && n.parent_name === parentName), "阶段10.4.请假审批通过通知已生成(家长姓名快照)");

  // 10.5 考勤改回"正常" → 已通过同步单被撤销（删除）+ 通知撤销 + 重扣课时 remain=4【G11】
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "正常" }] }, adminToken, "阶段10.5.考勤改回正常");
  assert(Number((await remainF()).remain_hours) === 4, "阶段10.5.改回正常重扣课时(remain=4)");
  assert((await syncLeavesOf()).length === 0, "阶段10.5.已通过同步单已被撤销（删除）");
  const leaveNotifAfter = await ok("GET", leaveNotifQ, undefined, adminToken, "阶段10.5.查询请假通知(撤销后)");
  assert(leaveNotifAfter.list.filter(n => n.student_id === studentId).length === 0, "阶段10.5.请假审批通过通知已撤销");

  // 10.6 手动创建请假单（source=手动）覆盖今日
  const manualLeave = await ok("POST", "/leaves", { student_id: studentId, type: "病假", reason: `e2e_手动请假_${STAMP}`, start_date: today, end_date: today }, adminToken, "阶段10.6.手动创建请假单");
  const manualLeaveId = manualLeave.id;

  // 10.7 考勤标记"请假" → 已有手动单覆盖 → 不重复生成同步单【G11 幂等扩展】
  await ok("POST", "/attendance/batch", { date: today, course_id: courseId, records: [{ student_id: studentId, status: "请假" }] }, adminToken, "阶段10.7.考勤标记请假(有手动单)");
  const leaveListAll = await ok("GET", `/leaves?${q({ student_id: studentId, pageSize: 100 })}`, undefined, adminToken, "阶段10.7.查询请假列表");
  const syncCount = leaveListAll.list.filter(l => l.source === "考勤同步").length;
  const manualCount = leaveListAll.list.filter(l => l.id === manualLeaveId).length;
  assert(syncCount === 0 && manualCount === 1, "阶段10.7.手动单覆盖时不重复生成同步单");

  // 10.8 驳回手动单 → 考勤"请假"回滚为"缺勤"【G11 驳回回滚】
  await ok("PUT", `/leaves/${manualLeaveId}/approve`, { status: "驳回" }, adminToken, "阶段10.8.驳回手动请假单");
  const attAfterReject = await ok("GET", `/attendance/records?${q({ student_id: studentId, date_start: today, date_end: today, pageSize: 100 })}`, undefined, adminToken, "阶段10.8.查询考勤记录(驳回后)");
  const attRow = attAfterReject.list.find(r => r.student_id === studentId && r.course_id === courseId);
  assert(attRow && attRow.status === "缺勤", `阶段10.8.驳回后考勤回滚为缺勤(实际 ${attRow && attRow.status})`);
  assert(Number((await remainF()).remain_hours) === 5, "阶段10.8.缺勤不扣课时(remain=5，课时留给补课)");

  // 10.9 清理请假联动验证订单（无缴费退费，可删）
  await ok("DELETE", `/finance/orders/${orderFId}`, undefined, adminToken, "阶段10.9.删除请假联动验证订单");
  untrack("order", orderFId);

  // ==================== 阶段 6：删除语义（admin） ====================
  // 6.1 删除有缴费/退费记录的订单 → 400 保护（v13）；清理缴费退费后订单可删
  const delOrderA = await api("DELETE", `/finance/orders/${orderAId}`, undefined, adminToken);
  assert(delOrderA.status === 400 && /缴费|退费/.test(delOrderA.json?.message || ""), "阶段6.1.删除有缴费/退费记录的订单应返回 400 保护");
  await ok("DELETE", `/finance/payments/${pay2Id}`, undefined, adminToken, "阶段6.1.删除订单缴费记录");
  untrack("payment", pay2Id);
  await ok("DELETE", `/finance/refunds/${refund1Id}`, undefined, adminToken, "阶段6.1.删除订单退费记录");
  untrack("refund", refund1Id);
  await ok("DELETE", `/finance/orders/${orderAId}`, undefined, adminToken, "阶段6.1.清理资金记录后删除订单");
  untrack("order", orderAId);
  const paysA = await ok("GET", `/finance/payments?${q({ order_id: orderAId })}`, undefined, adminToken, "阶段6.1.查询订单缴费");
  assert(paysA.list.length === 0, "阶段6.1.订单缴费已清理");
  const refundsA = await ok("GET", `/finance/refunds?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段6.1.查询退费记录");
  assert(!refundsA.list.some(r => r.order_id === orderAId), "阶段6.1.订单退费已清理");

  // 6.2 删除有业务记录的学生（保留 orderB）→ 期望 400（已知 bug：实际 500，预期失败）
  const delStudent = await api("DELETE", `/students/${studentId}`, undefined, adminToken);
  try {
    assert(
      delStudent.status === 400 && /报班|订单/.test(delStudent.json?.message || ""),
      "阶段6.2.删除有业务记录学生应返回 HTTP 400 且提示报班/订单"
    );
  } catch (e) {
    console.log(`   → 实际行为: HTTP ${delStudent.status} ${JSON.stringify(delStudent.json)}（已知 bug：删除学生未做业务校验，外键 RESTRICT 抛 500，预期失败）`);
  }
  const stillThere = await ok("GET", `/students?${q({ name: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段6.2.查询学生列表");
  assert(stillThere.list.some(s => s.id === studentId), "阶段6.2.学生仍存在（删除被拒绝）");

  // 6.4 删除有考勤记录的课程 → 期望 400（安排在 6.3 删学生之前，此时课程仍有考勤记录）
  const delCourse = await api("DELETE", `/courses/${courseId}`, undefined, adminToken);
  try {
    assert(delCourse.status === 400 && /考勤/.test(delCourse.json?.message || ""), "阶段6.4.删除有考勤的课程应返回 HTTP 400");
  } catch (e) {
    console.log(`   → 实际行为: HTTP ${delCourse.status} ${JSON.stringify(delCourse.json)}`);
  }

  // 6.3 删除剩余订单后删除学生 → 成功，且级联清理考勤/通知/线索关联
  await ok("DELETE", `/finance/orders/${orderBId}`, undefined, adminToken, "阶段6.3.删除剩余订单");
  untrack("order", orderBId);
  await ok("DELETE", `/students/${studentId}`, undefined, adminToken, "阶段6.3.删除无业务记录学生");
  untrack("student", studentId);

  const attRec = await ok("GET", `/attendance/records?${q({ student_id: studentId, pageSize: 100 })}`, undefined, adminToken, "阶段6.3.查询考勤记录");
  assert(attRec.list.length === 0, "阶段6.3.学生考勤记录已级联清理");
  const notifGone = await ok("GET", notifQ, undefined, adminToken, "阶段6.3.查询缺勤通知");
  assert(notifGone.list.length === 0, "阶段6.3.学生缺勤通知已级联清理");
  const leadsAfter = await ok("GET", `/leads?${q({ keyword: "e2e_", pageSize: 100 })}`, undefined, adminToken, "阶段6.3.查询线索列表");
  const leadAfter = leadsAfter.list.find(l => l.id === leadId);
  assert(leadAfter && !leadAfter.converted_name, "阶段6.3.线索转化关联已解除（converted_student_id=null，converted_name 为空）");

  // 6.5 删除有学生的班级 → 期望 400（先建临时学生）；删临时学生后班级可正常删除
  const tempStu = await ok("POST", "/students", { student_no: `e2e_S${STAMP}`, name: `e2e_临时_${STAMP}`, class_id: classId }, adminToken, "阶段6.5.创建临时学生");
  const tempStuId = tempStu.id;
  track("student", tempStuId);
  const delClass = await api("DELETE", `/classes/${classId}`, undefined, adminToken);
  try {
    assert(delClass.status === 400 && /学生/.test(delClass.json?.message || ""), "阶段6.5.删除有学生的班级应返回 HTTP 400");
  } catch (e) {
    console.log(`   → 实际行为: HTTP ${delClass.status} ${JSON.stringify(delClass.json)}`);
  }
  await ok("DELETE", `/students/${tempStuId}`, undefined, adminToken, "阶段6.5.删除临时学生");
  untrack("student", tempStuId);

  // ==================== 阶段 6.6：PUT 缺省字段回归（P3-A/P3-B 修复验证） ====================
  // 覆盖：node:sqlite 无法绑定 undefined，PUT 缺省字段不得再 500（须在删班级前执行）
  const stuPut = await ok("POST", "/students", { student_no: `e2e_PU${STAMP}`, name: "e2e_缺省PUT学生", class_id: classId }, adminToken, "阶段6.6.创建缺省PUT验证学生");
  const stuPutId = stuPut.id;
  track("student", stuPutId);
  // 只传必填字段（缺省 gender/phone/email/status）→ 应 200 且保留默认值
  const stuUpd = await api("PUT", `/students/${stuPutId}`, { student_no: `e2e_PU${STAMP}`, name: "e2e_缺省PUT学生改", class_id: classId }, adminToken);
  assert(stuUpd.status === 200, `阶段6.6.学生PUT缺省字段不500（实际 ${stuUpd.status}）`);
  const stuAfter = (await ok("GET", `/students?${q({ keyword: "e2e_PU", pageSize: 100 })}`, undefined, adminToken, "阶段6.6.查询学生")).list.find(s => s.id === stuPutId);
  assert(stuAfter && stuAfter.gender === "男" && stuAfter.status === "在读", "阶段6.6.学生PUT缺省字段保留默认值");
  // 班级 PUT 缺省 head_teacher_id → 应 200
  const clsUpd = await api("PUT", `/classes/${classId}`, { name: className }, adminToken);
  assert(clsUpd.status === 200, `阶段6.6.班级PUT缺省head_teacher_id不500（实际 ${clsUpd.status}）`);
  await ok("DELETE", `/students/${stuPutId}`, undefined, adminToken, "阶段6.6.删除缺省PUT验证学生");
  untrack("student", stuPutId);

  await ok("DELETE", `/classes/${classId}`, undefined, adminToken, "阶段6.5.删除空班级");
  untrack("class", classId);

  return adminToken;
}

// ==================== 清理与基线校验 ====================
async function cleanup(adminToken) {
  if (!adminToken) {
    console.log("[cleanup] 未获取 admin token，跳过清理（无法登录时需人工清理 e2e_ 数据）");
    return;
  }
  const items = [...created].sort((a, b) => (CLEANUP_ORDER[a.type] ?? 99) - (CLEANUP_ORDER[b.type] ?? 99));
  for (const { type, id } of items) {
    const path = pathOf(type, id);
    if (!path) continue;
    try {
      const r = await api("DELETE", path, undefined, adminToken);
      if (r.status >= 200 && r.status < 300) console.log(`[cleanup] 已删除 ${type}#${id}`);
      else console.log(`[cleanup] ${type}#${id} 删除返回 HTTP ${r.status}（可能已不存在，忽略）`);
    } catch (e) {
      console.log(`[cleanup] ${type}#${id} 清理失败（警告，不中断）: ${e.message}`);
    }
  }
}

/** 阶段 7：清理后基线校验 —— 各列表按 e2e_ 过滤，断言无残留 */
async function verifyNoResidue(adminToken) {
  if (!adminToken) return;
  const checks = [
    [`/students?${q({ name: "e2e_", pageSize: 100 })}`, d => d.list.length === 0, "阶段7.学生表无 e2e_ 残留"],
    [`/finance/orders?${q({ keyword: "e2e_", pageSize: 100 })}`, d => d.list.length === 0, "阶段7.订单表无 e2e_ 残留"],
    [`/notifications?${q({ keyword: "e2e_", pageSize: 100 })}`, d => d.list.length === 0, "阶段7.通知表无 e2e_ 残留"],
    // v13 设计：已转化线索不可删除（保护转化率统计），允许残留但须已解除学员关联
    [`/leads?${q({ keyword: "e2e_", pageSize: 100 })}`, d => d.list.every(l => l.status === "已转化" && !l.converted_name), "阶段7.线索表无未清理残留（已转化且解除关联可容忍）"],
    [`/classes?${q({ name: "e2e_", pageSize: 100 })}`, d => d.list.length === 0, "阶段7.班级表无 e2e_ 残留"],
    [`/courses?${q({ keyword: "e2e_", pageSize: 100 })}`, d => d.list.length === 0, "阶段7.课程表无 e2e_ 残留"],
    [`/schedules/all`, d => !d.some(s => String(s.class_name).startsWith("e2e_")), "阶段7.课表无 e2e_ 残留"],
    [`/schedule-adjustments?${q({ pageSize: 100 })}`, d => !d.list.some(a => String(a.class_name).startsWith("e2e_")), "阶段7.调课申请无 e2e_ 残留"],
    [`/makeup-classes?${q({ pageSize: 100 })}`, d => !d.list.some(m => String(m.student_name).startsWith("e2e_")), "阶段7.补课记录无 e2e_ 残留"]
  ];
  for (const [path, fn, label] of checks) {
    try {
      const data = await ok("GET", path, undefined, adminToken, label);
      assert(fn(data), label);
    } catch {
      // 单条基线校验失败不中断其余校验
    }
  }
}

// ==================== 执行入口 ====================
try {
  await runAll();
} catch (e) {
  if (e instanceof AssertionError) console.log(`\n[中断] 断言失败：${e.message}`);
  else console.log(`\n[异常中断] ${e.stack || e.message}`);
} finally {
  await cleanup(adminToken);
  await verifyNoResidue(adminToken);
}

console.log("\n================ 汇总 ================");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failedLabels.length) {
  console.log("FAIL 明细:");
  failedLabels.forEach(l => console.log(`  - ${l}`));
}
process.exitCode = failed === 0 ? 0 : 1;
