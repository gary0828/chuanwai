// 智能题库一期 · 数据契约验证（后端第一层）
//
// 覆盖：题目 CRUD / 筛选 / 查重 / Excel 导入导出 / 章节与知识点/ **权限双角色对照**
//
// ★ 为什么必须有 admin + teacher 双角色（K-011 铁律）：
//   题库的权限模型是「**全校区共享，但只能改自己录入的**」—— 这是唯一一处
//   与项目既有「teacher 仅本班」刻意不同的设计，只测 admin 会漏掉整类越权问题。
//
// 断言打印实际值（K-011），不只打 PASS/FAIL。
//
// 用法：node _verify_test/verify-qbank.mjs [API 基址]
//   默认 http://127.0.0.1:3000
const API = (process.argv[2] || process.env.API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, detail = "") {
  pass += 1;
  console.log(`  PASS  ${label}${detail ? ` → ${detail}` : ""}`);
}
function bad(label, detail = "") {
  fail += 1;
  failures.push(label);
  console.log(`  FAIL  ${label}${detail ? ` → ${detail}` : ""}`);
}
function expect(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) ok(label, `= ${JSON.stringify(actual)}`);
  else bad(label, `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

/** 登录拿 token（注意返回字段是 accessToken，不是 token —— 已实测） */
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
  const json = await res.json();
  const token = json.data?.accessToken || json.data?.token;
  if (!json.success || !token) {
    throw new Error(
      `登录失败 ${username}: ${json.message || `HTTP ${res.status}` } (返回字段=${Object.keys(json.data || {}).join(",")})`
    );
  }
  return token;
}

function api(token, path, options = {}) {
  options = injectCourse(path, options);   // ★ 自动补学科
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
}

/** 测试数据统一前缀，脚本末尾按前缀清理（K-050 测试数据卫生） */
const TAG = "QB测试";

console.log(`\n=== 智能题库一期 · 数据契约验证 ===`);
console.log(`API: ${API}\n`);

// ── 登录 ─────────────────────────────────────────────────────────────
const adminToken = await login("admin", process.env.ADMIN_PW || "admin123456");
TEST_COURSE_ID = await resolveTestCourseId(adminToken);   // ★ 见 injectCourse 注释
const teacherToken = await login("teacher", process.env.TEACHER_PW || "teacher123456");
ok("登录 admin / teacher 双账号", "拿到两个 token");

// ══════════════════════════════════════════════════════════════════════
// 0. 先清掉历史残留（否则重复运行会被上一轮的残留数据污染断言）
// ★ 教训（2026-10-07实测）：首轮跑完没清干净，第二轮「按关键词搜到测试题」
//   期望 2 条实际返回 10 条 —— 断言失败其实是**测试环境脏**，不是代码有问题。
//   定位这种问题前，先排除「上一轮残留」。
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 0. 清理历史残留 ---");
const stale = await api(adminToken, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
const staleIds = (stale.json.data?.list || []).map((q) => q.id);
if (staleIds.length > 0) {
  // batch-delete 里 teacher 无权删 admin 录的，故用 admin token
  const purge = await api(adminToken, "/api/qbank/questions/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids: staleIds })
  });
  ok(`清掉上轮残留 ${staleIds.length} 条`, `删除 ${purge.json.data?.deleted} 条`);
} else {
  ok("无历史残留", "");
}

// ══════════════════════════════════════════════════════════════════════
// 1. 概览
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 1. 题库概览 ---");
const overview = await api(adminToken, "/api/qbank/overview");
expect("GET /overview 成功", overview.json.success, true);
expect(
  "overview 含全部统计维度",
  Object.keys(overview.json.data || {}).sort(),
  ["aiAssisted", "byDifficulty", "bySource", "byStatus", "byType", "total", "withoutKp"]
);

// ══════════════════════════════════════════════════════════════════════
// 2. 建题（含 LaTeX）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 2. 新建题目（LaTeX + 多知识点） ---");
const stem1 = `${TAG} 已知向量 ${"\\vec a"}=(-4,1)，则与它共线的单位向量坐标为`;
const created = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({
    type: "单选题",
    stem: stem1,
    options: ["(1,4)/5", "(-1,-4)/5", "(4,1)/5", "(-4,1)/5"],
    answer: "A",
    analysis: "共线即方向相同或相反，归一化后取首项。",
    difficulty: 3,
    source: "自编",
    solve_method: "向量归一化",
    custom_tags: [TAG, "归一化"],
    exam_year: 2024,
    region: "北京",
    status: "已启用"
  })
});
expect("POST /questions 成功", created.json.success, true);
const qid1 = created.json.data?.id;
expect("返回题目 id 是数字", typeof qid1, "number");
expect("返回 content_hash（查重用）", typeof created.json.data?.content_hash, "string");

const stem2 = `${TAG} 函数求最小值：f(x)=${"\\frac{x^2}{2}"} 的最小值为`;
const created2 = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({
    type: "解答题",
    stem: stem2,
    answer: "0",
    analysis: "配方求二次函数最小值。",
    difficulty: 2,
    source: "AI 原创",
    status: "草稿"
  })
});
const qid2 = created2.json.data?.id;
expect("第二条题建成功", created2.json.success, true);

// ══════════════════════════════════════════════════════════════════════
// 3. 校验与错误提示（K-050：不能静默）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 3. 输入校验必须有明确提示 ---");
const noSource = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({ type: "单选题", stem: `${TAG} 缺来源`, options: ["A", "B"], answer: "A" })
});
expect("缺 source → 400", noSource.status, 400);
expect("缺 source → 提示语含'来源'", noSource.json.message.includes("来源"), true);

const badType = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({ type: "填空", stem: `${TAG} 题型错`, source: "自编" })
});
expect("题型不在枚举 → 400", badType.status, 400);

const noOptions = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({ type: "单选题", stem: `${TAG} 选择题无选项`, source: "自编", options: [] })
});
expect("选择题无选项 → 400", noOptions.status, 400);
expect("选择题无选项 → 提示明确", noOptions.json.message.includes("选项"), true);

const badDifficulty = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({ type: "单选题", stem: `${TAG} 难度越界`, source: "自编", options: ["A", "B"], difficulty: 9 })
});
expect("难度越界 → 400（CHECK 生效）", badDifficulty.status, 400);

const noStem = await api(adminToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({ type: "单选题", stem: "", source: "自编", options: ["A", "B"] })
});
expect("题干为空 → 400", noStem.status, 400);

// ══════════════════════════════════════════════════════════════════════
// 4. 列表与筛选
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 4. 列表与筛选 ---");
const list = await api(adminToken, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
expect("按关键词搜到测试题", list.json.data?.total, 2);

const byType = await api(adminToken, `/api/qbank/questions?type=${encodeURIComponent("解答题")}&keyword=${encodeURIComponent(TAG)}`);
expect("按题型筛选（解答题）", byType.json.data?.total, 1);
expect("筛选结果的题型正确", byType.json.data?.list?.[0]?.type, "解答题");

const bySource = await api(adminToken, `/api/qbank/questions?source=${encodeURIComponent("AI 原创")}&keyword=${encodeURIComponent(TAG)}`);
expect("按来源筛选（AI 原创）", bySource.json.data?.total, 1);

const byStatus = await api(adminToken, `/api/qbank/questions?status=${encodeURIComponent("草稿")}&keyword=${encodeURIComponent(TAG)}`);
expect("按状态筛选（草稿）", byStatus.json.data?.total, 1);

// ★ 关键词要能搜到 LaTeX 内容（验证 LIKE 能穿透公式）
const byFormula = await api(adminToken, `/api/qbank/questions?keyword=${encodeURIComponent("frac")}`);
expect("★ 关键词能搜到 LaTeX 命令 frac", (byFormula.json.data?.total || 0) >= 1, true);

// ══════════════════════════════════════════════════════════════════════
// 5. 详情与修改
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 5. 详情与修改 ---");
const detail = await api(adminToken, `/api/qbank/questions/${qid1}`);
expect("GET 详情成功", detail.json.success, true);
expect("详情含 parse_status", typeof detail.json.data?.parse_status, "string");
expect("详情含 kp_ids（JSON 字符串）", typeof detail.json.data?.kp_ids, "string");

const updated = await api(adminToken, `/api/qbank/questions/${qid1}`, {
  method: "PUT",
  body: JSON.stringify({ difficulty: 5, analysis: "改过的解析" })
});
expect("PUT 改题成功", updated.json.success, true);
const afterUpdate = await api(adminToken, `/api/qbank/questions/${qid1}`);
expect("难度已改为 5", afterUpdate.json.data?.difficulty, 5);
expect("解析已改", afterUpdate.json.data?.analysis, "改过的解析");
expect("★ LaTeX 在修改后仍完好", afterUpdate.json.data?.stem.includes("\\vec a"), true);

// ══════════════════════════════════════════════════════════════════════
// 6. 查重（L1 精确 + L2 近似）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 6. 查重 ---");
const dupExact = await api(adminToken, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: JSON.stringify({ stem: stem1 })
});
expect("同题干 → L1 命中", dupExact.json.data?.exact?.length, 1);
expect("★ 命中项带 id 与题干", typeof dupExact.json.data?.exact?.[0]?.id, "number");

// 空格/标点差异 → L1 也应命中（归一化生效）
// ★ 注意：只差「=」前面的一个空格。算法本身已直接验证过
//   （normalizeStem + contentHash 对该对字符串产出同一哈希），
//   这里失败过一次是因为传参里的空格数与 stem1 不一致 —— 不是算法问题。
const dupNormalized = await api(adminToken, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: JSON.stringify({ stem: stem1.replace("vec a=", "vec a =") })
});
expect("★ 空格差异也算重复（归一化生效）", dupNormalized.json.data?.exact?.length, 1);

// ★ L2 用例设计教训（2026-10-07 返工）：
//   一开始我拿「stem2 + 一个问号」当 L2 用例 —— 但归一化会去掉标点，
//   于是它**先被 L1 精确命中**，根本走不到 L2（exact 有结果、similar 为空）。
//   ⇒ 造 L2 输入必须确保「**实义词有改动**」，哈希才一定不同：
//       只差标点/空格 → 走 L1；改「最小值→最大值」这种实义词 → 才走 L2。
const dupSimilar = await api(adminToken, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  // 保留开头 8 字让粗筛命中，后面实义词不同 → 期望走 L2 且相似度够高
  body: JSON.stringify({ stem: stem2.replace("的最小值为", "的最小值等于") })
});
expect(
  "★ 实义词微调 → 走 L2 命中（exact 为空）",
  [dupSimilar.json.data?.exact?.length, (dupSimilar.json.data?.similar?.length || 0) >= 1],
  [0, true]
);

// L2 相似度必须有区分度：改动越大相似度越低（否则「阈值」形同虚设）
//★ 判据要点：「整题只差一个字」**就该**判为疑似重复 ——
//   题干骨架完全一样、只换了「最小/最大」，对老师来说是**必须知道的**，
//   漏报才是问题（它可能意味着答案也要跟着改）。故三项都期望 true，
//   只有「完全不同学科」应为 false。
//   顺带验证相似度有单调区分度（0.897 / 0.931 / 0.000）。
const simScores = [
  ["仅改末尾一个字", stem2.replace("的最小值为", "的最小值等于"), true],
  ["整题只差一个实义词", stem2.replace("最小值", "最大值"), true],
  ["完全不同学科", "圆锥曲线离心率的取值范围求解方法", false]
];
const measured = [];
for (const [label, probe, expectHit] of simScores) {
  const r = await api(adminToken, "/api/qbank/questions/check-duplicate", {
    method: "POST",
    body: JSON.stringify({ stem: probe })
  });
  const sim = r.json.data?.similar?.[0]?.similarity;
  measured.push([label, sim ?? 0, expectHit]);
  expect(
    `★ L2「${label}」`,
    sim != null && sim >= 0.75,
    expectHit
  );
}
console.log(
  "        （相似度实测：" + measured.map(([l, v]) => `${l}=${v.toFixed(3)}`).join(" / ") + "）"
);
// ★ 区分度硬断言：完全不同学科必须显著低于同族题目，否则阈值就是个摆设。
const sameFamily = Math.min(measured[0][1], measured[1][1]);
const unrelated = measured[2][1];
expect(
  "★ 相似度有区分度（跨学科应显著更低）",
  unrelated < sameFamily / 2,
  true
);

const dupNone = await api(adminToken, "/api/qbank/questions/check-duplicate", {
  method: "POST",
  body: JSON.stringify({ stem: "这是一道完全无关的题目，求圆锥曲线离心率的取值范围" })
});
expect("无关题干 → 不报重复", (dupNone.json.data?.exact?.length || 0) + (dupNone.json.data?.similar?.length || 0), 0);

// ══════════════════════════════════════════════════════════════════════
// 7. 权限双角色对照 ★核心
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 7. 权限双角色对照（teacher 只能改自己录入的） ---");
const tCreate = await api(teacherToken, "/api/qbank/questions", {
  method: "POST",
  body: JSON.stringify({
    type: "单选题",
    stem: `${TAG} 老师自己录的题`,
    options: ["选项甲", "选项乙"],
    answer: "选项甲",
    source: "自编"
  })
});
expect("teacher 也能建题（题库是校区共享资产）", tCreate.json.success, true);
const tqid = tCreate.json.data?.id;

// teacher 改自己的 → 应成功
const tEditOwn = await api(teacherToken, `/api/qbank/questions/${tqid}`, {
  method: "PUT",
  body: JSON.stringify({ difficulty: 4 })
});
expect("★ teacher 改自己录入的题 → 成功", tEditOwn.status, 200);
if (tEditOwn.status !== 200) console.log("        （teacher 改自己失败详情：", JSON.stringify(tEditOwn.json), "）");

// teacher 改 admin 录的 → 应 403
const tEditOther = await api(teacherToken, `/api/qbank/questions/${qid1}`, {
  method: "PUT",
  body: JSON.stringify({ difficulty: 1 })
});
expect("★ teacher 改别人的题 → 403", tEditOther.status, 403);
expect("403 的提示说明了原因", tEditOther.json.message.includes("其他老师"), true);

// teacher 删别人的 → 应 403
const tDeleteOther = await api(teacherToken, `/api/qbank/questions/${qid1}`, { method: "DELETE" });
expect("★ teacher 删别人的题 → 403", tDeleteOther.status, 403);

// ★★ 回归用例（P0 · 双重JSON 编码，2026-10-07 实测修复）：
//   历史 bug：PUT 时 row.options（DB 里的 JSON 字符串）被直接 JSON.stringify 回写
//   → **每改一次难度，选项就多包一层引号**。
//   表现：老师只是改难度，却收到「选择题至少需要2 个选项」—— 报错完全指不到真因，
//   且选项文本已被污染、**不可逆**。
//   判据：连续 PUT 三次 unrelated 字段后，options 必须**逐字节不变**。
{
  const probe = await api(teacherToken, "/api/qbank/questions", {
    method: "POST",
    body: JSON.stringify({
      type: "单选题",
      stem: `${TAG} 双重编码回归探测题`,
      options: ["选项甲", "选项乙"],
      answer: "选项甲",
      source: "自编"
    })
  });
  const pid = probe.json.data?.id;
  const snapshots = [];
  for (let i = 1; i <= 3; i += 1) {
    await api(teacherToken, `/api/qbank/questions/${pid}`, {
      method: "PUT",
      body: JSON.stringify({ difficulty: i })
    });
    const cur = await api(teacherToken, `/api/qbank/questions/${pid}`);
    snapshots.push(cur.json.data?.options);
  }
  const uniq = [...new Set(snapshots)];
  expect("★ 连续改3 次难度后 options 逐字节不变", uniq.length, 1);
  expect(
    "★ options 内容未污染",
    JSON.parse(uniq[0]),
    ["选项甲", "选项乙"]
  );
  await api(adminToken, "/api/qbank/questions/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids: [pid] })
  });
}

// admin 改 teacher 录的 → 应成功（admin 全量）
const aEditTeacher = await api(adminToken, `/api/qbank/questions/${tqid}`, {
  method: "PUT",
  body: JSON.stringify({ difficulty: 5 })
});
expect("★ admin 改 teacher 录的题 → 成功", aEditTeacher.status, 200);
if (aEditTeacher.status !== 200) console.log("        （admin 改 teacher 题失败详情：", JSON.stringify(aEditTeacher.json), " tqid=", tqid, ")");

// teacher 能看到全部题（共享，不是仅本人）
const tList = await api(teacherToken, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
expect("★ teacher 能看到全部题目（共享）", tList.json.data?.total, 3);

// ══════════════════════════════════════════════════════════════════════
// 8. qb_agent 凭证的边界
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 8. qb_agent 凭证权限边界 ---");
// 用免登链路换 qb_agent 凭证：先拿教务 token 签票据
const ticket = await api(adminToken, "/api/ai/sso/ticket", {
  method: "POST",
  body: JSON.stringify({ origin: API, target: "qbank" })
});
expect("签发票据 target=qbank", ticket.json.success, true);
expect("票据 URL 指向 /qb/", String(ticket.json.data?.url || "").includes("/qb/"), true);

const verify = await fetch(`${API}/api/ai/sso/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: ticket.json.data?.ticket })
}).then((r) => r.json());
expect("换会话成功", verify.success, true);
expect("★ verify 返回 qbAgentToken", typeof verify.data?.qbAgentToken, "string");
expect("★ verify 同时返回 qbankUrl", typeof verify.data?.qbankUrl, "string");

const qbToken = verify.data?.qbAgentToken;
const qbRead = await api(qbToken, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
expect("qb_agent 能读 /api/qbank", qbRead.json.success, true);

const qbCross = await api(qbToken, "/api/students");
expect("★ qb_agent 访问 /api/students → 403（不能越界）", qbCross.status, 403);
expect("403提示说明了凭证范围", qbCross.json.message.includes("题库"), true);

const qbAgents = await api(qbToken, "/api/agent/context");
expect("★ qb_agent 访问 /api/agent → 403（不能拿工作台只读网关）", qbAgents.status, 403);

// ══════════════════════════════════════════════════════════════════════
// 9. facets（三个筛选侧栏）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 9. 筛选侧栏数据 ---");
const facets = await api(adminToken, "/api/qbank/facets");
expect("facets 成功", facets.json.success, true);
expect(
  "facets 含五组数据（知识点/章节/方法/标签/年份）",
  Object.keys(facets.json.data || {}).sort(),
  ["chapters", "knowledge", "methods", "tags", "years"]
);
expect("章节数据非空（种子已写入）", (facets.json.data?.chapters?.length || 0) > 0, true);
expect(
  "★ 解题方法来自实际数据（不是预置空枚举）",
  (facets.json.data?.methods || []).some((m) => m.name === "向量归一化"),
  true
);

// ══════════════════════════════════════════════════════════════════════
// 10. Excel 导入导出
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 10. Excel 导入导出 ---");
const tpl = await fetch(`${API}/api/qbank/questions/template.xlsx`, {
  headers: { Authorization: `Bearer ${adminToken}` }
});
expect("模板可下载", tpl.status, 200);
expect("模板是 xlsx MIME", String(tpl.headers.get("content-type")).includes("spreadsheetml"), true);

const importRes = await api(adminToken, "/api/qbank/questions/import", {
  method: "POST",
  body: JSON.stringify({
    rows: [
      {
        type: "单选题",
        stem: `${TAG} 导入第1行：已知集合 A={1,2,3}，则 |A|=`,
        options: ["2", "3", "4", "5"],
        answer: "3",
        analysis: "元素个数",
        difficulty: 1,
        source: "自编",
        year: 2023
      },
      { type: "单选题", stem: `${TAG} 导入第2行来源缺失`, options: ["A", "B"], answer: "A" },
      { type: "不存在的题型", stem: `${TAG} 导入第3行题型非法`, source: "自编" },
      {
        type: "解答题",
        stem: `${TAG} 导入第4行：求 lim(x→0) sin(x)/x`,
        answer: "1",
        difficulty: 4,
        source: "教材",
        solve_method: "极限计算"
      }
    ]
  })
});
expect("导入接口成功", importRes.json.success, true);
expect("★ 部分成功：4行中2 行成功", importRes.json.data?.imported, 2);
expect("★ 失败 2 行", importRes.json.data?.failed, 2);
expect(
  "★ 报错指出具体行号",
  importRes.json.data?.errors?.map((e) => e.row).sort(),
  [3, 4]
);
expect(
  "★ 报错说明是来源问题",
  importRes.json.data?.errors?.[0]?.message?.includes("来源"),
  true
);

const exportRes = await fetch(`${API}/api/qbank/questions/export?keyword=${encodeURIComponent(TAG)}`, {
  headers: { Authorization: `Bearer ${adminToken}` }
});
expect("导出可下载", exportRes.status, 200);
const buf = Buffer.from(await exportRes.arrayBuffer());
expect("导出文件非空", buf.length > 0, true);
expect("导出是合法 xlsx（ZIP 头 PK）", buf.subarray(0, 2).toString(), "PK");

// ══════════════════════════════════════════════════════════════════════
// 11. 批量操作（如实回报跳过数）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 11. 批量操作如实回报 ---");
const batchDel = await api(teacherToken, "/api/qbank/questions/batch-delete", {
  method: "POST",
  body: JSON.stringify({ ids: [tqid, qid1] })
});
expect("teacher 批量删（1是自己的+1是别人的）", batchDel.json.success, true);
expect("★ 只删了有权的1 道", batchDel.json.data?.deleted, 1);
expect("★ 如实回报跳过 1 道", batchDel.json.data?.skipped, 1);
expect("★ 提示语说明了跳过", batchDel.json.data?.message?.includes("跳过"), true);

const batchStatus = await api(adminToken, "/api/qbank/questions/batch-status", {
  method: "POST",
  body: JSON.stringify({ ids: [qid1, qid2], status: "已启用" })
});
expect("批量改状态成功", batchStatus.json.data?.updated, 2);

const badStatus = await api(adminToken, "/api/qbank/questions/batch-status", {
  method: "POST",
  body: JSON.stringify({ ids: [qid1], status: "不存在态" })
});
expect("非法状态 → 400", badStatus.status, 400);

// ══════════════════════════════════════════════════════════════════════
// 12. AI 端点的降级与错误处理（未配 Key 时必须明确报错，不能静默）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 12. AI 端点的失败处理 ---");
const ocrNoImage = await api(adminToken, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: JSON.stringify({})
});
expect("未传图 → 400", ocrNoImage.status, 400);
expect("★ 未传图 → 提示明确", ocrNoImage.json.message.includes("截图"), true);

const ocrBadMime = await api(adminToken, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: JSON.stringify({ image: "data:text/plain;base64,aGVsbG8=" })
});
expect("非图片 MIME → 400", ocrBadMime.status, 400);
expect("★ 非图片 → 提示含格式说明", ocrBadMime.json.message.includes("格式"), true);

// ★ 期望 413 而不是 400：全局 express.json 体积限制（config.jsonBodyLimit）
//   **先于**端点内的 4MB 校验拦下请求 —— 这是正确行为（更早拒绝、不占内存）。
//   index.js 的全局错误处理已把 413 翻译成可读提示，这里断言提示里含"过大"。
const ocrTooBig = await api(adminToken, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: JSON.stringify({ image: `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}` })
});
expect("超大图 → 413（全局体积限制先拦）", ocrTooBig.status, 413);
expect("★ 超大图 → 提示含「过大」", ocrTooBig.json.message.includes("过大"), true);

// ★ 端点内的 4MB 校验：需要一个「解码后> 4MB，但整个 JSON ≤ 全局5mb」的载荷。
//   体积换算：base64 长度 ≈ 原始字节 × 4/3，而 express.json 限制的是**整个 JSON**。
//   全局 5MB = 5 × 1024 × 1024 ≈ 5242880 字符；
//   要解码后 > 4194304（4MB）→ base64 需 > 5592406 字符 → 已超全局限制。
//   ⇒ **窗口不存在**：端点自设的 4MB 在全局 5mb 下**永远拦不到**。
//   这不是测试写错，是**设计矛盾** —— 结论见 qbank-ocr.js 顶部注释，本次按实际行为断言。
const b64Len = Math.floor((4.6 * 1024 * 1024 * 3) / 4); //解码后约 3.45MB < 4MB
const ocrUnder4mb = await api(adminToken, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: JSON.stringify({ image: `data:image/png;base64,${"A".repeat(b64Len)}` })
});
// 未配 Key → 503（说明体积校验已通过，走到依赖检查了 —— 这恰好证明了顺序正确）
expect("★ 体积达标 → 越过体积校验（走到依赖检查 503）", ocrUnder4mb.status, 503);

// ★ 设计矛盾已记录：端点 4MB 上限在全局 5mb 下不可达（详见上方注释与上面那条断言）

const ocrBadData = await api(adminToken, "/api/qbank/ocr/recognize", {
  method: "POST",
  body: JSON.stringify({ image: "这不是 data URL" })
});
expect("非 data URL → 400", ocrBadData.status, 400);

const genNoTopic = await api(adminToken, "/api/qbank/ocr/generate", {
  method: "POST",
  body: JSON.stringify({ count: 3 })
});
expect("出题未给主题 → 400", genNoTopic.status, 400);

// ══════════════════════════════════════════════════════════════════════
// 清理（K-050 测试数据卫生：脚本必须清理自己产生的数据）
// ══════════════════════════════════════════════════════════════════════
console.log("\n--- 清理测试数据（★ 真删，不只是归档）---");
// ★ 按前缀查全量再删，而不是只删「记得的 id」——
//   Excel 导入那2 条是运行时才产生的，id 事先不可知（首轮就漏在这里）。
const leftover = await api(adminToken, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}&pageSize=100`);
const leftoverIds = (leftover.json.data?.list || []).map((q) => q.id);
if (leftoverIds.length > 0) {
  await api(adminToken, "/api/qbank/questions/batch-delete", {
    method: "POST",
    body: JSON.stringify({ ids: leftoverIds })
  });
}
const afterList = await api(adminToken, `/api/qbank/questions?keyword=${encodeURIComponent(TAG)}`);
expect("★ 测试数据已清空", afterList.json.data?.total, 0);

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${"=".repeat(50)}`);
console.log(`结果：PASS ${pass} / FAIL ${fail}`);
if (failures.length) console.log(`失败项：\n  - ${failures.join("\n  - ")}`);
process.exit(fail === 0 ? 0 : 1);