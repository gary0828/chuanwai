/**
 * C3 + C2（个人中心 / 自助改密码 / 员工头像）API 验证
 *
 * 用法：node _verify_test/verify-profile.mjs [API_BASE]
 *   API_BASE 缺省 http://127.0.0.1:18080（统一入口单端口）
 *
 * ★ 双角色对照（K-011）：只测 admin 会漏掉整类权限问题。
 *   - teacher：自助三端点必须**能用**（这是本次要解决的核心痛点）
 *   - teacher：admin 专属端点（员工列表 / 重置他人密码）必须**被拒**
 *
 * ★ 断言打印实际值，不只打 PASS/FAIL（K-011）。
 * ★ 用 teacher 账号做写操作，并在 finally 里恢复原密码与姓名，避免污染环境。
 */
import fs from "node:fs";
import path from "node:path";

const API = process.argv[2] || "http://127.0.0.1:18080";
const ASSET_DIR = path.resolve(process.cwd(), "server/data/assets/avatars");

const PASS = [];
const FAIL = [];
const SKIP = [];
function ok(name, cond, extra = "") {
  (cond ? PASS : FAIL).push(name);
  console.log(
    (cond ? "[OK]   " : "[FAIL] ") + name + (extra ? `  -- ${extra}` : "")
  );
  return cond;
}
function skip(name, why) {
  SKIP.push(name);
  console.log(`[SKIP] ${name}  -- ${why}`);
}

async function login(username, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, data: j?.data };
}

const H = t => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const get = (p, t) =>
  fetch(`${API}${p}`, { headers: H(t) }).then(r =>
    r.json().then(b => ({ s: r.status, b }))
  );
const put = (p, t, d) =>
  fetch(`${API}${p}`, { method: "PUT", headers: H(t), body: JSON.stringify(d) }).then(r =>
    r.json().then(b => ({ s: r.status, b }))
  );

/** 1×1 PNG（合法魔数） */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);
const NOT_IMAGE = Buffer.from("this is definitely not an image, just text");

async function uploadAvatar(token, buf, mime = "image/png") {
  const r = await fetch(`${API}/api/auth/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mime },
    body: buf
  });
  const b = await r.json().catch(() => ({}));
  return { s: r.status, b };
}

/** 磁盘上某用户的头像文件（用于验证「上传后清理旧头像」） */
function avatarFiles(uid) {
  try {
    return fs
      .readdirSync(ASSET_DIR)
      .filter(f => f.startsWith(`avatar-${uid}-`))
      .sort();
  } catch {
    return [];
  }
}

const ADMIN_PWD = "admin123456";
const TEACHER_PWD = "teacher123456";
const NEW_PWD = "teacher123456__tmp";
const NEW_PWD2 = "teacher123456__tmp2";

const admin = (await login("admin", ADMIN_PWD)).data;
const teacher = (await login("teacher", TEACHER_PWD)).data;
if (!admin?.accessToken || !teacher?.accessToken) {
  console.error("[FATAL] 登录失败，无法继续。请确认服务已启动且默认口令未改。");
  process.exit(1);
}

/** staff id 需要另查（登录返回体不含 id） */
const userRows = await fetch(`${API}/api/users?pageSize=100`, {
  headers: H(admin.accessToken)
}).then(r => r.json());
const list = userRows?.data?.list ?? [];
const findId = u => list.find(x => x.username === u)?.id;
const adminId = findId("admin");
const teacherId = findId("teacher");
console.log(`[info] API=${API}\n[info] admin id=${adminId}  teacher id=${teacherId}\n`);

const teacherInfo = await get("/api/auth/info", teacher.accessToken);
const ORIG_NAME = teacherInfo.b?.data?.name ?? "";
const ORIG_PHONE = teacherInfo.b?.data?.phone ?? "";
const adminInfo = await get("/api/auth/info", admin.accessToken);
const ADMIN_PHONE = adminInfo.b?.data?.phone ?? "";

let avatarCleaned = false;

try {
  // ── 1. 迁移 v20 生效（users.avatar 字段贯通）──────────────────────
  ok(
    "v20 迁移生效：/api/auth/info 返回 avatar 字段",
    typeof teacherInfo.b?.data?.avatar === "string",
    `avatar=${JSON.stringify(teacherInfo.b?.data?.avatar)}`
  );
  ok(
    "登录返回体含 avatar 字段（非硬编码空串的老行为）",
    Object.prototype.hasOwnProperty.call(teacher, "avatar"),
    `avatar=${JSON.stringify(teacher.avatar)}`
  );
  ok(
    "员工列表返回 avatar 字段（员工管理页头像列的数据源）",
    list.length > 0 && Object.prototype.hasOwnProperty.call(list[0], "avatar"),
    `首行字段=${list[0] ? Object.keys(list[0]).join(",") : "(空)"}`
  );

  // ── 2. 自助改资料 ────────────────────────────────────────────────
  const emptyName = await put("/api/auth/profile", teacher.accessToken, {
    name: "   ",
    phone: ""
  });
  ok("自助改资料：空姓名被拒（400）", emptyName.s === 400, `HTTP ${emptyName.s}`);

  const badPhone = await put("/api/auth/profile", teacher.accessToken, {
    name: ORIG_NAME,
    phone: "123"
  });
  ok("自助改资料：非法手机号被拒（400）", badPhone.s === 400, `HTTP ${badPhone.s}`);

  if (ADMIN_PHONE) {
    const dupPhone = await put("/api/auth/profile", teacher.accessToken, {
      name: ORIG_NAME,
      phone: ADMIN_PHONE
    });
    ok(
      "自助改资料：手机号与他人重复被拒（400）",
      dupPhone.s === 400,
      `HTTP ${dupPhone.s} msg=${dupPhone.b?.message ?? ""}`
    );
  } else {
    skip("自助改资料：手机号与他人重复被拒", "admin 未设置手机号，无法构造重复场景");
  }

  const tmpName = `${ORIG_NAME}__tmp`;
  const tmpPhone = "13900001111";
  const changed = await put("/api/auth/profile", teacher.accessToken, {
    name: tmpName,
    phone: tmpPhone
  });
  ok("自助改资料：本人可改姓名/手机号（200）", changed.s === 200, `HTTP ${changed.s}`);
  const afterChange = await get("/api/auth/info", teacher.accessToken);
  ok(
    "自助改资料：改动已落库（回读一致）",
    afterChange.b?.data?.name === tmpName && afterChange.b?.data?.phone === tmpPhone,
    `回读 name=${afterChange.b?.data?.name} phone=${afterChange.b?.data?.phone}`
  );

  // ★ 部分更新语义（2026-09-23 代码审查修正）：只传 name 不应把 phone 清空
  const partial = await put("/api/auth/profile", teacher.accessToken, { name: tmpName });
  const afterPartial = await get("/api/auth/info", teacher.accessToken);
  ok(
    "自助改资料：只传 name 时 phone 保持不变（部分更新不清空）",
    partial.s === 200 && afterPartial.b?.data?.phone === tmpPhone,
    `HTTP ${partial.s} phone=${afterPartial.b?.data?.phone ?? "(空)"}（期望 ${tmpPhone}）`
  );

  // 传空串才表示清空
  const cleared = await put("/api/auth/profile", teacher.accessToken, {
    name: tmpName,
    phone: ""
  });
  const afterClear = await get("/api/auth/info", teacher.accessToken);
  ok(
    "自助改资料：显式传空串才清空 phone",
    cleared.s === 200 && afterClear.b?.data?.phone === "",
    `HTTP ${cleared.s} phone=${JSON.stringify(afterClear.b?.data?.phone)}`
  );

  // 还原手机号，供后续"重复手机号"断言使用
  await put("/api/auth/profile", teacher.accessToken, {
    name: tmpName,
    phone: tmpPhone
  });

  // ★ 越权尝试：资料接口不应能提权
  await put("/api/auth/profile", teacher.accessToken, {
    name: tmpName,
    phone: tmpPhone,
    role: "admin",
    username: "hacker",
    avatar: "/assets/avatars/hacked.png"
  });
  const afterEscalate = await get("/api/auth/info", teacher.accessToken);
  ok(
    "自助改资料：无法提权（role 仍为 teacher）",
    JSON.stringify(afterEscalate.b?.data?.roles) === JSON.stringify(["teacher"]),
    `roles=${JSON.stringify(afterEscalate.b?.data?.roles)}`
  );
  ok(
    "自助改资料：无法改用户名（仍是 teacher）",
    afterEscalate.b?.data?.username === "teacher",
    `username=${afterEscalate.b?.data?.username}`
  );

  // ── 3. 自助改密码 ────────────────────────────────────────────────
  const wrongOld = await put("/api/auth/password", teacher.accessToken, {
    old_password: "definitely-wrong",
    password: NEW_PWD
  });
  ok("自助改密码：原密码错误被拒（400）", wrongOld.s === 400, `HTTP ${wrongOld.s}`);

  const tooShort = await put("/api/auth/password", teacher.accessToken, {
    old_password: TEACHER_PWD,
    password: "1234567"
  });
  ok("自助改密码：新密码 <8 位被拒（400）", tooShort.s === 400, `HTTP ${tooShort.s}`);

  const samePwd = await put("/api/auth/password", teacher.accessToken, {
    old_password: TEACHER_PWD,
    password: TEACHER_PWD
  });
  ok("自助改密码：新旧密码相同被拒（400）", samePwd.s === 400, `HTTP ${samePwd.s}`);

  const changed2 = await put("/api/auth/password", teacher.accessToken, {
    old_password: TEACHER_PWD,
    password: NEW_PWD
  });
  ok("自助改密码：正确原密码 → 修改成功（200）", changed2.s === 200, `HTTP ${changed2.s}`);

  // ★ 核心口径：改完必须吊销全部已签发凭证（H2）
  const oldTokenAfter = await get("/api/auth/info", teacher.accessToken);
  ok(
    "自助改密码：旧 accessToken 立即失效（401，强制重登）",
    oldTokenAfter.s === 401,
    `HTTP ${oldTokenAfter.s}`
  );

  const oldPwdLogin = await login("teacher", TEACHER_PWD);
  ok("自助改密码：旧密码无法再登录（400）", oldPwdLogin.status === 400, `HTTP ${oldPwdLogin.status}`);

  const newPwdLogin = await login("teacher", NEW_PWD);
  ok(
    "自助改密码：新密码可正常登录",
    newPwdLogin.status === 200 && !!newPwdLogin.data?.accessToken,
    `HTTP ${newPwdLogin.status}`
  );

  // 换回原密码（后续步骤继续用新 token）
  let tToken = newPwdLogin.data.accessToken;
  const back = await put("/api/auth/password", tToken, {
    old_password: NEW_PWD,
    password: TEACHER_PWD
  });
  ok("自助改密码：可改回原密码（验证可重复修改）", back.s === 200, `HTTP ${back.s}`);
  const reLogin = await login("teacher", TEACHER_PWD);
  ok("自助改密码：改回后原密码可登录", reLogin.status === 200, `HTTP ${reLogin.status}`);
  tToken = reLogin.data.accessToken;

  // ── 4. 头像上传 ──────────────────────────────────────────────────
  const before = avatarFiles(teacherId);
  const up1 = await uploadAvatar(tToken, PNG);
  const url1 = up1.b?.data?.avatar ?? "";
  ok(
    "上传头像：PNG 上传成功（200）且返回 /assets/avatars/ 相对路径",
    up1.s === 200 && url1.startsWith(`/assets/avatars/avatar-${teacherId}-`),
    `HTTP ${up1.s} url=${url1}`
  );

  const afterUp = await get("/api/auth/info", tToken);
  ok(
    "上传头像：路径已写入 users.avatar（回读一致）",
    afterUp.b?.data?.avatar === url1,
    `回读 avatar=${afterUp.b?.data?.avatar}`
  );

  const badUp = await uploadAvatar(tToken, NOT_IMAGE, "image/png");
  ok(
    "上传头像：非图片内容被魔数判型拒绝（400，忽略声明的 MIME）",
    badUp.s === 400,
    `HTTP ${badUp.s} msg=${badUp.b?.message ?? ""}`
  );

  const up2 = await uploadAvatar(tToken, PNG);
  const url2 = up2.b?.data?.avatar ?? "";
  const filesNow = avatarFiles(teacherId);
  avatarCleaned = true;
  ok(
    "上传头像：再次上传生成新文件名（不覆盖同名）",
    up2.s === 200 && url2 !== url1,
    `url1=${url1} url2=${url2}`
  );
  ok(
    "上传头像：旧头像文件已从磁盘清理（该用户仅剩 1 个文件）",
    filesNow.length === 1 && filesNow[0].includes(url2.split("/").pop()),
    `目录内 avatar-${teacherId}-* 文件数=${filesNow.length}（上传前 ${before.length}） files=${filesNow.join(",")}`
  );

  // ── 5. 权限边界（★ 双角色对照）───────────────────────────────────
  const tUsers = await get("/api/users", tToken);
  ok(
    "权限边界：teacher 访问员工列表被拒（403）",
    tUsers.s === 403,
    `HTTP ${tUsers.s}`
  );

  const tReset = await put(`/api/users/${adminId}/password`, tToken, {
    password: "hacked12345"
  });
  ok(
    "权限边界：teacher 重置他人密码被拒（403）",
    tReset.s === 403,
    `HTTP ${tReset.s}`
  );

  // teacher 自己的自助端点仍可用
  const tStillFine = await get("/api/auth/info", tToken);
  ok(
    "权限边界：teacher 自助端点仍可用（未被误伤）",
    tStillFine.s === 200,
    `HTTP ${tStillFine.s}`
  );
} finally {
  // ── 收尾：恢复 teacher 姓名 / 手机号（密码已在流程中改回）────────
  try {
    const cur = await login("teacher", TEACHER_PWD);
    if (cur?.data?.accessToken) {
      const r = await put("/api/auth/profile", cur.data.accessToken, {
        name: ORIG_NAME,
        phone: ORIG_PHONE
      });
      console.log(
        r.s === 200
          ? `[info] 已恢复 teacher 资料：name=${ORIG_NAME} phone=${ORIG_PHONE || "(空)"}`
          : `[WARN] 恢复教师资料失败 HTTP ${r.s}`
      );
    } else {
      console.log("[WARN] 收尾登录失败，teacher 姓名/手机号可能未恢复（密码已恢复）");
    }
  } catch (e) {
    console.log("[WARN] 收尾异常：", e.message);
  }
  if (avatarCleaned) {
    console.log(
      `[info] teacher 头像已设置（演示数据）：${JSON.stringify(avatarFiles(teacherId))}`
    );
  }
}

console.log(
  `\n======= 结果：PASS ${PASS.length} / FAIL ${FAIL.length} / SKIP ${SKIP.length} =======`
);
if (FAIL.length) console.log("失败项：\n - " + FAIL.join("\n - "));
process.exit(FAIL.length ? 1 : 0);
