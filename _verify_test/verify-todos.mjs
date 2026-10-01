// L2 待办 API 验证：迁移生效 + 权限边界 + ai_agent 放行
// 用法：node _verify_test/verify-todos.mjs [API_BASE]
const API = process.argv[2] || "http://127.0.0.1:3000";

const PASS = [];
const FAIL = [];
function ok(name, cond, extra = "") {
  (cond ? PASS : FAIL).push(name);
  console.log((cond ? "[OK]   " : "[FAIL] ") + name + (extra ? `  -- ${extra}` : ""));
  return cond;
}

async function login(username, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await r.json();
  if (!j?.data?.accessToken) throw new Error(`登录失败 ${username}: ${JSON.stringify(j)}`);
  return j.data;
}

const H = t => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const get = (p, t) => fetch(`${API}${p}`, { headers: H(t) }).then(r => r.json().then(b => ({ s: r.status, b })));
const post = (p, t, d) =>
  fetch(`${API}${p}`, { method: "POST", headers: H(t), body: JSON.stringify(d) }).then(r =>
    r.json().then(b => ({ s: r.status, b }))
  );
const put = (p, t, d) =>
  fetch(`${API}${p}`, { method: "PUT", headers: H(t), body: JSON.stringify(d) }).then(r =>
    r.json().then(b => ({ s: r.status, b }))
  );
const del = (p, t) =>
  fetch(`${API}${p}`, { method: "DELETE", headers: H(t) }).then(r => r.json().then(b => ({ s: r.status, b })));

const admin = await login("admin", "admin123456");
const teacher = await login("teacher", "teacher123456");

// ★ 登录返回里**没有 id**（buildLoginData 只回 tokens/username/nickname/roles/permissions），
//   所以用户 id 要另查 /api/users —— 否则 owner_id 传成 undefined，指派静默失效
//   （后端会当成"没指派"，测试会误判成产品 bug）。
const usersRes = await fetch(`${API}/api/users?pageSize=100`, {
  headers: H(admin.accessToken)
}).then(r => r.json());
const userRows = usersRes?.data?.list ?? usersRes?.data ?? [];
const findId = uname => userRows.find(u => u.username === uname)?.id;
const adminId = findId("admin");
const teacherId = findId("teacher");
if (!adminId || !teacherId) {
  console.error("[FATAL] 取不到用户 id，脚本无法继续：", JSON.stringify(userRows).slice(0, 200));
  process.exit(1);
}
console.log(`[info] admin id=${adminId}  teacher id=${teacherId}\n`);

const created = [];
try {
  // ── 1. 迁移生效 ──────────────────────────────────────────────
  const list = await get("/api/todos", admin.accessToken);
  ok("迁移 019 生效：GET /api/todos 可用", list.s === 200 && list.b.success === true, `HTTP ${list.s}`);

  // ── 2. 新建（自己的）────────────────────────────────────────
  const t1 = await post("/api/todos", admin.accessToken, {
    title: "__L2_TEST_管理员自己的待办__",
    content: "内容",
    priority: "重要",
    due_date: "2030-01-01"
  });
  ok("新建待办成功", t1.s === 200 && t1.b.success === true, `HTTP ${t1.s}`);
  if (t1.b?.data?.id) created.push(t1.b.data.id);
  const adminTodoId = t1.b?.data?.id;

  // ── 3. 指派给别人（admin 专属）──────────────────────────────
  const t2 = await post("/api/todos", admin.accessToken, {
    title: "__L2_TEST_指派给老师的待办__",
    owner_id: teacherId,
    priority: "紧急"
  });
  ok("admin 可指派待办给他人", t2.s === 200 && t2.b.success === true, `HTTP ${t2.s}`);
  if (t2.b?.data?.id) created.push(t2.b.data.id);
  const teacherTodoId = t2.b?.data?.id;

  // ── 4. 越权：teacher 传 scope=all 也只看到自己的 ──────────────
  const tAll = await get("/api/todos?scope=all&pageSize=100", teacher.accessToken);
  const tAllTitles = (tAll.b?.data?.list ?? []).map(x => x.title);
  ok(
    "★ teacher 传 scope=all 被收敛（看不到管理员那条）",
    tAll.s === 200 && !tAllTitles.includes("__L2_TEST_管理员自己的待办__"),
    `可见 ${tAllTitles.length} 条`
  );
  ok(
    "teacher 能看到指派给自己的那条",
    tAllTitles.includes("__L2_TEST_指派给老师的待办__")
  );

  // ── 5. 越权：teacher 改/删别人的 → 403 ──────────────────────
  const tPut = await put(`/api/todos/${adminTodoId}`, teacher.accessToken, { title: "改别人的" });
  ok("★ teacher 改别人的待办 → 403", tPut.s === 403, `HTTP ${tPut.s}`);
  const tDel = await del(`/api/todos/${adminTodoId}`, teacher.accessToken);
  ok("★ teacher 删别人的待办 → 403", tDel.s === 403, `HTTP ${tDel.s}`);

  // ── 6. teacher 改自己的 → 200，且能标记完成 ──────────────────
  const tOwn = await put(`/api/todos/${teacherTodoId}`, teacher.accessToken, {
    status: "已完成"
  });
  ok("teacher 可标记自己的待办完成", tOwn.s === 200 && tOwn.b.success === true, `HTTP ${tOwn.s}`);
  const after = await get("/api/todos?status=已完成&pageSize=100", teacher.accessToken);
  const done = (after.b?.data?.list ?? []).find(x => x.id === teacherTodoId);
  ok("完成状态已持久化且带 completed_at", !!done && done.status === "已完成" && !!done.completed_at,
     done ? `status=${done.status} completed_at=${done.completed_at}` : "未找到");

  // ── 7. 非法枚举被拦 ─────────────────────────────────────────
  const bad = await post("/api/todos", admin.accessToken, {
    title: "__L2_TEST_非法优先级__",
    priority: "超级紧急"
  });
  ok("非法优先级被收敛为默认值（不报 500）", bad.s === 200, `HTTP ${bad.s}`);
  if (bad.b?.data?.id) created.push(bad.b.data.id);
  const badRow = (await get("/api/todos?pageSize=100", admin.accessToken)).b.data.list.find(
    x => x.id === bad.b?.data?.id
  );
  ok("非法优先级落库为「普通」", badRow?.priority === "普通", `实际=${badRow?.priority}`);

  const noTitle = await post("/api/todos", admin.accessToken, { title: "" });
  ok("空标题 → 400", noTitle.s === 400, `HTTP ${noTitle.s}`);

  // ── 8. ai_agent 放行（工作台凭证）────────────────────────────
  const ticket = await post("/api/ai/sso/ticket", admin.accessToken, {});
  const tk = ticket.b?.data?.ticket;
  if (tk) {
    const v = await post("/api/ai/sso/verify", null, { ticket: tk });
    const agentToken = v.b?.data?.token || v.b?.data?.agentToken;
    if (agentToken) {
      const ag = await get("/api/todos?scope=mine", agentToken);
      ok("★ ai_agent 凭证可读 /api/todos（放行生效）", ag.s === 200 && ag.b.success === true, `HTTP ${ag.s}`);
      const agWrite = await post("/api/todos", agentToken, { title: "__L2_TEST_工作台建的单__" });
      ok("★ ai_agent 可写 /api/todos（读写同权）", agWrite.s === 200, `HTTP ${agWrite.s}`);
      if (agWrite.b?.data?.id) created.push(agWrite.b.data.id);
      const agForbid = await get("/api/finance/orders", agentToken);
      ok("ai_agent 访问未放行路径仍 403（未过度放行）", agForbid.s === 403, `HTTP ${agForbid.s}`);
    } else {
      ok("取到 ai_agent 凭证", false, JSON.stringify(v.b).slice(0, 160));
    }
  } else {
    ok("取到 SSO ticket", false, JSON.stringify(ticket.b).slice(0, 160));
  }
} finally {
  // 清理
  let n = 0;
  for (const id of created) {
    const r = await del(`/api/todos/${id}`, admin.accessToken);
    if (r.s === 200) n++;
  }
  const left = (await get("/api/todos?scope=all&pageSize=100", admin.accessToken)).b.data.list.filter(
    x => String(x.title).startsWith("__L2_TEST_")
  );
  console.log(`\n[info] 已清理 ${n}/${created.length} 条；残留 ${left.length} 条`);
  if (left.length) console.log("[warn] 残留:", left.map(x => x.title));
}

console.log("\n" + "=".repeat(54));
console.log(`  L2 待办 API 验证：${PASS.length}/${PASS.length + FAIL.length}`);
console.log("=".repeat(54));
if (FAIL.length) FAIL.forEach(f => console.log("  失败：" + f));
process.exit(FAIL.length ? 1 : 0);
