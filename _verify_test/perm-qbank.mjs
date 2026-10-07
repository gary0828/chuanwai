/**
 * 题库系统 · 权限矩阵与越权测试（M3）
 *
 * ★ 为什么必须单独测（K-011铁律：权限类功能必须 admin/teacher 双角色对照）：
 *   题库的权限模型**刻意不同于**项目既有的「teacher 仅本班」——
 *   题库是**校区共享资产**（任何老师都能看到并使用全部题目），
 *   但**只能改/删自己录入的**。
 *   ⇒ 只测 admin 会漏掉整类越权问题；只测 teacher 会漏掉管理能力。
 *
 * ★ 覆盖三个维度：
 *   1. 角色 × 操作 × 归属（admin全量 / teacher 自己的 / teacher 别人的）
 *   2. 凭证类型边界（qb_agent只能访问 /api/qbank，不能碰学生数据与工作台只读网关）
 *   3. 横向越权（改别人的题、删别人的题、批量里塞别人的 id）
 */
const API = (process.argv[2] || "http://127.0.0.1:18080").replace(/\/$/, "");

let pass = 0, fail = 0;
const failures = [];
let section = "";

function sec(t) {
  section = t;
  console.log(`\n${"─".repeat(58)}\n▸ ${t}\n${"─".repeat(58)}`);
}
function ok(l, d = "") { pass += 1; console.log(`  PASS  ${l}${d ? `\n        → ${d}` : ""}`); }
function bad(l, d = "") { fail += 1; failures.push(`[${section}] ${l}`); console.log(`  FAIL  ${l}${d ? `\n        → ${d}` : ""}`); }
function expect(l, a, e) {
  const same = JSON.stringify(a) === JSON.stringify(e);
  if (same) ok(l, `= ${JSON.stringify(a)}`);
  else bad(l, `实际=${JSON.stringify(a)} 期望=${JSON.stringify(e)}`);
}
function expectTrue(l, a, note = "") {
  if (a === true) ok(l, note || "= true");
  else bad(l, `实际=${JSON.stringify(a)}${note ? ` / ${note}` : ""}`);
}

/**
 * 登录并取回 user id。
 *
 * ★ 登录响应**不含 id**（源码 routes/auth.js 的 login 只有
 *   username/name/nickname/avatar/phone/roles/permissions），
 *   而 `/api/auth/me` 实测 404 —— 所以这里**从 JWT payload 解 id**，
 *   既不为测试新增端点，也不用回显任何凭据。
 */
/**
 * 学科 id（迁移 028 后建题必填 course_id）。
 * 动态取而不硬编码 —— 学科 id 会随数据库重建变化，硬编码迟早失效。
 */
async function resolveTestCourseId(token) {
  const r = await fetch(`${API}/api/qbank/subjects`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await r.json();
  const list = j?.data?.list || [];
  return list.find((s) => s.code === "MATH8")?.id || list[0]?.id || 1;
}

/** 学科 id，由 main 在登录后赋值；0 = 还没拿到，此时不注入 */
let TEST_COURSE_ID = 0;

/**
 * 给**需要学科的写操作**自动补 course_id。
 *
 * ★ 只覆盖三个写端点（建题 / 导入 / AI），GET 一律不动 ——
 *   列表类查询不带 course_id = 查全部学科，测试里有时正需要这个语义。
 * ★ 不覆盖调用方显式传的 course_id（多学科专项测试要自己指定）。
 */
function injectCourse(path, options) {
  if (!TEST_COURSE_ID) return options;
  if (!/^\/api\/qbank\/(questions|ocr\/|taxonomy\/(kp|chapter))/.test(path)) return options;
  const b = options.body;
  if (b === undefined || b === null) return options;
  // ① 对象 body（多数脚本：body 传对象，由请求层 stringify）
  if (typeof b === "object" && !Array.isArray(b)) {
    if (b.course_id !== undefined) return options;
    return { ...options, body: { ...b, course_id: TEST_COURSE_ID } };
  }
  // ② 字符串 body（verify-qbank.mjs 习惯先自己 JSON.stringify）
  //    ★ 必须支持：只处理对象会让这个脚本静默不注入 → 建题 400 → 后续断言全崩，
  //      而错误现象（JSON.parse(undefined)）离真因很远，很难定位。
  if (typeof b === "string") {
    try {
      const obj = JSON.parse(b);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return options;
      if (obj.course_id !== undefined) return options;
      return { ...options, body: JSON.stringify({ ...obj, course_id: TEST_COURSE_ID }) };
    } catch {
      return options;   // 不是 JSON，不动
    }
  }
  return options;
}

async function login(u, p) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p })
  });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error(`登录失败 ${u}: ${j.message || r.status}`);
  const [, payloadB64] = j.data.accessToken.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  return { token: j.data.accessToken, id: payload.id };
}
function call(token, path, o = {}) {
  o = injectCourse(path, o);   // ★ 自动补学科
  return fetch(`${API}${path}`, {
    method: o.method || "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body)
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

/**
 * 彻底清理某个关键词下的测试数据。
 *
 * ★★ 软删改造后的**必须两步**（2026-10-07，回收站上线后踩到）：
 *   `batch-delete` 现在只是"移入回收站"，测试数据会**堆在回收站里**，
 *   越跑越多。必须再调 `purge` 才真正删掉。
 *   实测证据：回收站里积了 8 条一期测试数据（全流程 甲/乙/丙/丁/导入1/导入2…）。
 */
async function purgeByKeyword(tk, tag) {
  const list = await call(tk, `/api/qbank/questions?keyword=${encodeURIComponent(tag)}&pageSize=100`);
  let n = 0;
  if (list.json.data.total > 0) {
    await call(tk, "/api/qbank/questions/batch-delete", {
      method: "POST", body: { ids: list.json.data.list.map((q) => q.id) }
    });
    n = list.json.data.total;
  }
  const rec = await call(tk, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(tag)}&pageSize=100`);
  if (rec.json.data.total > 0) {
    await call(tk, "/api/qbank/questions/purge", {
      method: "POST", body: { ids: rec.json.data.list.map((q) => q.id) }
    });
  }
  return n;
}

const TAG = "权限";
const adminLogin = await login("admin", process.env.ADMIN_PW || "admin123456");
TEST_COURSE_ID = await resolveTestCourseId(adminLogin);   // ★ 见 injectCourse 注释
const teacherLogin = await login("teacher", process.env.TEACHER_PW || "teacher123456");
const admin = adminLogin.token;
const teacher = teacherLogin.token;

console.log(`\n${"═".repeat(58)}\n  题库系统 · 权限矩阵与越权测试\n  API: ${API}\n${"═".repeat(58)}`);

// 清理
await purgeByKeyword(admin, TAG);

// ══════════════════════════════════════════════════════════════════════
sec("1. 造数据：admin 录 1 道、teacher 录 1 道");
const adminQ = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} admin录入的题`, options: ["甲", "乙"], answer: "甲", source: "自编" }
});
const adminQid = adminQ.json.data.id;
ok("admin 建题", `id=${adminQid}`);

const teacherQ = await call(teacher, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} teacher录入的题`, options: ["甲", "乙"], answer: "甲", source: "自编" }
});
const teacherQid = teacherQ.json.data.id;
ok("teacher 建题", `id=${teacherQid}`);

// 确认归属正确（否则后面的权限断言全是空的）
const aDet = await call(admin, `/api/qbank/questions/${adminQid}`);
const tDet = await call(admin, `/api/qbank/questions/${teacherQid}`);
const adminId = adminLogin.id;
const teacherId = teacherLogin.id;
console.log(`        admin.id=${adminId} teacher.id=${teacherId}`);
console.log(`        adminQ.created_by=${aDet.json.data.created_by}  teacherQ.created_by=${tDet.json.data.created_by}`);
expectTrue("归属正确：admin 题 created_by=adminId", aDet.json.data.created_by === adminId, `= ${aDet.json.data.created_by}`);
expectTrue("归属正确：teacher 题 created_by=teacherId", tDet.json.data.created_by === teacherId, `= ${tDet.json.data.created_by}`);

// ══════════════════════════════════════════════════════════════════════
sec("2. 读取权：题库是校区共享资产（两角色都能看到全部）");
for (const [name, tk] of [["admin", admin], ["teacher", teacher]]) {
  const r = await call(tk, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
  expectTrue(`${name} 能看到全部题（共享，非仅本人）`, r.json.data.total === 2, `看到 ${r.json.data.total} 道`);
}
const tSeesAdmin = await call(teacher, `/api/qbank/questions?keyword=${encodeURIComponent(TAG + " admin")}`);
expectTrue("★ teacher 能看到 admin 录入的题", tSeesAdmin.json.data.total === 1, `= ${tSeesAdmin.json.data.total} 条`);
const tOv = await call(teacher, "/api/qbank/overview");
expectTrue("teacher 能看概览", tOv.json.success === true, `total=${tOv.json.data.total}`);
const tFc = await call(teacher, "/api/qbank/facets");
expectTrue("teacher 能看筛选侧栏", tFc.json.success === true, `chapters=${tFc.json.data.chapters?.length}`);

// ══════════════════════════════════════════════════════════════════════
sec("3. 修改权：teacher 只能改自己录入的");
const tEditOwn = await call(teacher, `/api/qbank/questions/${teacherQid}`, {
  method: "PUT", body: { difficulty: 4 }
});
expect("★ teacher 改自己录入的 → 成功", tEditOwn.status, 200);

const tEditOther = await call(teacher, `/api/qbank/questions/${adminQid}`, {
  method: "PUT", body: { difficulty: 1 }
});
expect("★ teacher 改 admin 录入的 → 403", tEditOther.status, 403);
expectTrue("★ 403 提示说明了原因（不是「不存在」）",
  tEditOther.json.message.includes("其他老师"),
  `= ${tEditOther.json.message}`);

// 验证 admin 题确实没被改（403 不是「改了但报错」）
const aAfter = await call(admin, `/api/qbank/questions/${adminQid}`);
expect("★ 被拒的修改确实未生效（难度仍 3）", aAfter.json.data.difficulty, 3);

const aEditTeacher = await call(admin, `/api/qbank/questions/${teacherQid}`, {
  method: "PUT", body: { difficulty: 5 }
});
expect("★ admin 改 teacher 录入的 → 成功（admin 全量）", aEditTeacher.status, 200);

// ══════════════════════════════════════════════════════════════════════
sec("4. 删除权：teacher 只能删自己录入的");
const tDelOther = await call(teacher, `/api/qbank/questions/${adminQid}`, { method: "DELETE" });
expect("★ teacher 删 admin 录入的 → 403", tDelOther.status, 403);
const aStillThere = await call(admin, `/api/qbank/questions/${adminQid}`);
expect("★ 被拒的删除确实未生效（仍能查到）", aStillThere.status, 200);

const aDelTeacher = await call(admin, `/api/qbank/questions/${teacherQid}`, { method: "DELETE" });
expect("★ admin 删 teacher 录入的 → 成功", aDelTeacher.status, 200);

// ══════════════════════════════════════════════════════════════════════
sec("5. HTTP 语义：404（不存在）≠ 403（无权限）");
const notExist = await call(admin, "/api/qbank/questions/99999999", { method: "DELETE" });
expect("删不存在的题 → 404", notExist.status, 404);
const notExistPut = await call(admin, "/api/qbank/questions/99999999", {
  method: "PUT", body: { difficulty: 3 }
});
expect("改不存在的题 → 404", notExistPut.status, 404);
expectTrue("★ 两者状态码不同（语义正确）",
  notExist.status !== tDelOther.status,
  `404 vs ${tDelOther.status}`);

// ══════════════════════════════════════════════════════════════════════
sec("6. 批量操作里的越权（横向：混装别人的 id）");
//★ 必须现造一道 teacher 自己的题：第 4 节里 teacherQid 已被 admin 删除，
//   直接复用会让「应该删1 道」变成「删0 道」，测出来的是数据状态而非权限逻辑。
const mixOwn = await call(teacher, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} teacher批量删测试题`, options: ["甲", "乙"], answer: "甲", source: "自编" }
});
const mixOwnId = mixOwn.json.data.id;
ok("现造 teacher 自己的题（供批量删测试）", `id=${mixOwnId}`);

const mix = await call(teacher, "/api/qbank/questions/batch-delete", {
  method: "POST", body: { ids: [adminQid, mixOwnId] }
});
expect("★ 批量删（1 自己的 + 1 别人的）成功返回", mix.json.success, true);
expect("★ 只删了有权的1 道", mix.json.data.deleted, 1);
expect("★ 如实回报跳过 1 道", mix.json.data.skipped, 1);
expectTrue("★ 提示语说明了跳过", mix.json.data.message.includes("跳过"), `= ${mix.json.data.message}`);
const adminSurvives = await call(admin, `/api/qbank/questions/${adminQid}`);
expect("★ 别人的题真的还在", adminSurvives.status, 200);

// 批量改状态同理
const freshOwn = await call(teacher, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} teacher批量改状态测试题`, options: ["甲", "乙"], answer: "甲", source: "自编" }
});
const freshOwnId = freshOwn.json.data.id;
const mixStatus = await call(teacher, "/api/qbank/questions/batch-status", {
  method: "POST", body: { ids: [adminQid, freshOwnId], status: "已归档" }
});
expect("★ 批量改状态：只改有权的 1 道", mixStatus.json.data.updated, 1);
expect("★ 别人的题被跳过", mixStatus.json.data.skipped, 1);
const adminStillDraft = await call(admin, `/api/qbank/questions/${adminQid}`);
expect("★ 别人的题状态未被改", adminStillDraft.json.data.status, "草稿");
console.log(`        实际 updated=${mixStatus.json.data.updated} skipped=${mixStatus.json.data.skipped}`);

// ══════════════════════════════════════════════════════════════════════
sec("7. 凭证类型边界：qb_agent 只能访问 /api/qbank");
const tk = await call(admin, "/api/ai/sso/ticket", {
  method: "POST", body: { origin: API, target: "qbank" }
});
const vf = await call(null, "/api/ai/sso/verify", { method: "POST", body: { ticket: tk.json.data.ticket } });
expectTrue("免登换会话成功", vf.json.success === true, `用户=${vf.json.data?.name}`);
const qb = vf.json.data.qbAgentToken;
expectTrue("★ 签发了 qbAgentToken", typeof qb === "string" && qb.length > 20, `长度=${qb?.length}`);

const qbQ = await call(qb, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
expectTrue("qb_agent 能读 /api/qbank", qbQ.json.success === true, `total=${qbQ.json.data.total}`);
const qbWrite = await call(qb, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} qb凭证建的题`, options: ["甲", "乙"], answer: "甲", source: "自编" }
});
expectTrue("★ qb_agent 能写（题库要可写，这是它与 ai_agent 的关键差别）",
  qbWrite.json.success === true, `id=${qbWrite.json.data?.id}`);
if (qbWrite.json.data?.id) {
  await call(qb, `/api/qbank/questions/${qbWrite.json.data.id}`, { method: "DELETE" });
}

console.log("\n  ★ 越权测试（qb_agent 访问其他域，必须全被拒）:");
//★ 路径取自源码真实端点（grep 各routes/*.js 的 router.get/post）——
//   之前凭印象写的 /api/growth/students 与 /api/finance/overview **根本不存在**（404），
//   404 反而「看起来」像被拒了，实际是没打到点上。**越权测试必须打到真实存在的端点**。
const forbiddenTargets = [
  ["/api/students", "学员档案"],
  ["/api/agent/context", "AI 工作台只读网关"],
  ["/api/growth/students/1/timeline", "成长档案"],
  ["/api/growth/classes/1/growth", "班级成长"],
  ["/api/finance/orders", "财务订单"],
  ["/api/finance/payments", "缴费流水"],
  ["/api/users", "员工账号"],
  ["/api/settings", "系统配置"],
  ["/api/analytics/overview", "分析看板"],
  ["/api/reports/students/1", "学员报告"]
];
for (const [path, label] of forbiddenTargets) {
  const r = await call(qb, path);
  if (r.status === 403) ok(`qb_agent 访问 ${label} → 403 被拒`, `path=${path}`);
  else bad(`qb_agent 访问 ${label} 未被拒`, `path=${path} status=${r.status}`);
}
// 凭证类型不可混用
const tkWork = await call(admin, "/api/ai/sso/ticket", { method: "POST", body: { origin: API } });
const vfWork = await call(null, "/api/ai/sso/verify", { method: "POST", body: { ticket: tkWork.json.data.ticket } });
const aiTok = vfWork.json.data.agentToken;
const aiToQb = await call(aiTok, "/api/qbank/overview");
if (aiToQb.status === 403) ok("★ ai_agent（只读凭证）访问题库 → 403 被拒", `status=403`);
else bad("★ ai_agent 竟能访问题库（凭证类型混用！）", `status=${aiToQb.status}`);

// ══════════════════════════════════════════════════════════════════════
sec("8. 权限相关端点的角色限制");
// 未登录写入类端点
for (const [m, path] of [["POST", "/api/qbank/questions"], ["PUT", "/api/qbank/questions/1"], ["DELETE", "/api/qbank/questions/1"], ["POST", "/api/qbank/questions/import"], ["POST", "/api/qbank/questions/batch-delete"], ["POST", "/api/qbank/questions/batch-status"], ["POST", "/api/qbank/questions/check-duplicate"], ["POST", "/api/qbank/ocr/recognize"], ["POST", "/api/qbank/ocr/generate"]]) {
  const r = await call(null, path, { method: m, body: {} });
  expectTrue(`未登录 ${m} ${path} → 401`, r.status === 401, `status=${r.status}`);
}

// ══════════════════════════════════════════════════════════════════════
sec("9. 清理");
const left = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
// ★ 两步清理（软删→彻底删）
await purgeByKeyword(admin, TAG);
const fin = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
const finRec = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
expect("测试数据已清空（列表）", fin.json.data.total, 0);
expect("测试数据已清空（回收站）", finRec.json.data.total, 0);

console.log(`\n${"═".repeat(58)}`);
console.log(`  结果：PASS ${pass} / FAIL ${fail}`);
if (failures.length) { console.log(`\n  失败清单：`); failures.forEach((f) => console.log(`    ✗ ${f}`)); }
console.log(`${"═".repeat(58)}\n`);
process.exit(fail === 0 ? 0 : 1);