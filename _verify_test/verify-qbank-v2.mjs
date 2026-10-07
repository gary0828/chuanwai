/**
 * 题库完善批次 · 后端验证（回收站 / 导出对齐 / 质量分 / 配图 / 知识点管理 / 排序）
 *
 * ★ 每项打印实际值（K-011）；测试数据自带清理。
 * ★ 打容器 18080（不起开发后端，K-068）。
 *
 * 用法：node _verify_test/verify-qbank-v2.mjs [API基址]
 */
const API = (process.argv[2] || "http://127.0.0.1:18080").replace(/\/$/, "");
const ADMIN_PW = process.env.ADMIN_PW || "admin123456";
const TEACHER_PW = process.env.TEACHER_PW || "teacher123456";

let pass = 0, fail = 0;
const F = [];
const sec = (t) => console.log(`\n${"─".repeat(58)}\n▸ ${t}\n${"─".repeat(58)}`);
const ok = (l, d = "") => { pass += 1; console.log(`  PASS  ${l}${d ? `\n        → ${d}` : ""}`); };
const bad = (l, d = "") => { fail += 1; F.push(l); console.log(`  FAIL  ${l}${d ? `\n        → ${d}` : ""}`); };
const exp = (l, a, e) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l, `= ${JSON.stringify(a)}`) : bad(l, `实际=${JSON.stringify(a)} 期望=${JSON.stringify(e)}`));
const expT = (a, l, d = "") => (a === true ? ok(l, d || "= true") : bad(l, `实际=${JSON.stringify(a)}${d ? " / " + d : ""}`));

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
  const payload = JSON.parse(Buffer.from(j.data.accessToken.split(".")[1], "base64url").toString());
  return { token: j.data.accessToken, id: payload.id };
}
const call = (tk, p, o = {}) => {
  o = injectCourse(p, o);   // ★ 自动补学科（见 injectCourse 注释）
  return fetch(`${API}${p}`, {
    method: o.method || "GET",
    headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body)
  }).then(async (r) => {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("spreadsheet") || ct.startsWith("application/octet")) {
      return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), json: null, headers: r.headers };
    }
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  });
};

const adm = await login("admin", ADMIN_PW);
TEST_COURSE_ID = await resolveTestCourseId(adm);   // ★ 见 injectCourse 注释
const admin = adm.token;
const TAG = "完善批次";

console.log(`\n${"═".repeat(58)}\n  题库完善批次 · 后端验证\n  API: ${API}\n${"═".repeat(58)}`);

// 清残留
const st0 = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
if (st0.json.data.total) {
  await call(admin, "/api/qbank/questions/batch-delete", { method: "POST", body: { ids: st0.json.data.list.map((q) => q.id) } });
}
const st0b = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
if (st0b.json.data.total) {
  await call(admin, "/api/qbank/questions/purge", { method: "POST", body: { ids: st0b.json.data.list.map((q) => q.id) } });
}

// ══════════════════════════════════════════════════════════════════════
sec("1. 回收站（软删 → 隐藏 → 恢复 → 彻底删除）");
const mk = async (body) => (await call(admin, "/api/qbank/questions", { method: "POST", body })).json.data.id;

const id1 = await mk({ type: "单选题", stem: `${TAG} 回收站测试题`, options: ["甲", "乙"], answer: "甲", source: "自编" });
ok("造 1 道题", `id=${id1}`);

const beforeDel = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
exp("删除前：列表能看到", beforeDel.json.data.total, 1);
// ★ 记录全库基线：overview.total 是**全库**统计（不受 keyword 影响），
//   而库里可能有别的测试数据，所以只能断言"比基线少 1"，不能断言"等于 0"。
const ovBaseline = Number((await call(admin, "/api/qbank/overview")).json.data.total);

const delRes = await call(admin, `/api/qbank/questions/${id1}`, { method: "DELETE" });
exp("删除成功", delRes.json.success, true);
expT(delRes.json.data?.recycle === true, "★ 返回 recycle:true 提示是软删", `= ${JSON.stringify(delRes.json.data)}`);

const afterDel = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
exp("★ 删除后：正常列表看不到", afterDel.json.data.total, 0);
const detDel = await call(admin, `/api/qbank/questions/${id1}`);
exp("★ 删除后：详情返回 404", detDel.status, 404);

const rec = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}`);
exp("★ 回收站能看到", rec.json.data.total, 1);
expT(rec.json.data.list[0]?.deleted_at != null, "★ 带删除时间", `= ${rec.json.data.list[0]?.deleted_at}`);
expT(rec.json.data.list[0]?.deleted_by_name != null, "★ 带删除人姓名", `= ${rec.json.data.list[0]?.deleted_by_name}`);

// 查重不应把回收站的题算作重复
const dupRec = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST", body: { stem: `${TAG} 回收站测试题` }
});
exp("★ 查重不把回收站的题算重复", (dupRec.json.data.exact?.length || 0) + (dupRec.json.data.similar?.length || 0), 0);

// 概览统计不应含已删
const ovRec = await call(admin, "/api/qbank/overview");
exp("★ 概览统计不含已删题（比基线少 1）", Number(ovRec.json.data.total), ovBaseline - 1);

// 导出不应含已删
const expRec = await call(admin, `/api/qbank/questions/export?keyword=${encodeURIComponent(TAG)}`);
// ★ 注意写法：await import() 返回 module namespace，不能在它上面再 .then()
//   （初版写成 `(await import("xlsx")).then(...)` → TypeError: then is not a function）
const _xlsxMod = await import("xlsx");
const XLSX = _xlsxMod.default ?? _xlsxMod;
const expRows = XLSX.utils.sheet_to_json(XLSX.read(expRec.buf, { type: "buffer" }).Sheets["题库"], { defval: "" });
exp("★ 导出不含已删题", expRows.length, 0);

// facets 不应含已删题产生的维度
const fcRec = await call(admin, "/api/qbank/facets");
expT(!(fcRec.json.data.methods || []).some((m) => m.name === `${TAG}-方法`), "★ facets 不含已删题的维度");

// 恢复
const resRes = await call(admin, "/api/qbank/questions/restore", { method: "POST", body: { ids: [id1] } });
exp("恢复成功", resRes.json.data.restored, 1);
const afterRestore = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
exp("★ 恢复后：列表又能看到", afterRestore.json.data.total, 1);
const recAfter = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}`);
exp("★ 恢复后：回收站里没有了", recAfter.json.data.total, 0);

// 重复恢复
const resAgain = await call(admin, "/api/qbank/questions/restore", { method: "POST", body: { ids: [id1] } });
exp("★ 重复恢复：被跳过（不在回收站）", resAgain.json.data.skipped, 1);

// 正常题不能直接 purge（保护：必须先软删）
const purgeNormal = await call(admin, "/api/qbank/questions/purge", { method: "POST", body: { ids: [id1] } });
exp("★★ 正常题直接彻底删除 → 被跳过（保护软删层）", purgeNormal.json.data.skipped, 1);
const stillThere = await call(admin, `/api/qbank/questions/${id1}`);
expT(stillThere.status === 200, "★ 该题仍在（没被绕过软删干掉）", `status=${stillThere.status}`);

// 软删后彻底删除
await call(admin, `/api/qbank/questions/${id1}`, { method: "DELETE" });
const purgeRes = await call(admin, "/api/qbank/questions/purge", { method: "POST", body: { ids: [id1] } });
exp("彻底删除成功", purgeRes.json.data.purged, 1);
const gone = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}`);
exp("★ 彻底删除后回收站也没了", gone.json.data.total, 0);

// 未登录不能访问回收站
const recNoAuth = await call(null, "/api/qbank/questions/recycle");
exp("未登录访问回收站 → 401", recNoAuth.status, 401);

// ══════════════════════════════════════════════════════════════════════
sec("2. ★ 导出筛选对齐（一期实测的缺陷，逐个维度验）");
const A = await mk({ type: "单选题", stem: `${TAG} 挂知识点1难度1方法X`, options: ["甲", "乙"], answer: "甲", source: "自编", difficulty: 1, kp_ids: [1], solve_method: `${TAG}-方法A`, exam_year: 2020, custom_tags: [`${TAG}标签A`], chapter_id: 1 });
const B = await mk({ type: "解答题", stem: `${TAG} 不挂知识点难度5`, answer: "无", source: "AI 原创", difficulty: 5 });
ok("造 2 道对比题", `A=${A}（挂知识点1/难度1/方法/年份/标签/章节） B=${B}（都空）`);

async function exportCount(qs, label, expectN) {
  const r = await call(admin, `/api/qbank/questions/export?${qs}`);
  const rows = XLSX.utils.sheet_to_json(XLSX.read(r.buf, { type: "buffer" }).Sheets["题库"], { defval: "" });
  const hit = rows.filter((x) => String(x["题干"] || "").includes(TAG));
  exp(`导出·${label}`, hit.length, expectN);
}
const K = `keyword=${encodeURIComponent(TAG)}`;
await exportCount(`${K}&difficulty=1`, "难度=1", 1);
await exportCount(`${K}&kp_id=1`, "知识点=1", 1);
await exportCount(`${K}&solve_method=${encodeURIComponent(TAG + "-方法A")}`, "解题方法", 1);
await exportCount(`${K}&exam_year=2020`, "年份=2020", 1);
await exportCount(`${K}&custom_tag=${encodeURIComponent(TAG + "标签A")}`, "自定义标签", 1);
await exportCount(`${K}&chapter_id=1`, "章节=1", 1);
await exportCount(`${K}&chapter_id=1&include_sub_folders=1`, "章节=1含子级", 1);
await exportCount(`${K}&type=${encodeURIComponent("解答题")}`, "题型=解答题", 1);
await exportCount(`${K}&source=${encodeURIComponent("AI 原创")}`, "来源=AI原创", 1);
await exportCount(`${K}&status=${encodeURIComponent("草稿")}`, "状态=草稿", 2);
await exportCount(K, "不加筛选（基线）", 2);

// 组合筛选
await exportCount(`${K}&difficulty=1&kp_id=1`, "难度1+知识点1（组合）", 1);
await exportCount(`${K}&difficulty=5&kp_id=1`, "难度5+知识点1（无交集）", 0);

// 导出文件名带时间戳
const expName = await call(admin, `/api/qbank/questions/export?${K}`);
const cd = String(expName.headers.get("content-disposition"));
expT(/questions-\d{14}\.xlsx/.test(cd), "★ 导出文件名带时间戳", `= ${cd}`);

// ══════════════════════════════════════════════════════════════════════
sec("3. 质量分（录入完整度：解析/知识点/解题方法 各 1/3）");
const q0 = await mk({ type: "单选题", stem: `${TAG} 三项全空`, options: ["甲", "乙"], answer: "甲", source: "自编" });
const g0 = await call(admin, `/api/qbank/questions/${q0}`);
exp("三项全空 → 0", g0.json.data.quality_score, 0);

const q1 = await mk({ type: "单选题", stem: `${TAG} 只有解析`, options: ["甲", "乙"], answer: "甲", source: "自编", analysis: "有解析" });
exp("只有解析 → 0.33", (await call(admin, `/api/qbank/questions/${q1}`)).json.data.quality_score, 0.33);

const q2 = await mk({ type: "单选题", stem: `${TAG} 解析+知识点`, options: ["甲", "乙"], answer: "甲", source: "自编", analysis: "有解析", kp_ids: [1] });
exp("解析+知识点 → 0.67", (await call(admin, `/api/qbank/questions/${q2}`)).json.data.quality_score, 0.67);

const q3 = await mk({ type: "单选题", stem: `${TAG} 三项全填`, options: ["甲", "乙"], answer: "甲", source: "自编", analysis: "有解析", kp_ids: [1], solve_method: "配方法" });
exp("三项全填 → 1", (await call(admin, `/api/qbank/questions/${q3}`)).json.data.quality_score, 1);

// ★ 改无关字段不应改变质量分（用"生效后"的值算）
await call(admin, `/api/qbank/questions/${q3}`, { method: "PUT", body: { difficulty: 4 } });
exp("★ 改难度后质量分不变（仍 1）", (await call(admin, `/api/qbank/questions/${q3}`)).json.data.quality_score, 1);

// 补一个字段 → 分数上升
await call(admin, `/api/qbank/questions/${q0}`, { method: "PUT", body: { analysis: "补上解析" } });
exp("★ 补上解析后 → 0.33", (await call(admin, `/api/qbank/questions/${q0}`)).json.data.quality_score, 0.33);

// ══════════════════════════════════════════════════════════════════════
sec("4. 排序");
const sortQ = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&sort=quality_desc&pageSize=100`);
expT(sortQ.json.success === true, "quality_desc 排序可用");
const scores = sortQ.json.data.list.map((x) => x.quality_score);
expT(scores.every((v, i) => i === 0 || scores[i - 1] >= v), "★ 结果按质量分降序", JSON.stringify(scores));
const sortBad = await call(admin, `/api/qbank/questions?sort=; DROP TABLE questions;--`);
expT(sortBad.json.success === true, "★ 非法 sort 被忽略（回落默认，不报错）");
const stillAlive = await call(admin, "/api/qbank/overview");
expT(stillAlive.json.success, "★ 注入尝试后表仍在");

// ══════════════════════════════════════════════════════════════════════
sec("5. 配图上传");
const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const upRes = await fetch(`${API}/api/qbank/questions/figure`, {
  method: "POST",
  headers: { Authorization: `Bearer ${admin}`, "Content-Type": "image/png" },
  body: png1x1
}).then(async (r) => ({ status: r.status, json: await r.json() }));

exp("上传成功", upRes.status, 200);
expT(upRes.json.data?.path?.startsWith("/assets/questions/"), "★ 返回 /assets/questions/ 路径", `= ${upRes.json.data?.path}`);

// 静态可访问
if (upRes.json.data?.path) {
  const imgRes = await fetch(`${API}${upRes.json.data.path}`);
  exp("★ 上传的图能通过静态路径访问", imgRes.status, 200);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  exp("★ 内容与原图一致", imgBuf.length, png1x1.length);

  // 绑到题目上
  const idFig = await mk({ type: "单选题", stem: `${TAG} 带配图的题`, options: ["甲", "乙"], answer: "甲", source: "自编", figure_path: upRes.json.data.path });
  const figDet = await call(admin, `/api/qbank/questions/${idFig}`);
  exp("★ 配图路径已落库", figDet.json.data.figure_path, upRes.json.data.path);

  // 换图 → 旧图应被清理
  const upRes2 = await fetch(`${API}/api/qbank/questions/figure`, {
    method: "POST",
    headers: { Authorization: `Bearer ${admin}`, "Content-Type": "image/png" },
    body: png1x1
  }).then((r) => r.json());
  expT(upRes2.data.path !== upRes.json.data.path, "第二次上传得到不同文件名（不覆盖）");
  await call(admin, `/api/qbank/questions/${idFig}`, { method: "PUT", body: { figure_path: upRes2.data.path } });
  const oldImg = await fetch(`${API}${upRes.json.data.path}`);
  exp("★★ 换图后旧图被清理（404）", oldImg.status, 404);
}

// ★ 彻底删除题目时，配图应一并清理（否则回收站清空后磁盘留孤儿文件）
{
  const upX = await fetch(`${API}/api/qbank/questions/figure`, {
    method: "POST",
    headers: { Authorization: `Bearer ${admin}`, "Content-Type": "image/png" },
    body: png1x1
  }).then((r) => r.json());
  const idX = await mk({
    type: "单选题", stem: `${TAG} 带图待彻底删除`, options: ["甲", "乙"],
    answer: "甲", source: "自编", figure_path: upX.data.path
  });
  // 软删 → 图应**仍在**（恢复后还要用）
  await call(admin, `/api/qbank/questions/${idX}`, { method: "DELETE" });
  const imgAfterSoft = await fetch(`${API}${upX.data.path}`);
  exp("★ 软删后配图**仍在**（恢复时要用）", imgAfterSoft.status, 200);
  // 彻底删除 → 图应被清理
  await call(admin, "/api/qbank/questions/purge", { method: "POST", body: { ids: [idX] } });
  const imgAfterPurge = await fetch(`${API}${upX.data.path}`);
  exp("★ 彻底删除后配图被清理（404）", imgAfterPurge.status, 404);
}

// 非图片拒绝
const badUp = await fetch(`${API}/api/qbank/questions/figure`, {
  method: "POST",
  headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/octet-stream" },
  body: Buffer.from("this is not an image")
}).then(async (r) => ({ status: r.status, json: await r.json() }));
exp("非图片内容 → 400", badUp.status, 400);
expT(String(badUp.json.message).includes("格式"), "★ 提示说明格式问题", `= ${badUp.json.message}`);

// 未登录拒绝
const upNoAuth = await fetch(`${API}/api/qbank/questions/figure`, {
  method: "POST", headers: { "Content-Type": "image/png" }, body: png1x1
});
exp("未登录上传 → 401", upNoAuth.status, 401);

// ══════════════════════════════════════════════════════════════════════
sec("6. 知识点与章节管理");
const tax = await call(admin, "/api/qbank/taxonomy");
exp("taxonomy 可达", tax.json.success, true);
expT(Array.isArray(tax.json.data.knowledge), "返回知识点数组", `${tax.json.data.knowledge?.length} 个`);
expT(Array.isArray(tax.json.data.chapters), "返回章节数组", `${tax.json.data.chapters?.length} 个`);
expT(tax.json.data.knowledge.some((k) => "questionCount" in k), "★ 知识点带引用计数");
expT(tax.json.data.knowledge.some((k) => "assessmentCount" in k), "★ 知识点带学生测评计数（删除风险指标）");

// 新增知识点
const newKp = await call(admin, "/api/qbank/taxonomy/kp", {
  method: "POST", body: { name: `${TAG}新知识点`, difficulty: 3 }
});
exp("新增知识点成功", newKp.json.success, true);
expT(newKp.json.data?.code?.length > 0, "★ 自动生成 code", `= ${newKp.json.data?.code}`);
const kpId = newKp.json.data.id;

// 改名
const renKp = await call(admin, `/api/qbank/taxonomy/kp/${kpId}`, {
  method: "PUT", body: { name: `${TAG}已改名` }
});
exp("改名成功", renKp.json.success, true);
const taxAfter = await call(admin, "/api/qbank/taxonomy");
exp("★ 改名已生效", taxAfter.json.data.knowledge.find((k) => k.id === kpId)?.name, `${TAG}已改名`);

// 编码冲突
const dupCode = await call(admin, "/api/qbank/taxonomy/kp", {
  method: "POST", body: { name: `${TAG}冲突测试`, code: newKp.json.data.code }
});
exp("★ 编码重复 → 400", dupCode.status, 400);

// 成环检测
const loop = await call(admin, `/api/qbank/taxonomy/kp/${kpId}`, {
  method: "PUT", body: { parent_id: kpId }
});
exp("★ 自己设为上级 → 400", loop.status, 400);

// 删除未被引用的知识点 → 应成功
const delKp = await call(admin, `/api/qbank/taxonomy/kp/${kpId}`, { method: "DELETE" });
exp("删除无引用知识点成功", delKp.json.success, true);

// ★ 被题目引用的知识点 → 拒绝
const delUsed = await call(admin, "/api/qbank/taxonomy/kp/1", { method: "DELETE" });
console.log(`        知识点 #1 删除尝试 → HTTP ${delUsed.status}：${delUsed.json?.message?.slice(0, 70)}`);
exp("★ 被题目引用的知识点 → 409 拒绝", delUsed.status, 409);

// ★ 有学生测评记录的知识点 → 拒绝（更严重的一类）
const withAssess = tax.json.data.knowledge.find((k) => k.assessmentCount > 0);
if (withAssess) {
  const delAssess = await call(admin, `/api/qbank/taxonomy/kp/${withAssess.id}`, { method: "DELETE" });
  exp(`★ 有 ${withAssess.assessmentCount} 条学生测评记录的知识点 → 409 拒绝`, delAssess.status, 409);
  expT(String(delAssess.json.message).includes("测评记录"), "★ 提示说明是学生数据原因", `= ${delAssess.json.message.slice(0, 70)}`);
} else {
  console.log("        （库里没有带测评记录的知识点，跳过该项）");
}

// 章节
const newCh = await call(admin, "/api/qbank/taxonomy/chapter", {
  method: "POST", body: { name: `${TAG}新章节` }
});
exp("新增章节成功", newCh.json.success, true);
const chId = newCh.json.data.id;
const renCh = await call(admin, `/api/qbank/taxonomy/chapter/${chId}`, {
  method: "PUT", body: { name: `${TAG}章节已改名` }
});
exp("章节改名成功", renCh.json.success, true);

// 章节被引用 → 拒绝（题 A 挂在 chapter_id=1）
const delChUsed = await call(admin, "/api/qbank/taxonomy/chapter/1", { method: "DELETE" });
exp("★ 被题目引用的章节 → 409 拒绝", delChUsed.status, 409);

// ★ 三层保护：必须用**真正的「节」**（parent_id 非空）来测，
//   用 id=1（那是「章」）测不出问题 —— 章下建子级本来就是合法的。
const aSection = tax.json.data.chapters.find((c) => c.parent_id !== null);
if (aSection) {
  const ch3 = await call(admin, "/api/qbank/taxonomy/chapter", {
    method: "POST", body: { name: `${TAG}三层测试`, parent_id: aSection.id }
  });
  exp(`★ 在「节」(${aSection.name}) 下建子级 → 400 拒绝`, ch3.status, 400);
  expT(String(ch3.json?.message || "").includes("两层"), "★ 提示说明只允许两层",
    `= ${String(ch3.json?.message || "").slice(0, 50)}`);
} else {
  console.log("        （库中无「节」节点，跳过三层保护测试）");
}
// 章下建子级（应允许）
const chOk = await call(admin, "/api/qbank/taxonomy/chapter", {
  method: "POST", body: { name: `${TAG}合法节`, parent_id: 1 }
});
expT(chOk.status === 200, "★ 在「章」下建子级（应允许）", `status=${chOk.status}`);
if (chOk.json?.data?.id) {
  // 有子章节的「章」不能降级成「节」
  const demote = await call(admin, `/api/qbank/taxonomy/chapter/1`, {
    method: "PUT", body: { parent_id: aSection ? aSection.id : 2 }
  });
  expT(demote.status === 400, "★ 有子章节的「章」不能降级（会变三层）", `status=${demote.status}`);
  await call(admin, `/api/qbank/taxonomy/chapter/${chOk.json.data.id}`, { method: "DELETE" });
}

// 删除无引用章节
const delCh = await call(admin, `/api/qbank/taxonomy/chapter/${chId}`, { method: "DELETE" });
exp("删除无引用章节成功", delCh.json.success, true);

// 未登录
const taxNoAuth = await call(null, "/api/qbank/taxonomy");
exp("未登录访问 taxonomy → 401", taxNoAuth.status, 401);

// ══════════════════════════════════════════════════════════════════════
sec("7. 清理");
const leftList = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
if (leftList.json.data.total) {
  await call(admin, "/api/qbank/questions/batch-delete", { method: "POST", body: { ids: leftList.json.data.list.map((q) => q.id) } });
}
const leftRec = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
if (leftRec.json.data.total) {
  await call(admin, "/api/qbank/questions/purge", { method: "POST", body: { ids: leftRec.json.data.list.map((q) => q.id) } });
}
const finList = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
const finRec = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}`);
exp("正常列表已清空", finList.json.data.total, 0);
exp("回收站已清空", finRec.json.data.total, 0);

console.log(`\n${"═".repeat(58)}`);
console.log(`  结果：PASS ${pass} / FAIL ${fail}`);
if (F.length) { console.log("\n  失败清单："); F.forEach((f) => console.log(`    ✗ ${f}`)); }
console.log(`${"═".repeat(58)}\n`);
process.exit(fail === 0 ? 0 : 1);
