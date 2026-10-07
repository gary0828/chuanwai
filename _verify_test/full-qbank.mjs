/**
 * 题库系统 · 全流程测试（16 端点全量· 容器环境）
 *
 * ★ 测试原则（对齐 K-011 / K-050）：
 *   1. **每项断言打印实际值**，不只打 PASS/FAIL —— 否则「以为过了」比失败更危险；
 *   2. **端点清单从源码提取核对过**（14 REST + 2 OCR = 16），不靠记忆；
 *   3. **测试数据自带清理**（轮次开头清残留 + 末尾清干净），失败也不留垃圾；
 *   4. 打容器 18080，**不起开发后端**（K-068：会与容器争同一个数据库）。
 *
 * 用法：node _verify_test/full-qbank.mjs [API基址]
 *   默认 http://127.0.0.1:18080
 */
const API = (process.argv[2] || "http://127.0.0.1:18080").replace(/\/$/, "");

let pass = 0;
let fail = 0;
const failures = [];
let section = "";

function sec(title) {
  section = title;
  console.log(`\n${"─".repeat(58)}\n▸ ${title}\n${"─".repeat(58)}`);
}
function ok(label, detail = "") {
  pass += 1;
  console.log(`  PASS  ${label}${detail ? `\n        → ${detail}` : ""}`);
}
function bad(label, detail = "") {
  fail += 1;
  failures.push(`[${section}] ${label}`);
  console.log(`  FAIL  ${label}${detail ? `\n        → ${detail}` : ""}`);
}
function expect(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) ok(label, `= ${JSON.stringify(actual)}`);
  else bad(label, `实际=${JSON.stringify(actual)}\n        期望=${JSON.stringify(expected)}`);
}
function expectTrue(label, actual, note = "") {
  if (actual === true) ok(label, note || "= true");
  else bad(label, `实际=${JSON.stringify(actual)}${note ? ` / ${note}` : ""}`);
}

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

async function login(username, password) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await res.json();
  const t = j.data?.accessToken;
  if (!t) throw new Error(`登录失败 ${username}: ${j.message || res.status}`);
  return t;
}
function call(token, path, options = {}) {
  options = injectCourse(path, options);   // ★ 自动补学科
  return fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }).then(async (r) => {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("spreadsheet") || ct.startsWith("application/octet")) {
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, buf, json: null, headers: r.headers };
    }
    let json = null;
    try { json = await r.json(); } catch { /* 非JSON */ }
    return { status: r.status, json, buf: null, headers: r.headers };
  });
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

const TAG = "全流程";
const admin = await login("admin", process.env.ADMIN_PW || "admin123456");
TEST_COURSE_ID = await resolveTestCourseId(admin);   // ★ 见 injectCourse 注释
const teacher = await login("teacher", process.env.TEACHER_PW || "teacher123456");

console.log(`\n${"═".repeat(58)}`);
console.log(`  题库系统 · 全流程测试`);
console.log(`  API: ${API}`);
console.log(`  ${"═".repeat(58)}`);

// ══════════════════════════════════════════════════════════════════════
sec("0. 前置：清历史残留（否则断言被脏数据污染）");
const staleN = await purgeByKeyword(admin, TAG);
if (staleN > 0) ok(`清掉残留 ${staleN} 条（含回收站）`, "已彻底删除");
else ok("无历史残留", "");

// ══════════════════════════════════════════════════════════════════════
sec("1. GET /overview — 题库概览");
const ov = await call(admin, "/api/qbank/overview");
expect("端点可达", ov.status, 200);
expect("success 标志", ov.json.success, true);
const ovKeys = Object.keys(ov.json.data).sort();
expect(
  "返回字段完整",
  ovKeys,
  ["aiAssisted", "byDifficulty", "bySource", "byStatus", "byType", "total", "withoutKp"]
);
expectTrue("total 是数字", typeof ov.json.data.total === "number", `= ${ov.json.data.total}`);
expectTrue("byType 是数组", Array.isArray(ov.json.data.byType), `长度 ${ov.json.data.byType?.length}`);
console.log(`        统计口径：total=${ov.json.data.total} withoutKp=${ov.json.data.withoutKp} aiAssisted=${ov.json.data.aiAssisted}`);

// ══════════════════════════════════════════════════════════════════════
sec("2. POST /questions — 建题（正常 + 字段全量）");
const q1 = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题",
    stem: `${TAG} 甲：已知向量 $\\vec{a}=(-4,1)$，与它共线的单位向量是`,
    options: ["$\\frac{(1,4)}{5}$", "$\\frac{(-1,-4)}{5}$", "$(4,1)/5$", "$(-4,1)/5$"],
    answer: "A",
    analysis: "共线即方向相同或相反，归一化取首项。",
    difficulty: 3,
    source: "自编",
    solve_method: "向量归一化",
    kp_ids: [1, 2, 3],
    chapter_id: 1,
    custom_tags: ["期末重点", "易错"],
    exam_year: 2024,
    region: "北京",
    status: "已启用"
  }
});
expect("建题成功", q1.json.success, true);
const qid1 = q1.json.data?.id;
expectTrue("返回数字 id", typeof qid1 === "number", `= ${qid1}`);
expectTrue("返回 content_hash", typeof q1.json.data?.content_hash === "string", `= ${q1.json.data?.content_hash}`);

const q2 = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "解答题",
    stem: `${TAG} 乙：求 $f(x)=\\frac{x^2}{2}$ 的最小值`,
    answer: "$-1$",
    analysis: "配方得 $f(x)=\\frac{(x+1)^2-1}{2}$。",
    difficulty: 2,
    source: "AI 原创"
  }
});
const qid2 = q2.json.data?.id;
expect("第二种题型建题成功", q2.json.success, true);

const q3 = await call(teacher, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "填空题",
    stem: `${TAG} 丙：设 $\\alpha\\in(0,\\pi)$，则 $\\sin\\alpha>0$ 的区间是`,
    answer: "$(0,\\pi)$",
    difficulty: 1,
    source: "教材"
  }
});
const qid3 = q3.json.data?.id;
expect("teacher 建题成功（题库是校区共享资产）", q3.json.success, true);

// 校验字段是否真的按预期落库
const det1 = await call(admin, `/api/qbank/questions/${qid1}`);
expect("题型正确", det1.json.data.type, "单选题");
expect("难度正确", det1.json.data.difficulty, 3);
expect("来源正确", det1.json.data.source, "自编");
expect("解题方法正确", det1.json.data.solve_method, "向量归一化");
expect("年份正确", det1.json.data.exam_year, 2024);
expect("地区正确", det1.json.data.region, "北京");
expect("状态正确", det1.json.data.status, "已启用");
expect("多知识点正确落库", JSON.parse(det1.json.data.kp_ids), [1, 2, 3]);
expect("自定义标签正确落库", JSON.parse(det1.json.data.custom_tags), ["期末重点", "易错"]);
expectTrue("章节正确落库", det1.json.data.chapter_id === 1, `= ${det1.json.data.chapter_id}`);
expectTrue("★ created_by 已记录（权限过滤依据）",
  typeof det1.json.data.created_by === "number",
  `= ${det1.json.data.created_by}`);
// 列表接口才带 created_by_name（详情端点没这字段，属于设计取舍）
const listForName = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=1`);
expectTrue("列表接口带录入人姓名",
  typeof listForName.json.data.list[0]?.created_by_name === "string" && listForName.json.data.list[0].created_by_name.length > 0,
  `= ${listForName.json.data.list[0]?.created_by_name}`);

// ══════════════════════════════════════════════════════════════════════
sec("3. LaTeX 数据完整性（★ 核心：存取不能损坏）");
const stemGot = det1.json.data.stem;
expectTrue(
  "★ 题干 LaTeX 未被损坏（\\vec 完整）",
  stemGot.includes("\\vec{a}"),
  `实际=${JSON.stringify(stemGot.slice(0, 40))}`
);
const optsGot = JSON.parse(det1.json.data.options);
expectTrue(
  "★ 选项 LaTeX 完整（\\frac 未丢）",
  optsGot[0].includes("\\frac"),
  `实际=${JSON.stringify(optsGot[0])}`
);
const betaProbe = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题",
    stem: `${TAG} 丁：若 $\\beta>0$ 且 $\\times$ 成立，则`,
    options: ["甲", "乙"],
    answer: "甲",
    source: "自编"
  }
});
const betaStem = (await call(admin, `/api/qbank/questions/${betaProbe.json.data.id}`)).json.data.stem;
expectTrue("★ \\beta 未被吃掉成 'eta'", betaStem.includes("\\beta"), `实际=${JSON.stringify(betaStem.slice(0, 30))}`);
expectTrue("★ \\times 未被吃掉成 'imes'", betaStem.includes("\\times"), `实际=${JSON.stringify(betaStem.slice(0, 30))}`);

// ══════════════════════════════════════════════════════════════════════
sec("4. GET /questions — 列表与全维度筛选");
const all = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
expect("列表端点可达", all.status, 200);
expect("按 TAG 搜到全部 4 道", all.json.data.total, 4);

const fType = await call(admin, `/api/qbank/questions?type=${encodeURIComponent("解答题")}&keyword=${encodeURIComponent(TAG)}`);
expect("按题型筛选", fType.json.data.total, 1);
expect("筛选结果题型正确", fType.json.data.list[0].type, "解答题");

const fDiff = await call(admin, `/api/qbank/questions?difficulty=1&keyword=${encodeURIComponent(TAG)}`);
expect("按难度筛选", fDiff.json.data.total, 1);

const fSource = await call(admin, `/api/qbank/questions?source=${encodeURIComponent("AI 原创")}&keyword=${encodeURIComponent(TAG)}`);
expect("按来源筛选", fSource.json.data.total, 1);

const fStatus = await call(admin, `/api/qbank/questions?status=${encodeURIComponent("已启用")}&keyword=${encodeURIComponent(TAG)}`);
expect("按状态筛选", fStatus.json.data.total, 1);

const fYear = await call(admin, `/api/qbank/questions?exam_year=2024&keyword=${encodeURIComponent(TAG)}`);
expect("按年份筛选", fYear.json.data.total, 1);

const fKp = await call(admin, `/api/qbank/questions?kp_id=1&keyword=${encodeURIComponent(TAG)}`);
expect("按知识点筛选（多值 JSON 反查）", fKp.json.data.total, 1);

const fMethod = await call(admin, `/api/qbank/questions?solve_method=${encodeURIComponent("向量归一化")}&keyword=${encodeURIComponent(TAG)}`);
expect("按解题方法筛选", fMethod.json.data.total, 1);

const fTag = await call(admin, `/api/qbank/questions?custom_tag=${encodeURIComponent("易错")}&keyword=${encodeURIComponent(TAG)}`);
expect("按自定义标签筛选", fTag.json.data.total, 1);

// 分页
const p1 = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&page=1&pageSize=2`);
const p2 = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&page=2&pageSize=2`);
expect("第1 页条数", p1.json.data.list.length, 2);
expect("第 2 页条数", p2.json.data.list.length, 2);
const ids1 = p1.json.data.list.map((q) => q.id);
const ids2 = p2.json.data.list.map((q) => q.id);
expect("两页无重复", ids1.filter((i) => ids2.includes(i)).length, 0);
expectTrue("分页 pageSize 生效", p1.json.data.pageSize === 2, `= ${p1.json.data.pageSize}`);

// 章节筛选 + 含子级
const chNoSub = await call(admin, `/api/qbank/questions?chapter_id=1&keyword=${encodeURIComponent(TAG)}`);
const chWithSub = await call(admin, `/api/qbank/questions?chapter_id=1&include_sub_folders=1&keyword=${encodeURIComponent(TAG)}`);
console.log(`        不含子级=${chNoSub.json.data.total} 条 / 含子级=${chWithSub.json.data.total} 条`);
expectTrue("含子级筛选可用（≥ 不含子级）", chWithSub.json.data.total >= chNoSub.json.data.total,
  `${chWithSub.json.data.total} >= ${chNoSub.json.data.total}`);

// 排序：默认按更新时间倒序
expectTrue("默认按更新时间倒序", det1.json.data.updated_at != null, `updated_at=${det1.json.data.updated_at}`);

// ══════════════════════════════════════════════════════════════════════
sec("5. GET /facets — 三视角筛选侧栏数据");
const fc = await call(admin, "/api/qbank/facets");
expect("端点可达", fc.status, 200);
expect("返回 5 组数据", Object.keys(fc.json.data).sort(),
  ["chapters", "knowledge", "methods", "tags", "years"]);
expectTrue("章节数据非空（种子已写入）", (fc.json.data.chapters?.length || 0) > 0,
  `${fc.json.data.chapters?.length} 个节点`);
expectTrue("★ 解题方法来自实际数据（非预置空枚举）",
  (fc.json.data.methods || []).some((m) => m.name === "向量归一化"),
  JSON.stringify(fc.json.data.methods));
expectTrue("标签来自实际数据", (fc.json.data.tags || []).some((t) => t.name === "易错"),
  JSON.stringify(fc.json.data.tags));
expectTrue("年份来自实际数据", (fc.json.data.years || []).some((y) => y.year === 2024),
  JSON.stringify(fc.json.data.years));

// ══════════════════════════════════════════════════════════════════════
sec("6. PUT /questions/:id — 修改（含 P0 回归：options 不可损坏）");
const beforeOpts = det1.json.data.options;
const put1 = await call(admin, `/api/qbank/questions/${qid1}`, {
  method: "PUT",
  body: { difficulty: 5, analysis: "改过的解析" }
});
expect("改题成功", put1.json.success, true);
const after1 = await call(admin, `/api/qbank/questions/${qid1}`);
expect("难度已改", after1.json.data.difficulty, 5);
expect("解析已改", after1.json.data.analysis, "改过的解析");
expect("★ options 逐字节未变（防双重编码）", after1.json.data.options, beforeOpts);
expect("★ LaTeX 修改后仍完好", after1.json.data.stem.includes("\\vec{a}"), true);

// ★ P0 回归：连续改 3 次无关字段，options 必须逐字节不变
const snapshots = [];
for (let i = 1; i <= 3; i += 1) {
  await call(teacher === null ? admin : admin, `/api/qbank/questions/${qid1}`, {
    method: "PUT",
    body: { difficulty: i }
  });
  snapshots.push((await call(admin, `/api/qbank/questions/${qid1}`)).json.data.options);
}
const uniq = [...new Set(snapshots)];
expect("★★ 连续 PUT 3 次后 options 仍只有 1 种形态", uniq.length, 1);
expect("★ options 内容未污染", JSON.parse(uniq[0]),
  ["$\\frac{(1,4)}{5}$", "$\\frac{(-1,-4)}{5}$", "$(4,1)/5$", "$(-4,1)/5$"]);

// 部分更新：只传一个字段，其余应保持
await call(admin, `/api/qbank/questions/${qid1}`, { method: "PUT", body: { region: "上海" } });
const afterRegion = await call(admin, `/api/qbank/questions/${qid1}`);
expect("部分更新：地区已改", afterRegion.json.data.region, "上海");
expect("部分更新：其余字段未受影响（难度仍是 3）", afterRegion.json.data.difficulty, 3);
expect("部分更新：题干未被清空", afterRegion.json.data.stem.includes("\\vec"), true);

// ══════════════════════════════════════════════════════════════════════
sec("7. POST /questions/check-duplicate — 查重两级");
const dupExact = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: { stem: det1.json.data.stem }
});
expectTrue("L1 精确：完全相同能命中", (dupExact.json.data.exact?.length || 0) >= 1,
  `exact=${dupExact.json.data.exact?.length} 条`);
expectTrue("★ 命中项带 id 与题干（能指出与哪题重复）",
  typeof dupExact.json.data.exact?.[0]?.id === "number" && !!dupExact.json.data.exact?.[0]?.stem,
  JSON.stringify(dupExact.json.data.exact?.[0]?.stem?.slice(0, 25)));

// 归一化：差空格
const dupSpace = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: { stem: det1.json.data.stem.replace("(", " (") }
});
expectTrue("L1 归一化：差空格也算重复", (dupSpace.json.data.exact?.length || 0) >= 1,
  `exact=${dupSpace.json.data.exact?.length}`);

// L2 近似：改实义词
const dupSimilar = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: { stem: q2body(det1.json.data.stem) }
});
function q2body(s) {
  return s.replace("共线的单位向量", "垂直的单位向量");
}
expectTrue("L2 近似：改实义词能命中（exact 为空，走 similar）",
  (dupSimilar.json.data.exact?.length || 0) === 0 &&
  (dupSimilar.json.data.similar?.length || 0) >= 1,
  `exact=${dupSimilar.json.data.exact?.length} similar=${dupSimilar.json.data.similar?.length} 相似度=${dupSimilar.json.data.similar?.[0]?.similarity}`);

const dupNone = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: { stem: "圆锥曲线离心率的取值范围求解方法与步骤" }
});
expect("无关题干：不报重复",
  (dupNone.json.data.exact?.length || 0) + (dupNone.json.data.similar?.length || 0), 0);

// excludeId：编辑时排除自己
const dupSelf = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: { stem: det1.json.data.stem, excludeId: qid1 }
});
expectTrue("excludeId 生效（编辑时不与自己重复）",
  !dupSelf.json.data.exact?.some((d) => d.id === qid1),
  `exact id 列表=${JSON.stringify(dupSelf.json.data.exact?.map((d) => d.id))}`);

// ══════════════════════════════════════════════════════════════════════
sec("8. Excel 模板 / 导出");
const tpl = await call(admin, "/api/qbank/questions/template.xlsx");
expect("模板可下载", tpl.status, 200);
expectTrue("是 xlsx（MIME）",
  String(tpl.headers.get("content-type")).includes("spreadsheetml"),
  `= ${tpl.headers.get("content-type")}`);
expect("★ 是合法 ZIP（PK 头）", tpl.buf.subarray(0, 2).toString(), "PK");
expectTrue("文件非空", tpl.buf.length > 1000, `${tpl.buf.length} bytes`);
expectTrue("★ 文件名含 template",
  String(tpl.headers.get("content-disposition")).includes("template"),
  `= ${tpl.headers.get("content-disposition")}`);

const exp = await call(admin, `/api/qbank/questions/export?keyword=${encodeURIComponent(TAG)}`);
expect("导出可下载", exp.status, 200);
expect("★ 是合法 xlsx（PK 头）", exp.buf.subarray(0, 2).toString(), "PK");
expectTrue("导出体积合理", exp.buf.length > 3000, `${exp.buf.length} bytes`);

// 导出内容核对：真的包含我们的题？
const XLSX = await import("xlsx").then((m) => m.default ?? m);
const wb = XLSX.read(exp.buf, { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
expectTrue("★ 导出行数 ≥ 4（含全部测试题）", rows.length >= 4, `实际 ${rows.length} 行`);
expectTrue("★ 导出的题干含 LaTeX 原文",
  rows.some((r) => String(r.stem || r["题干"] || "").includes("\\vec")),
  JSON.stringify(Object.keys(rows[0] || {}).slice(0, 8)));
expectTrue("★ 导出的知识点列已回填 code/name（不是空）",
  rows.some((r) => r["知识点编码"] || r["知识点"]),
  JSON.stringify(rows.map((r) => r["知识点编码"]).slice(0, 4)));

// ══════════════════════════════════════════════════════════════════════
sec("9. POST /questions/import — Excel 批量导入（逐行回报）");
const imp = await call(admin, "/api/qbank/questions/import", {
  method: "POST",
  body: {
    rows: [
      { type: "单选题", stem: `${TAG} 导入1：已知集合 A={1,2,3}，则 |A|=`,
        options: ["2", "3", "4", "5"], answer: "3", analysis: "元素个数",
        difficulty: 1, source: "自编", year: 2023, region: "广东" },
      { type: "解答题", stem: `${TAG} 导入2：求 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$`,
        answer: "1", difficulty: 4, source: "教材", solve_method: "极限计算" },
      { type: "单选题", stem: `${TAG} 导入3：来源缺失`, options: ["A", "B"], answer: "A" },
      { type: "不存在的题型", stem: `${TAG} 导入4：题型非法`, source: "自编" },
      { type: "单选题", stem: "", options: ["A", "B"], answer: "A", source: "自编" }
    ]
  }
});
expect("导入端点可达", imp.json.success, true);
expect("★ 5 行中成功 2 行", imp.json.data.imported, 2);
expect("★ 3 行失败", imp.json.data.failed, 3);
expect("★ 报错列出具体行号", imp.json.data.errors.map((e) => e.row).sort((a, b) => a - b), [4, 5, 6]);
expectTrue("★ 报错说明是来源问题",
  imp.json.data.errors.some((e) => e.message.includes("来源")),
  JSON.stringify(imp.json.data.errors.map((e) => e.message.slice(0, 24))));
expectTrue("★ 报错说明是题型问题",
  imp.json.data.errors.some((e) => e.message.includes("题型")),
  JSON.stringify(imp.json.data.errors.map((e) => e.message.slice(0, 24))));
expectTrue("★ 报错说明是题干为空",
  imp.json.data.errors.some((e) => e.message.includes("题干为空")),
  JSON.stringify(imp.json.data.errors.map((e) => e.message.slice(0, 24))));

// 导入的 LaTeX 是否完好
const imported = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG + " 导入2")}`);
expectTrue("★ 导入的 LaTeX 完好（\\lim / \\frac / \\to 都在）",
  imported.json.data.list[0]?.stem?.includes("\\lim") &&
  imported.json.data.list[0]?.stem?.includes("\\frac") &&
  imported.json.data.list[0]?.stem?.includes("\\to"),
  `实际=${JSON.stringify(imported.json.data.list[0]?.stem?.slice(0, 45))}`);

// 空导入
const impEmpty = await call(admin, "/api/qbank/questions/import", { method: "POST", body: { rows: [] } });
expect("空数组导入 → 400", impEmpty.status, 400);
// 超量导入
const impTooMany = await call(admin, "/api/qbank/questions/import", {
  method: "POST",
  body: { rows: Array.from({ length: 501 }, (_, i) => ({ type: "单选题", stem: `x${i}`, source: "自编" })) }
});
expect("超 500 行 → 400", impTooMany.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("10. POST /questions/batch-status & batch-delete");
const st = await call(admin, "/api/qbank/questions/batch-status", {
  method: "POST",
  body: { ids: [qid2, qid3], status: "已启用" }
});
expect("批量改状态成功", st.json.data.updated, 2);

const stBad = await call(admin, "/api/qbank/questions/batch-status", {
  method: "POST",
  body: { ids: [qid2], status: "不存在态" }
});
expect("非法状态 → 400", stBad.status, 400);

const stEmpty = await call(admin, "/api/qbank/questions/batch-status", {
  method: "POST",
  body: { ids: [], status: "已启用" }
});
expect("空ids → 400", stEmpty.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("11. DELETE /questions/:id — 单删");
const delTarget = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} 待删除题`, options: ["A", "B"], answer: "A", source: "自编" }
});
const delId = delTarget.json.data.id;
const del1 = await call(admin, `/api/qbank/questions/${delId}`, { method: "DELETE" });
expect("删除成功", del1.json.success, true);
const delCheck = await call(admin, `/api/qbank/questions/${delId}`);
expect("删除后再查 → 404", delCheck.status, 404);
//★ HTTP 语义：题不存在是 404，「不是你的题」才是 403。
//   之前两者都返回 403，用户会误以为是自己权限问题（2026-10-07 修复）。
const delAgain = await call(admin, `/api/qbank/questions/${delId}`, { method: "DELETE" });
expect("★ 重复删除 → 404（不是 403）", delAgain.status, 404);
const putMissing = await call(admin, "/api/qbank/questions/99999999", {
  method: "PUT",
  body: { difficulty: 3 }
});
expect("★ 修改不存在的题 → 404（不是 403）", putMissing.status, 404);

// ══════════════════════════════════════════════════════════════════════
sec("12. GET /questions/:id — 详情与不存在");
const detOK = await call(admin, `/api/qbank/questions/${qid1}`);
expect("详情可取", detOK.status, 200);
const detMissing = await call(admin, "/api/qbank/questions/99999999");
expect("不存在 → 404", detMissing.status, 404);
expectTrue("★ 404 提示明确", detMissing.json.message.includes("不存在"),
  `= ${detMissing.json.message}`);

// ══════════════════════════════════════════════════════════════════════
sec("13. POST /ocr/recognize & /ocr/generate — AI 端点的参数校验");
const ocrNoImg = await call(admin, "/api/qbank/ocr/recognize", { method: "POST", body: {} });
expect("未传图 → 400", ocrNoImg.status, 400);
expectTrue("提示含「截图」", ocrNoImg.json.message.includes("截图"), `= ${ocrNoImg.json.message}`);

const ocrBadMime = await call(admin, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: { image: "data:text/plain;base64,aGVsbG8=" }
});
expect("非图片 MIME → 400", ocrBadMime.status, 400);
expectTrue("★ 提示列出支持的格式", ocrBadMime.json.message.includes("PNG"),
  `= ${ocrBadMime.json.message}`);

const ocrBadUrl = await call(admin, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: { image: "这不是 data URL" }
});
expect("非 data URL → 400", ocrBadUrl.status, 400);

// 1x1 像素 PNG（合法但极小）→ 应过入参校验，走到模型检查
const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ocrTiny = await call(admin, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: { image: png1x1 }
});
console.log(`        1x1 合法 PNG → HTTP ${ocrTiny.status}：${ocrTiny.json?.message || "(无消息)"}`);
expectTrue("★ 合法小图能过入参校验（不是 400 参数错）",
  ocrTiny.status !== 400 || !ocrTiny.json.message.includes("格式"),
  `status=${ocrTiny.status} msg=${ocrTiny.json?.message}`);

const genNoTopic = await call(admin, "/api/qbank/ocr/generate", { method: "POST", body: { count: 3 } });
expect("出题未给主题 → 400（★ 参数校验优先于依赖检查）", genNoTopic.status, 400);
expectTrue("提示含「主题」或「知识点」", genNoTopic.json.message.includes("主题"),
  `= ${genNoTopic.json.message}`);

const genBadKp = await call(admin, "/api/qbank/ocr/generate", {
  method: "POST",
  body: { topic: "测试", kpId: 99999999 }
});
expect("出题指定不存在知识点 → 400", genBadKp.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("14. 未登录访问（401）");
const noTok = await call(null, "/api/qbank/overview");
expect("无凭证 → 401", noTok.status, 401);
const badTok = await call("invalid.token.here", "/api/qbank/overview");
expect("坏凭证 → 401", badTok.status, 401);

// ══════════════════════════════════════════════════════════════════════
sec("15. 清理测试数据");
// ★ 用统一的两步清理（软删→彻底删）—— 直接 batch-delete 只会把数据留进回收站
await purgeByKeyword(admin, TAG);
const after = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
const afterRec = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
expect("★ 测试数据已清空（列表）", after.json.data.total, 0);
expect("★ 测试数据已清空（回收站）", afterRec.json.data.total, 0);

console.log(`\n${"═".repeat(58)}`);
console.log(`  结果：PASS ${pass} / FAIL ${fail}`);
if (failures.length) {
  console.log(`\n  失败清单：`);
  failures.forEach((f) => console.log(`    ✗ ${f}`));
}
console.log(`${"═".repeat(58)}\n`);
process.exit(fail === 0 ? 0 : 1);