/**
 * 题库系统 · 异常边界与回归测试（M5）
 *
 * 覆盖：极端输入 / 业务边界 / 查重边界 / 列表边界 / 并发写入 / 既有功能回归。
 *
 * ★ 与 full-qbank.mjs 同约定：打印实际值、测试数据自带清理、密码走环境变量。
 *
 * 用法：node _verify_test/edge-qbank.mjs [API基址]
 */
const API = (process.argv[2] || "http://127.0.0.1:18080").replace(/\/$/, "");
const ADMIN_PW = process.env.ADMIN_PW || "admin123456";
const TEACHER_PW = process.env.TEACHER_PW || "teacher123456";

let pass = 0, fail = 0;
const F = [];
const sec = (t) => console.log(`\n${"-".repeat(56)}\n▸ ${t}\n${"-".repeat(56)}`);
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

/** 学科 id 由 main 在登录后赋值；0 表示"还没拿到"，此时不注入 */
let TEST_COURSE_ID = 0;

/**
 * 给**需要学科的写操作**自动补 course_id。
 *
 * ★ 只覆盖三个写端点（建题 / 导入 / AI），GET 一律不动 ——
 *   列表类查询不带 course_id = 查全部学科，测试里有时正需要这个语义。
 * ★ 不覆盖调用方**显式传的** course_id（多学科专项测试会自己指定）。
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
  return j.data.accessToken;
}
const call = (tk, p, o = {}) => {
  o = injectCourse(p, o);   // ★ 自动补学科（见 injectCourse 注释）
  return fetch(`${API}${p}`, {
    method: o.method || "GET",
    headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body)
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
};

const admin = await login("admin", ADMIN_PW);
TEST_COURSE_ID = await resolveTestCourseId(admin);   // ★ 见 injectCourse 注释
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

const TAG = "边界";
console.log(`\n${"=".repeat(56)}\n  题库系统 · 异常边界与回归测试\n  API: ${API}\n${"=".repeat(56)}`);

const staleN = await purgeByKeyword(admin, TAG);
if (staleN > 0) ok(`清残留 ${staleN} 条（含回收站）`);

// ══════════════════════════════════════════════════════════════════════
sec("1. 极端输入：超长 / XSS / SQL 注入");
const longStem = "超长题干".repeat(2000); // 8000 字，远超 max=4000
const r1 = await call(admin, "/api/qbank/questions", {
  method: "POST", body: { type: "单选题", stem: longStem, source: "自编", options: ["A", "B"], answer: "A" }
});
exp("超长题干被拒（4000 字上限）", r1.status, 400);
expT(r1.json.message.includes("字符") || r1.json.message.includes("4000"),
  "★ 提示含长度上限", `= ${r1.json.message}`);

const xss = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题",
    stem: `${TAG} <script>alert(1)</script>`,
    source: "自编",
    options: ["<img src=x onerror=alert(1)>", "正常"],
    answer: "A"
  }
});
if (xss.json.success) {
  const got = (await call(admin, `/api/qbank/questions/${xss.json.data.id}`)).json.data.stem;
  exp("★ XSS 载荷按纯文本原样存", got.includes("<script>alert(1)</script>"), true);
  await call(admin, `/api/qbank/questions/${xss.json.data.id}`, { method: "DELETE" });
  ok("★ XSS 用例已清理", `id=${xss.json.data.id}`);
} else bad("XSS 用例建题失败", JSON.stringify(xss.json).slice(0, 90));

const sqli = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "单选题",
    stem: `${TAG} ' OR 1=1; DROP TABLE questions;--`,
    source: "自编", options: ["A", "B"], answer: "A"
  }
});
if (sqli.json.success) {
  const still = await call(admin, "/api/qbank/overview");
  expT(still.json.data.total > 0, "★ SQL 注入后 questions 表仍可读（表未受损）", `total=${still.json.data.total}`);
  const got = (await call(admin, `/api/qbank/questions/${sqli.json.data.id}`)).json.data.stem;
  expT(got.includes("DROP TABLE"), "★ 注入载荷按纯文本存（未执行）", `= ${got.slice(0, 45)}`);
  await call(admin, `/api/qbank/questions/${sqli.json.data.id}`, { method: "DELETE" });
  ok("★ SQL 注入用例已清理");
} else bad("SQL 注入用例建题失败", JSON.stringify(sqli.json).slice(0, 90));

// ══════════════════════════════════════════════════════════════════════
sec("2. 业务边界：难度 / 选项数 / 知识点 / 章节");
const d0 = await call(admin, "/api/qbank/questions", {
  method: "POST", body: { type: "单选题", stem: `${TAG} 难度0`, difficulty: 0, source: "自编", options: ["A", "B"], answer: "A" }
});
exp("难度 0 → 400（CHECK 约束）", d0.status, 400);
const d6 = await call(admin, "/api/qbank/questions", {
  method: "POST", body: { type: "单选题", stem: `${TAG} 难度6`, difficulty: 6, source: "自编", options: ["A", "B"], answer: "A" }
});
exp("难度 6 → 400", d6.status, 400);

const manyOpt = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: {
    type: "多选题", stem: `${TAG} 20个选项`, source: "自编",
    options: Array.from({ length: 20 }, (_, i) => `选项${i}`), answer: "A"
  }
});
if (manyOpt.json.success) {
  const opts = JSON.parse((await call(admin, `/api/qbank/questions/${manyOpt.json.data.id}`)).json.data.options);
  expT(opts.length <= 12, "★ 选项被截断到 12 个", `实际 ${opts.length} 个`);
  await call(admin, `/api/qbank/questions/${manyOpt.json.data.id}`, { method: "DELETE" });
}

const kp99 = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} 不存在的知识点`, source: "自编", options: ["A", "B"], answer: "A", kp_ids: [99999] }
});
if (kp99.json.success) {
  const kp = JSON.parse((await call(admin, `/api/qbank/questions/${kp99.json.data.id}`)).json.data.kp_ids);
  exp("★ 不存在的 kp_id 被过滤掉（当通用题）", kp.length, 0);
  await call(admin, `/api/qbank/questions/${kp99.json.data.id}`, { method: "DELETE" });
} else bad("传不存在的 kp_id 报错", JSON.stringify(kp99.json).slice(0, 90));

const ch99 = await call(admin, "/api/qbank/questions", {
  method: "POST",
  body: { type: "单选题", stem: `${TAG} 不存在的章节`, source: "自编", options: ["A", "B"], answer: "A", chapter_id: 99999 }
});
exp("★ 不存在的 chapter_id → 400（外键约束）", ch99.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("3. 查重边界");
const cd1 = await call(admin, "/api/qbank/questions/check-duplicate", { method: "POST", body: { stem: "" } });
exp("空题干查重 → 400", cd1.status, 400);
const cd2 = await call(admin, "/api/qbank/questions/check-duplicate", { method: "POST", body: { stem: "短" } });
expT(cd2.json.success, "★ 极短题干不报错");
const cd3 = await call(admin, "/api/qbank/questions/check-duplicate", { method: "POST", body: { stem: "x".repeat(5000) } });
exp("查重超长 → 400", cd3.status, 400);

// ══════════════════════════════════════════════════════════════════════
sec("4. 列表边界：非法分页 / 空结果");
const p0 = await call(admin, "/api/qbank/questions?page=0&pageSize=10");
expT(p0.json.success, "★ page=0 不报错");
const pneg = await call(admin, "/api/qbank/questions?page=-1&pageSize=10");
expT(pneg.json.success, "★ page=-1 不报错");
const psBig = await call(admin, "/api/qbank/questions?pageSize=99999");
exp("★ pageSize 超上限被收敛到 100", psBig.json.data.pageSize <= 100, true);
const ps0 = await call(admin, "/api/qbank/questions?pageSize=0");
expT(ps0.json.success, "★ pageSize=0 不报错");
const none = await call(admin, "/api/qbank/questions?keyword=绝对不存在的关键词zzz999");
exp("空结果返回 0 条", none.json.data.total, 0);
expT(Array.isArray(none.json.data.list), "★ 空结果的 list 仍是数组", "= true");

// ══════════════════════════════════════════════════════════════════════
sec("5. 并发写入（同一题被并发修改 8 次）");
const cc = await call(admin, "/api/qbank/questions", {
  method: "POST", body: { type: "单选题", stem: `${TAG} 并发测试`, source: "自编", options: ["A", "B"], answer: "A" }
});
const cid = cc.json.data.id;
const results = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    call(admin, `/api/qbank/questions/${cid}`, { method: "PUT", body: { difficulty: (i % 5) + 1 } })
  )
);
exp("★ 8 个并发 PUT 全部成功（无 500）", results.filter((r) => r.status === 200).length, 8);
const after = await call(admin, `/api/qbank/questions/${cid}`);
expT(after.json.success, "并发后仍可正常读取");
exp("★ 并发修改后 options 未损坏", JSON.parse(after.json.data.options).length, 2);
await call(admin, `/api/qbank/questions/${cid}`, { method: "DELETE" });

// ══════════════════════════════════════════════════════════════════════
sec("6. 回归：既有功能零破坏");
for (const p of ["/", "/ai/", "/qb/"]) {
  const r = await fetch(`${API}${p}`);
  expT(r.status === 200, `${p} → 200`, `= ${r.status}`);
}
const h = await call(admin, "/api/health");
expT(h.json.success, "/api/health 正常");
const stu = await call(admin, "/api/students");
expT(stu.json.success, "★ 学员接口未被破坏");
const att = await call(admin, "/api/attendance/records");
expT(att.status === 200, "/api/attendance/records 未被破坏", `= ${att.status}`);
const fin = await call(admin, "/api/finance/orders");
expT(fin.json.success, "★ 财务接口未被破坏");
const kb = await call(admin, "/api/qbank/overview");
expT(kb.json.success, "题库接口正常");
const aiSso = await call(admin, "/api/ai/sso/ticket", { method: "POST", body: { origin: API } });
expT(aiSso.json.success, "★ AI 工作台免登签票未被题库改动影响");

// ══════════════════════════════════════════════════════════════════════
sec("7. 清理");
await purgeByKeyword(admin, TAG);
const fin2 = await call(admin, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
const finRec2 = await call(admin, `/api/qbank/questions/recycle?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
exp("边界测试数据已清空（列表）", fin2.json.data.total, 0);
exp("边界测试数据已清空（回收站）", finRec2.json.data.total, 0);

console.log(`\n${"=".repeat(56)}`);
console.log(`  M5 结果：PASS ${pass} / FAIL ${fail}`);
if (F.length) { console.log("\n  失败清单："); F.forEach((f) => console.log(`    ✗ ${f}`)); }
console.log(`${"=".repeat(56)}\n`);
process.exit(fail === 0 ? 0 : 1);