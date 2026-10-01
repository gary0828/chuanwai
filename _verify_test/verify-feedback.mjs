/**
 * 使用反馈模块专项验证（server/src/routes/feedback.js + 迁移 v16）
 * 运行：node _verify_test/verify-feedback.mjs [base]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3100";

let pass = 0;
let fail = 0;

function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${extra ? "  → " + extra : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const post = body => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

console.log(`\n=== 使用反馈模块验证 @ ${BASE} ===\n`);

let r = await req("/api/health");
ok("健康检查 200", r.status === 200, String(r.status));

r = await req(
  "/api/auth/login",
  post({ type: "password", username: "admin", password: "admin123456" })
);
const adminTok = r.body?.data?.accessToken;
ok("admin 登录成功", !!adminTok);

r = await req(
  "/api/auth/login",
  post({ type: "password", username: "teacher", password: "teacher123456" })
);
const teacherTok = r.body?.data?.accessToken;
ok("teacher 登录成功", !!teacherTok);

if (!adminTok || !teacherTok) {
  console.log("\n登录失败，后续用例跳过。");
  process.exit(1);
}

const AH = { Authorization: `Bearer ${adminTok}`, "Content-Type": "application/json" };
const TH = { Authorization: `Bearer ${teacherTok}`, "Content-Type": "application/json" };

r = await req("/api/feedback", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "未登录提交测试" })
});
ok("未登录提交被拒（401）", r.status === 401, String(r.status));

r = await req("/api/feedback", {
  method: "POST",
  headers: TH,
  body: JSON.stringify({ content: "短" })
});
ok("描述过短返回 400", r.status === 400, String(r.status));

r = await req("/api/feedback", {
  method: "POST",
  headers: TH,
  body: JSON.stringify({
    category: "功能异常",
    content: "学生批量导入时第 3 行日期格式报错，但提示里看不出是哪一行出的问题",
    page_path: "/data/students"
  })
});
ok("teacher 提交成功", r.status === 200 && r.body?.data?.id > 0, JSON.stringify(r.body).slice(0, 120));
const fbId = r.body?.data?.id;

r = await req("/api/feedback", {
  method: "POST",
  headers: TH,
  body: JSON.stringify({ category: "不存在的分类", content: "非法分类回落测试内容" })
});
ok("非法分类不报错（回落其他）", r.status === 200, String(r.status));

r = await req("/api/feedback/mine", { headers: TH });
ok(
  "teacher 可看自己的反馈",
  r.status === 200 && (r.body?.data?.list?.length || 0) >= 2,
  JSON.stringify(r.body?.data?.total)
);

r = await req("/api/feedback", { headers: TH });
ok("teacher 访问全量列表被拒（403）", r.status === 403, String(r.status));

r = await req("/api/feedback/summary", { headers: TH });
ok("teacher 访问统计被拒（403）", r.status === 403, String(r.status));

r = await req(`/api/feedback/${fbId}`, {
  method: "PUT",
  headers: TH,
  body: JSON.stringify({ status: "已处理" })
});
ok("teacher 处理反馈被拒（403）", r.status === 403, String(r.status));

r = await req("/api/feedback", { headers: AH });
ok("admin 可看全量", r.status === 200 && (r.body?.data?.total || 0) >= 2, JSON.stringify(r.body?.data?.total));
ok("全量列表不返回敏感字段", !JSON.stringify(r.body).includes("password"));

r = await req("/api/feedback/summary", { headers: AH });
ok(
  "admin 统计含待处理计数",
  r.status === 200 && (r.body?.data?.["待处理"] || 0) >= 2,
  JSON.stringify(r.body?.data)
);

r = await req("/api/feedback?status=待处理", { headers: AH });
ok("按状态筛选生效", r.status === 200, String(r.status));

r = await req(`/api/feedback/${fbId}`, {
  method: "PUT",
  headers: AH,
  body: JSON.stringify({
    status: "已处理",
    admin_reply: "已定位，下个版本会补上导入行号提示"
  })
});
ok("admin 标记已处理并回复", r.status === 200, String(r.status));

r = await req("/api/feedback/mine", { headers: TH });
const handled = r.body?.data?.list?.find(x => x.id === fbId);
ok(
  "teacher 能看到最新状态与管理员回复",
  handled?.status === "已处理" && String(handled?.admin_reply || "").includes("下个版本"),
  JSON.stringify(handled).slice(0, 140)
);

r = await req(`/api/feedback/${fbId}`, {
  method: "PUT",
  headers: AH,
  body: JSON.stringify({ status: "随便写" })
});
ok("非法状态返回 400", r.status === 400, String(r.status));

r = await req("/api/feedback/999999", {
  method: "PUT",
  headers: AH,
  body: JSON.stringify({ status: "已处理" })
});
ok("不存在的反馈返回 404", r.status === 404, String(r.status));

r = await req("/api/feedback/options", { headers: TH });
ok(
  "可选值字典可用",
  r.status === 200 && Array.isArray(r.body?.data?.categories) && Array.isArray(r.body?.data?.statuses)
);

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
