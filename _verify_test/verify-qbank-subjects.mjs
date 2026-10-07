/**
 * 题库多学科隔离验证（批次4）
 *
 * ★ 核心是**隔离**：切到 A 学科时绝不能看到 B 学科的任何东西 ——
 *   列表 / 导出 / 概览 / 三视角 / 回收站 / 知识点管理，一处串了就白做。
 *
 * ★ 每项打印实际值（K-011）；测试数据自带清理（循环版，见 K-076）。
 * ★ 打容器 18080（不起开发后端，K-068）。
 *
 * 用法：node _verify_test/verify-qbank-subjects.mjs [API基址]
 */
const API = (process.argv[2] || "http://127.0.0.1:18080").replace(/\/$/, "");
const ADMIN_PW = process.env.ADMIN_PW || "admin123456";

let pass = 0, fail = 0;
const F = [];
const sec = (t) => console.log(`\n${"─".repeat(58)}\n▸ ${t}\n${"─".repeat(58)}`);
const ok = (l, d = "") => { pass += 1; console.log(`  PASS  ${l}${d ? `\n        → ${d}` : ""}`); };
const bad = (l, d = "") => { fail += 1; F.push(l); console.log(`  FAIL  ${l}${d ? `\n        → ${d}` : ""}`); };
const expect = (l, a, e) =>
  JSON.stringify(a) === JSON.stringify(e) ? ok(l, `= ${JSON.stringify(a)}`) : bad(l, `实际=${JSON.stringify(a)} 期望=${JSON.stringify(e)}`);
const expT = (a, l, d = "") => (a === true ? ok(l, d || "= true") : bad(l, `实际=${JSON.stringify(a)}${d ? " / " + d : ""}`));

async function login(u, p) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p })
  });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error(`登录失败 ${u}: ${j.message || r.status}`);
  return j.data.accessToken;
}
const call = (tk, p, o = {}) =>
  fetch(`${API}${p}`, {
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

const admin = await login("admin", ADMIN_PW);
const TAG = "多学科";

console.log(`\n${"═".repeat(58)}\n  题库多学科隔离验证\n  API: ${API}\n${"═".repeat(58)}`);

// ══════════════════════════════════════════════════════════════════════
sec("1. 学科清单");
const subs = await call(admin, "/api/qbank/subjects");
expect("学科端点可达", subs.json.success, true);
const list = subs.json.data.list;
const byCode = new Map(list.map((s) => [s.code, s]));
console.log(`        共 ${list.length} 门：${list.map((s) => s.name).join(" / ")}`);
expect("学科总数（含原有初中数学）", list.length, 23);
expT(byCode.has("JUN-PHY"), "有「初中物理」", `id=${byCode.get("JUN-PHY")?.id}`);
expT(byCode.has("SEN-CHE"), "有「高中化学」", `id=${byCode.get("SEN-CHE")?.id}`);
expT(byCode.has("PRI-CHN"), "有「小学语文」", `id=${byCode.get("PRI-CHN")?.id}`);
expT((byCode.get("JUN-PHY")?.chapterCount || 0) > 5, "初中物理带知识板块",
  `${byCode.get("JUN-PHY")?.chapterCount} 个`);

const MATH = byCode.get("MATH8").id;
const PHY = byCode.get("JUN-PHY").id;
const CHE = byCode.get("SEN-CHE").id;
ok("选用的三个测试学科", `数学#${MATH} 物理#${PHY} 化学#${CHE}`);

// 清残留（★ 循环清理，见 K-076）
async function purgeAll() {
  for (let i = 0; i < 5; i += 1) {
    let n = 0;
    const l = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
    if (l.json.data.total) {
      await call(admin, "/api/qbank/questions/batch-delete", {
        method: "POST", body: { ids: l.json.data.list.map((q) => q.id) }
      });
      n += l.json.data.total;
    }
    const r = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
    if (r.json.data.total) {
      await call(admin, "/api/qbank/questions/purge", {
        method: "POST", body: { ids: r.json.data.list.map((q) => q.id) }
      });
      n += r.json.data.total;
    }
    if (!n) break;
  }
}
await purgeAll();

// ══════════════════════════════════════════════════════════════════════
sec("2. 建题必须归属学科");
const noCourse = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} 缺学科`, options: ["甲", "乙"], answer: "甲", source: "自编" }
});
expect("不传 course_id → 400", noCourse.status, 400);
expT(String(noCourse.json.message).includes("学科"), "★ 提示要求选学科", `= ${noCourse.json.message}`);

const badCourse = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} 学科不存在`, options: ["甲", "乙"], answer: "甲", source: "自编", course_id: 99999 }
});
expect("不存在的 course_id → 400", badCourse.status, 400);

const mathQ = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题", stem: `${TAG} 数学题`, options: ["甲", "乙"], answer: "甲",
    source: "自编", course_id: MATH, analysis: "数学解析"
  }
});
const mathId = mathQ.json.data?.id;
expT(mathQ.json.success === true, "★ 数学题建立成功", `id=${mathId}`);

const phyQ = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题", stem: `${TAG} 物理题`, options: ["丙", "丁"], answer: "丙",
    source: "自编", course_id: PHY, analysis: "物理解析"
  }
});
const phyId = phyQ.json.data?.id;
expT(phyQ.json.success === true, "★ 物理题建立成功", `id=${phyId}`);

const chemQ = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题", stem: `${TAG} 化学题`, options: ["戊", "己"], answer: "戊",
    source: "自编", course_id: CHE
  }
});
const chemId = chemQ.json.data?.id;
expT(chemQ.json.success === true, "★ 化学题建立成功", `id=${chemId}`);

// ══════════════════════════════════════════════════════════════════════
sec("3. 列表按学科隔离（★ 核心）");
const listAll = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
expect("不限定学科 → 全部 3 道", listAll.json.data.total, 3);

const listMath = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&course_id=${MATH}&pageSize=100`);
expect("★ 只查数学 → 1 道", listMath.json.data.total, 1);
expect("★ 且是数学题", String(listMath.json.data.list[0]?.stem).includes("数学题"), true);

const listPhy = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&course_id=${PHY}&pageSize=100`);
expect("★ 只查物理 → 1 道", listPhy.json.data.total, 1);
expect("★ 且是物理题", String(listPhy.json.data.list[0]?.stem).includes("物理题"), true);

// 学科 id 也随题返回（前端切换器与列表要能对上）
expect("列表项带 course_id", listMath.json.data.list[0]?.course_id, MATH);

// ══════════════════════════════════════════════════════════════════════
sec("4. 概览与三视角按学科隔离");
const ovMath = await call(admin, `/api/qbank/overview?course_id=${MATH}`);
const ovPhy = await call(admin, `/api/qbank/overview?course_id=${PHY}`);
const ovAll = await call(admin, "/api/qbank/overview");
expect("★ 数学概览 total", ovMath.json.data.total, 1);
expect("★ 物理概览 total", ovPhy.json.data.total, 1);
expT(ovAll.json.data.total >= 3, "不限定学科的概览 ≥ 3", `= ${ovAll.json.data.total}`);

const fcMath = await call(admin, `/api/qbank/facets?course_id=${MATH}`);
const fcPhy = await call(admin, `/api/qbank/facets?course_id=${PHY}`);
// 数学的章节应含「平面向量及其应用」（种子数据），物理的应含「声现象」
expT((fcMath.json.data.chapters || []).some((c) => c.name.includes("向量")),
  "★ 数学谱系的章节含向量相关", `${fcMath.json.data.chapters?.length} 个章节`);
expT((fcPhy.json.data.chapters || []).some((c) => c.name === "声现象"),
  "★ 物理谱系的章节含「声现象」", `${fcPhy.json.data.chapters?.length} 个章节`);
expT(!(fcPhy.json.data.chapters || []).some((c) => c.name.includes("向量")),
  "★★ 物理谱系里**没有**数学的章节（隔离生效）");
expT((fcMath.json.data.knowledge || []).length > 0, "数学有知识点",
  `${fcMath.json.data.knowledge?.length} 个`);
expT((fcPhy.json.data.knowledge || []).length === 0, "★ 物理暂无知识点（留给老师自建）",
  `${fcPhy.json.data.knowledge?.length} 个`);

// ══════════════════════════════════════════════════════════════════════
sec("5. 导出按学科隔离");
const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
async function exportRows(qs) {
  const r = await call(admin, `/api/qbank/questions/export?${qs}`);
  const wb = XLSX.read(r.buf, { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets["题库"], { defval: "" });
}
const expMath = await exportRows(`keyword=${encodeURIComponent(TAG)}&course_id=${MATH}`);
const hitMath = expMath.filter((x) => String(x["题干"] || "").includes(TAG));
expect("★ 导出·数学 → 1 行", hitMath.length, 1);
expect("★ 且带「学科」列值", hitMath[0]?.["学科"], "初中数学");
console.log(`        导出的列：${Object.keys(hitMath[0] || {}).slice(0, 3).join(" / ")} ...`);

const expPhy = await exportRows(`keyword=${encodeURIComponent(TAG)}&course_id=${PHY}`);
const hitPhy = expPhy.filter((x) => String(x["题干"] || "").includes(TAG));
expect("★ 导出·物理 → 1 行", hitPhy.length, 1);
expect("★ 物理导出的学科列", hitPhy[0]?.["学科"], "初中物理");

const expAll = await exportRows(`keyword=${encodeURIComponent(TAG)}`);
expect("不限定学科导出 → 3 行（跨学科可见）",
  expAll.filter((x) => String(x["题干"] || "").includes(TAG)).length, 3);

// ══════════════════════════════════════════════════════════════════════
sec("6. 查重限定学科（★ 跨学科不该误报）");
// 让物理题与数学题**题干完全相同** —— 若查重不限学科，物理这边会误报重复
const sameStem = `${TAG} 同题干的物理与数学题`;
const dupA = await call(admin, "/api/qbank/questions", {
  method: "POST", body: { type: "单选题", stem: sameStem, options: ["甲", "乙"], answer: "甲", source: "自编", course_id: MATH }
});
const dupB = await call(admin, "/api/qbank/questions", {
  method: "POST", body: { type: "单选题", stem: sameStem, options: ["甲", "乙"], answer: "甲", source: "自编", course_id: PHY }
});
expT(dupA.json.success && dupB.json.success, "同一题干分别建到数学与物理（应都成功）",
  `数学#${dupA.json.data?.id} 物理#${dupB.json.data?.id}`);

const chkPhy = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST", body: { stem: sameStem, course_id: PHY }
});
const chkMath = await call(admin, "/api/qbank/questions/check-duplicate", {
  method: "POST", body: { stem: sameStem, course_id: MATH }
});
expect("★ 在物理学科查重 → 只命中物理那道", chkPhy.json.data.exact?.map((x) => x.id), [dupB.json.data.id]);
expect("★ 在数学学科查重 → 只命中数学那道", chkMath.json.data.exact?.map((x) => x.id), [dupA.json.data.id]);
expT(
  (chkPhy.json.data.similar || []).every((x) => x.id !== dupA.json.data.id),
  "★★ 物理查重不会把数学题列为疑似重复"
);

// ══════════════════════════════════════════════════════════════════════
sec("7. 知识点管理按学科隔离");
const taxMath = await call(admin, `/api/qbank/taxonomy?course_id=${MATH}`);
const taxPhy = await call(admin, `/api/qbank/taxonomy?course_id=${PHY}`);
expT((taxMath.json.data.knowledge || []).length > 0, "数学有知识点树",
  `${taxMath.json.data.knowledge?.length} 个`);
expT((taxPhy.json.data.knowledge || []).length === 0, "物理的知识点树为空",
  `${taxPhy.json.data.knowledge?.length} 个`);
expT((taxPhy.json.data.chapters || []).every((c) => c.name !== "平面向量及其应用"),
  "★★ 物理的章节树里没有数学章节");

// 新增知识点必须带学科
const kpNoCourse = await call(admin, "/api/qbank/taxonomy/kp", {
  method: "POST", body: { name: `${TAG}缺学科知识点` }
});
expect("新增知识点不传学科 → 400", kpNoCourse.status, 400);

const kpPhy = await call(admin, "/api/qbank/taxonomy/kp", {
  method: "POST", body: { name: `${TAG}物理知识点`, course_id: PHY, difficulty: 2 }
});
expT(kpPhy.json.success === true, "★ 新增物理知识点成功", `id=${kpPhy.json.data?.id}`);

const taxPhy2 = await call(admin, `/api/qbank/taxonomy?course_id=${PHY}`);
expect("★ 物理知识点树现在有 1 个", taxPhy2.json.data.knowledge.length, 1);
const taxMath2 = await call(admin, `/api/qbank/taxonomy?course_id=${MATH}`);
expT(!(taxMath2.json.data.knowledge || []).some((k) => k.name === `${TAG}物理知识点`),
  "★★ 物理新增的知识点**没有**出现在数学树里");
if (kpPhy.json.data?.id) {
  await call(admin, `/api/qbank/taxonomy/kp/${kpPhy.json.data.id}`, { method: "DELETE" });
  ok("已清理测试知识点");
}

// 新增章节必须带学科
const chNoCourse = await call(admin, "/api/qbank/taxonomy/chapter", {
  method: "POST", body: { name: `${TAG}缺学科章节` }
});
expect("新增章节不传学科 → 400", chNoCourse.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("8. 回收站按学科隔离");
await call(admin, `/api/qbank/questions/${phyId}`, { method: "DELETE" });
const recMath = await call(admin, `/api/qbank/questions/recycle?course_id=${MATH}&pageSize=100`);
const recPhy = await call(admin, `/api/qbank/questions/recycle?course_id=${PHY}&pageSize=100`);
expT(!(recMath.json.data.list || []).some((q) => q.id === phyId),
  "★★ 物理题进了回收站，但数学的回收站里看不到它");
expT((recPhy.json.data.list || []).some((q) => q.id === phyId),
  "★ 物理的回收站里能看到它", `物理回收站 ${recPhy.json.data.total} 条`);

await call(admin, "/api/qbank/questions/restore", { method: "POST", body: { ids: [phyId] } });
ok("已恢复物理题（供后续清理）");

// ══════════════════════════════════════════════════════════════════════
sec("9. 改题可换学科");
const moveRes = await call(admin, `/api/qbank/questions/${chemId}`, {
  method: "PUT", body: { course_id: MATH }
});
expect("★ 把化学题改到数学（录错学科应有救）", moveRes.status, 200);
const afterMove = await call(admin, `/api/qbank/questions/${chemId}`);
expect("★ 学科已改", afterMove.json.data.course_id, MATH);
// 改回去（保持测试数据可辨识）
await call(admin, `/api/qbank/questions/${chemId}`, { method: "PUT", body: { course_id: CHE } });

const badMove = await call(admin, `/api/qbank/questions/${chemId}`, {
  method: "PUT", body: { course_id: 99999 }
});
expect("改到不存在的学科 → 400", badMove.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("10. AI 端点必须带学科");
const ocrNoCourse = await call(admin, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: { image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }
});
expect(
  "★ 截图识别不传学科 → 400（且提示选学科）",
  ocrNoCourse.status === 400 && String(ocrNoCourse.json?.message || "").includes("学科"),
  true
);
console.log(`        实际：HTTP ${ocrNoCourse.status} / ${ocrNoCourse.json?.message}`);

const genNoCourse = await call(admin, "/api/qbank/ocr/generate", {
  method: "POST", body: { topic: "测试", count: 1 }
});
expect("★ 出题不传学科 → 400", genNoCourse.status, 400);
console.log(`        实际：HTTP ${genNoCourse.status} / ${genNoCourse.json?.message}`);

// 导入必须带学科
const impNoCourse = await call(admin, "/api/qbank/questions/import", {
  method: "POST", body: { rows: [{ type: "填空题", stem: `${TAG} 导入缺学科`, source: "自编" }] }
});
expect("★ 导入不传学科 → 400", impNoCourse.status, 400);

const impOk = await call(admin, "/api/qbank/questions/import", {
  method: "POST",
  body: { course_id: PHY, rows: [{ type: "填空题", stem: `${TAG} 导入到物理`, answer: "x", source: "自编" }] }
});
expect("★ 带学科导入成功", impOk.json.data.imported, 1);
const impCheck = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG + " 导入到物理")}`);
expect("★ 导入的题归到物理", impCheck.json.data.list[0]?.course_id, PHY);

// ══════════════════════════════════════════════════════════════════════
sec("11. 清理");
await purgeAll();
const fin1 = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
const fin2 = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
expect("测试数据已清空（列表）", fin1.json.data.total, 0);
expect("测试数据已清空（回收站）", fin2.json.data.total, 0);

console.log(`\n${"═".repeat(58)}`);
console.log(`  结果：PASS ${pass} / FAIL ${fail}`);
if (F.length) { console.log("\n  失败清单："); F.forEach((f) => console.log(`    ✗ ${f}`)); }
console.log(`${"═".repeat(58)}\n`);
process.exit(fail === 0 ? 0 : 1);
