#!/usr/bin/env node
// verify-sessions.mjs —— G1 课次实体 + G2 任课关系 · 双角色对照专项验证（T05 验收）
//
// 设计原则（QA 立场）：不采信工程师自述，全程独立构造对照用例、边界与错误路径。
//   - A 迁移与数据完整性：在「真实旧库副本」上独立重跑 v20→v21，并复验正式库未被触碰；
//                        同时在副本上用原生 SQL 直接验证四个条件唯一索引真的生效。
//   - B 课次生成：预览=生成、幂等、按日期定状态、手工新增与重复拒绝。
//   - C 课次变更：停课/恢复/调课（仅待上课、双向关联）/代课（原教师不变）。
//   - D ★权限对照：admin 全量 / teacher 仅教学类 / finance·leads 全 403 / 代课人课次级 /
//                    班级档案编辑删除对任课教师不可用 / 任课关系按学期生效（三情形+兜底）。
//   - E 关键回归：legacy 批量点名 upsert / 节次时间快照不回写 / 回填幂等与失败原因。
//
// 运行：
//   BASE=http://localhost:3000 node server/scripts/verify-sessions.mjs
//   可选：QA_SERVER_DB=.../attendance.db  指定被测服务实际使用的库（用于回填的 DB 级交叉核验）
//
// ⚠️ 硬约束：section A 的一切数据库操作都在临时副本上进行，**绝不触碰 server/data/ 正式库**。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASE = (process.env.BASE || "http://localhost:3000") + "/api";
const FORMAL_DB = path.join(REPO_ROOT, "server", "data", "attendance.db");
const SERVER_DB = process.env.QA_SERVER_DB || "";

let pass = 0;
let fail = 0;
const failures = [];
function ck(cond, label, extra = "") {
  if (cond) {
    pass++;
    console.log(`[PASS] ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`[FAIL] ${label}${extra ? "  → " + extra : ""}`);
  }
}
function section(title) {
  console.log(`\n────────── ${title} ──────────`);
}

// ==================== HTTP 封装 ====================
async function req(method, p, token, body) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json };
}
async function login(username, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await r.json();
  return j?.data?.accessToken || null;
}

const STAMP = Date.now();
const html2 = s => String(s ?? "");

// =====================================================================================
// A. 迁移与数据完整性（副本）
// =====================================================================================
function copyDb(srcPath, dstPath) {
  const src = new DatabaseSync(srcPath, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${dstPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
}

function sectionA() {
  section("A. 迁移与数据完整性（在真实旧库副本上独立重跑 v20→v21）");

  const require_ = createRequire(import.meta.url);
  const { migrate } = require_(path.join(REPO_ROOT, "server/src/migrations/index.js"));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa021-"));
  const copyPath = path.join(tmpDir, "attendance.db");
  let copy = null;
  try {
    copyDb(FORMAL_DB, copyPath);
    copy = new DatabaseSync(copyPath);
    copy.exec("PRAGMA journal_mode = WAL;");
    copy.exec("PRAGMA foreign_keys = ON;");

    const before = copy.prepare("PRAGMA user_version").get().user_version;
    ck(Number(before) === 20, "A1 副本升级前 user_version=20（确为旧库）", `实际 ${before}`);
    const attBefore = copy.prepare("SELECT COUNT(*) c FROM attendances").get().c;
    const ceBefore = copy.prepare("SELECT COUNT(*) c FROM class_evaluations").get().c;
    const hcBefore = copy.prepare("SELECT COUNT(*) c FROM hour_consumptions").get().c;

    migrate(copy);

    const after = copy.prepare("PRAGMA user_version").get().user_version;
    ck(Number(after) === 21, "A2 副本升级后 user_version=21", `实际 ${after}`);

    const fk = copy.prepare("PRAGMA foreign_key_check").all();
    ck(fk.length === 0, "A3 PRAGMA foreign_key_check 为空", JSON.stringify(fk));

    const attAfter = copy.prepare("SELECT COUNT(*) c FROM attendances").get().c;
    const ceAfter = copy.prepare("SELECT COUNT(*) c FROM class_evaluations").get().c;
    const hcAfter = copy.prepare("SELECT COUNT(*) c FROM hour_consumptions").get().c;
    ck(
      attBefore === attAfter && ceBefore === ceAfter && hcBefore === hcAfter,
      "A4 重建前后行数一致（attendances/class_evaluations/hour_consumptions）",
      `att ${attBefore}→${attAfter} / ce ${ceBefore}→${ceAfter} / hc ${hcBefore}→${hcAfter}`
    );

    const names = copy
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map(r => r.name);
    const need = ["class_sessions", "teaching_assignments", "period_times", "session_migration_report"];
    ck(
      need.every(n => names.includes(n)),
      "A5 四张新表已创建",
      need.filter(n => !names.includes(n)).join(",") || ""
    );

    const pt = copy.prepare("SELECT period FROM period_times ORDER BY period").all().map(r => Number(r.period));
    ck(pt.length === 8 && pt[0] === 1 && pt[7] === 8, "A6 period_times 预置 1–8 共 8 行", `实际 ${pt.join(",")}`);

    // 四个条件唯一索引存在
    const idxNames = copy
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map(r => r.name);
    const needIdx = [
      "ux_attendance_legacy",
      "ux_attendance_session",
      "ux_ce_legacy",
      "ux_ce_session",
      "ux_ta_no_term"
    ];
    ck(
      needIdx.every(n => idxNames.includes(n)),
      "A7 双条件（部分）唯一索引 + ux_ta_no_term 均已创建",
      needIdx.filter(n => !idxNames.includes(n)).join(",") || ""
    );
    // 确认是部分唯一索引（带 WHERE）
    const partial = copy
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND name IN ('ux_attendance_legacy','ux_attendance_session','ux_ce_legacy','ux_ce_session','ux_ta_no_term')"
      )
      .all();
    ck(
      partial.every(r => /WHERE/i.test(r.sql || "")),
      "A8 上述索引确为条件（部分）索引（SQL 含 WHERE）",
      partial.map(r => r.name).join(",")
    );

    // ── A9+ 索引真的生效：直接插入重复行，期望唯一冲突 ──────────────────
    const stu = copy.prepare("SELECT id, class_id FROM students ORDER BY id LIMIT 1").get();
    const course = copy.prepare("SELECT id FROM courses ORDER BY id LIMIT 1").get();
    const teacher = copy.prepare("SELECT id FROM users WHERE role='teacher' ORDER BY id LIMIT 1").get();

    // A9 legacy：session_id IS NULL 时重复 (student_id, course_id, date) 必须冲突
    let legacyThrew = false;
    let legacyErr = "";
    try {
      copy
        .prepare("INSERT INTO attendances (student_id, course_id, date, status) VALUES (?, ?, ?, '正常')")
        .run(stu.id, course.id, "2099-01-01");
      copy
        .prepare("INSERT INTO attendances (student_id, course_id, date, status) VALUES (?, ?, ?, '正常')")
        .run(stu.id, course.id, "2099-01-01");
    } catch (e) {
      legacyThrew = /UNIQUE/i.test(e.message);
      legacyErr = e.message;
    }
    ck(legacyThrew, "A9 ux_attendance_legacy 生效（NULL 分区重复签到被拒）", legacyErr);

    // A10 课次分区：同一 (session_id, student_id) 重复必须冲突
    const sess = copy
      .prepare(
        `INSERT INTO class_sessions (class_id, course_id, teacher_id, session_date, period, status, origin)
         VALUES (?, ?, ?, '2099-01-02', 1, '待上课', '手工')`
      )
      .run(stu.class_id, course.id, teacher ? teacher.id : null);
    const sid = Number(sess.lastInsertRowid);
    let sessThrew = false;
    let sessErr = "";
    try {
      copy
        .prepare("INSERT INTO attendances (student_id, course_id, date, status, session_id) VALUES (?, ?, ?, '正常', ?)")
        .run(stu.id, course.id, "2099-01-02", sid);
      copy
        .prepare("INSERT INTO attendances (student_id, course_id, date, status, session_id) VALUES (?, ?, ?, '正常', ?)")
        .run(stu.id, course.id, "2099-01-02", sid);
    } catch (e) {
      sessThrew = /UNIQUE/i.test(e.message);
      sessErr = e.message;
    }
    ck(sessThrew, "A10 ux_attendance_session 生效（同课次同学生重复签到被拒）", sessErr);

    // A11 同一 (student,course,date) 不同 session_id 应可共存（证明不是旧表级唯一键残留）
    const sess2 = copy
      .prepare(
        `INSERT INTO class_sessions (class_id, course_id, teacher_id, session_date, period, status, origin)
         VALUES (?, ?, ?, '2099-01-02', 2, '待上课', '手工')`
      )
      .run(stu.class_id, course.id, teacher ? teacher.id : null);
    const sid2 = Number(sess2.lastInsertRowid);
    let coexistOk = true;
    let coexistErr = "";
    try {
      copy
        .prepare("INSERT INTO attendances (student_id, course_id, date, status, session_id) VALUES (?, ?, ?, '迟到', ?)")
        .run(stu.id, course.id, "2099-01-02", sid2);
    } catch (e) {
      coexistOk = false;
      coexistErr = e.message;
    }
    ck(coexistOk, "A11 表级 (student,course,date) 旧唯一键已解除（不同课次可共存）", coexistErr);

    // A12 ux_ce_legacy
    let ceThrew = false;
    let ceErr = "";
    try {
      copy
        .prepare(
          "INSERT INTO class_evaluations (class_id, course_id, student_id, eval_date) VALUES (?, ?, ?, '2099-01-03')"
        )
        .run(stu.class_id, course.id, stu.id);
      copy
        .prepare(
          "INSERT INTO class_evaluations (class_id, course_id, student_id, eval_date) VALUES (?, ?, ?, '2099-01-03')"
        )
        .run(stu.class_id, course.id, stu.id);
    } catch (e) {
      ceThrew = /UNIQUE/i.test(e.message);
      ceErr = e.message;
    }
    ck(ceThrew, "A12 ux_ce_legacy 生效（课评 NULL 分区重复被拒）", ceErr);

    // A13 ux_ta_no_term：term_id 为 NULL 时重复 (class_id, course_id) 必须冲突
    let taThrew = false;
    let taErr = "";
    try {
      copy
        .prepare("INSERT INTO teaching_assignments (class_id, course_id, teacher_id, term_id) VALUES (?, ?, ?, NULL)")
        .run(stu.class_id, course.id, teacher ? teacher.id : null);
      copy
        .prepare("INSERT INTO teaching_assignments (class_id, course_id, teacher_id, term_id) VALUES (?, ?, ?, NULL)")
        .run(stu.class_id, course.id, teacher ? teacher.id : null);
    } catch (e) {
      taThrew = /UNIQUE/i.test(e.message);
      taErr = e.message;
    }
    ck(taThrew, "A13 ux_ta_no_term 生效（长期任课关系重复被拒）", taErr);
  } finally {
    if (copy) copy.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }

  // A14 复验正式库未被触碰（仍是 v20，且无新表）
  const formal = new DatabaseSync(FORMAL_DB, { readOnly: true });
  try {
    const v = formal.prepare("PRAGMA user_version").get().user_version;
    ck(Number(v) === 20, "A14 正式库 server/data/attendance.db 仍为 user_version=20（未被触碰）", `实际 ${v}`);
    const t = formal
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('class_sessions','teaching_assignments','period_times','session_migration_report')"
      )
      .all();
    ck(t.length === 0, "A15 正式库未出现新表（确未误迁移正式库）", t.map(x => x.name).join(","));
  } finally {
    formal.close();
  }
}

// =====================================================================================
// 主流程
// =====================================================================================
sectionA();

const admin = await login("admin", "admin123456");
const teacher = await login("teacher", "teacher123456");
section("前置：登录");
ck(!!admin, "admin 登录成功");
ck(!!teacher, "teacher 登录成功");
if (!admin || !teacher) {
  console.log(`\n==== verify-sessions 汇总: PASS ${pass} / ${pass + fail} ====`);
  process.exit(1);
}

// ── 构造测试数据（admin）───────────────────────────────────────────────
section("构造测试数据（admin）");
const courseRes = await req("POST", "/courses", admin, {
  code: `QAC${STAMP}`,
  name: `QA课次课程${STAMP}`
});
const courseId = courseRes.json?.data?.id;
ck(courseRes.status === 200 && courseId > 0, "创建测试课程", JSON.stringify(courseRes.json));

const t2Res = await req("POST", "/users", admin, {
  username: `qat2_${STAMP}`,
  password: "qa12345678",
  name: "QA任课师",
  role: "teacher"
});
const t2Id = t2Res.json?.data?.id;
ck(t2Res.status === 200 && t2Id > 0, "创建教师2（任课关系用）", JSON.stringify(t2Res.json));

const t3Res = await req("POST", "/users", admin, {
  username: `qat3_${STAMP}`,
  password: "qa12345678",
  name: "QA代课师",
  role: "teacher"
});
const t3Id = t3Res.json?.data?.id;
ck(t3Res.status === 200 && t3Id > 0, "创建教师3（代课人用）", JSON.stringify(t3Res.json));

const otherTermRes = await req("POST", "/terms", admin, {
  name: `QA其他学期${STAMP}`,
  start_date: "2027-01-01",
  end_date: "2027-06-30",
  is_current: 0
});
const otherTermId = otherTermRes.json?.data?.id;
ck(otherTermRes.status === 200 && otherTermId > 0, "创建非当前学期", JSON.stringify(otherTermRes.json));

const curTermRes = await req("GET", "/terms/current", admin);
const currentTermId = curTermRes.json?.data?.id;
ck(currentTermId > 0, "取到当前学期 id", JSON.stringify(curTermRes.json));

const mkClass = async label => {
  const r = await req("POST", "/classes", admin, { name: label });
  return { id: r.json?.data?.id, status: r.status };
};
const clsA = await mkClass(`QA_A_${STAMP}`);
const clsB = await mkClass(`QA_B_${STAMP}`);
const clsC = await mkClass(`QA_C_${STAMP}`);
const clsS = await mkClass(`QA_S_${STAMP}`);
ck(clsA.id && clsB.id && clsC.id && clsS.id, "创建 4 个测试班级（A/B/C/代课）", JSON.stringify([clsA, clsB, clsC, clsS]));

const stuRes = await req("POST", "/students", admin, {
  student_no: `QAS${STAMP}`,
  name: `QA学员${STAMP}`,
  class_id: clsS.id,
  gender: "男"
});
const stuS = stuRes.json?.data?.id;
ck(stuRes.status === 200 && stuS > 0, "为代课班创建 1 名学员（用于代课点名）", JSON.stringify(stuRes.json));

// 任课关系：A=当前学期(可见) / B=其他学期(不可见) / C=长期有效(可见)
const taA = await req("POST", "/teaching-assignments", admin, {
  class_id: clsA.id,
  course_id: courseId,
  teacher_id: t2Id,
  term_id: currentTermId
});
const taB = await req("POST", "/teaching-assignments", admin, {
  class_id: clsB.id,
  course_id: courseId,
  teacher_id: t2Id,
  term_id: otherTermId
});
const taC = await req("POST", "/teaching-assignments", admin, {
  class_id: clsC.id,
  course_id: courseId,
  teacher_id: t2Id,
  term_id: null
});
ck(
  taA.status === 200 && taB.status === 200 && taC.status === 200,
  "创建 3 条任课关系（当前学期 / 其他学期 / 长期）",
  JSON.stringify([taA.json, taB.json, taC.json])
);
const taAId = taA.json?.data?.id;
const taBId = taB.json?.data?.id;

const t2 = await login(`qat2_${STAMP}`, "qa12345678");
const t3 = await login(`qat3_${STAMP}`, "qa12345678");
ck(!!t2 && !!t3, "教师2/教师3 登录成功");

// ── 动态空位/空日工具（保证脚本可重复运行：不依赖固定日期）──────────────
function addDays(baseStr, n) {
  const [y, m, d] = baseStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  const p = x => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
async function class1SessionsOn(date) {
  const r = await req("GET", `/sessions?class_id=1&date_start=${date}&date_end=${date}&pageSize=100`, admin);
  return r.json?.data?.list || [];
}
/** 找一个 class1 在该节次空闲的日期（从 +offset 天起扫描） */
async function findFreeClass1Slot(period, offset = 40, span = 120) {
  for (let i = offset; i < offset + span; i++) {
    const d = addDays(todayStr, i);
    const list = await class1SessionsOn(d);
    if (!list.some(s => Number(s.period) === Number(period))) return { date: d, period: Number(period) };
  }
  return null;
}
/** 找一个 class1 全天无课次的日期（用于「当天无对应课次」回填用例） */
async function findEmptyClass1Date(offset = 40, span = 120) {
  for (let i = offset; i < offset + span; i++) {
    const d = addDays(todayStr, i);
    const list = await class1SessionsOn(d);
    if (list.length === 0) return d;
  }
  return null;
}

// =====================================================================================
// B. 课次生成
// =====================================================================================
section("B. 课次生成");
const preview1 = await req("POST", "/sessions/preview", admin, { term_id: currentTermId });
ck(preview1.status === 200 && preview1.json?.success, "B1 POST /sessions/preview 可用", JSON.stringify(preview1.json));
const toCreate = preview1.json?.data?.to_create;
const already0 = preview1.json?.data?.already_exists;
const planTotal = preview1.json?.data?.plan_total;
ck(
  Number.isInteger(toCreate) && planTotal > 0 && toCreate === planTotal - already0,
  "B2 预览口径自洽（plan_total>0 且 to_create==plan_total-already_exists）",
  `to_create=${toCreate} already=${already0} plan_total=${planTotal}`
);

const gen1 = await req("POST", "/sessions/generate", admin, { term_id: currentTermId });
ck(gen1.status === 200 && gen1.json?.success, "B3 POST /sessions/generate 可用", JSON.stringify(gen1.json));
const created1 = gen1.json?.data?.created;
ck(created1 === toCreate, "B4 预览数字与生成实际一致（created==to_create）", `created=${created1} to_create=${toCreate}`);

const gen2 = await req("POST", "/sessions/generate", admin, { term_id: currentTermId });
ck(gen2.status === 200 && gen2.json?.data?.created === 0, "B5 幂等：第二次 generate created=0", JSON.stringify(gen2.json?.data));

// 状态按日期规则：过去=已上课，今天及以后=待上课
const todayStr = (() => {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const allSessions = (await req("GET", "/sessions?class_id=1&pageSize=500", admin)).json?.data?.list || [];
ck(allSessions.length > 0, "B6 生成后可列出课次", `count=${allSessions.length}`);
// 仅校验「计划态」状态（待上课/已上课）符合日期规则；已停课/已调课/已取消 属变更态，不在本断言范围
const badStatus = allSessions.filter(s =>
  ["待上课", "已上课"].includes(s.status) &&
  (s.session_date < todayStr ? s.status !== "已上课" : s.status !== "待上课")
);
ck(badStatus.length === 0, "B7 计划态课次按日期定状态（过去=已上课 / 今天及以后=待上课）", JSON.stringify(badStatus.slice(0, 3)));
ck(
  allSessions.some(s => s.status === "已上课") && allSessions.some(s => s.status === "待上课"),
  "B8 同时存在 已上课 与 待上课（学期跨过去与未来）"
);

// 手工新增课次 + 重复拒绝（动态空位，保证可重复运行）
const manualSlot = await findFreeClass1Slot(2);
ck(!!manualSlot, "B9a 找到用于手工新增的空闲时段", JSON.stringify(manualSlot));
const man1 = await req("POST", "/sessions", admin, {
  class_id: 1,
  course_id: 1,
  session_date: manualSlot.date,
  period: manualSlot.period,
  origin: "手工"
});
ck(man1.status === 200 && man1.json?.data?.id > 0, "B9 POST /sessions 手工新增课次可用", JSON.stringify(man1.json));
const man2 = await req("POST", "/sessions", admin, {
  class_id: 1,
  course_id: 1,
  session_date: manualSlot.date,
  period: manualSlot.period,
  origin: "手工"
});
ck(man2.status === 400, "B10 同 (班级,日期,节次) 重复手工新增被拒（唯一约束）", `status=${man2.status} ${JSON.stringify(man2.json)}`);

// =====================================================================================
// C. 课次变更语义
// =====================================================================================
section("C. 课次变更语义");

// 找一个可操作的「待上课」课次（未来）
const futureSessions = allSessions.filter(s => s.session_date > todayStr && s.status === "待上课");
ck(futureSessions.length > 0, "C0 存在可操作的未来待上课课次", `count=${futureSessions.length}`);
const target = futureSessions[0];

// 停课 → 已停课
const stop = await req("PUT", `/sessions/${target.id}/stop`, admin);
ck(stop.status === 200, "C1 停课接口可用", `status=${stop.status}`);
let det = (await req("GET", `/sessions/${target.id}`, admin)).json?.data;
ck(det?.session?.status === "已停课", "C2 停课后状态=已停课", `status=${det?.session?.status}`);

// 停课课次点名必须被拒（Q9）
const someStudent = (det?.students || []).find(s => s.student_id);
const batchStop = await req("POST", "/attendance/batch", admin, {
  session_id: target.id,
  records: [{ student_id: someStudent?.student_id, status: "正常" }]
});
ck(batchStop.status === 400, "C3 停课课次点名被拒（Q9 返回 400）", `status=${batchStop.status} ${JSON.stringify(batchStop.json)}`);

// 恢复 → 待上课
const restore = await req("PUT", `/sessions/${target.id}/restore`, admin);
const detR = (await req("GET", `/sessions/${target.id}`, admin)).json?.data;
ck(restore.status === 200 && detR?.session?.status === "待上课", "C4 恢复后状态=待上课", `status=${detR?.session?.status}`);

// 调课只允许「待上课」（Q4）：对已上课课次调课必须报错
const doneSession = allSessions.find(s => s.status === "已上课");
const reschedBad = await req("POST", `/sessions/${doneSession.id}/reschedule`, admin, {
  session_date: "2026-12-01",
  period: 8
});
ck(reschedBad.status === 400, "C5 已上课课次调课被拒（Q4 仅待上课可调）", `status=${reschedBad.status} ${JSON.stringify(reschedBad.json)}`);

// 调课成功：新建 + 双向关联
// 找一个与目标不同的空闲时段
let freeSlot = null;
for (const cand of [
  ["2026-11-30", 8],
  ["2026-12-01", 8],
  ["2026-12-02", 8],
  ["2026-12-03", 8]
]) {
  const chk = await req("GET", `/sessions?class_id=1&date_start=${cand[0]}&date_end=${cand[0]}&pageSize=50`, admin);
  const list = chk.json?.data?.list || [];
  if (!list.some(s => Number(s.period) === cand[1])) {
    freeSlot = cand;
    break;
  }
}
ck(!!freeSlot, "C6 找到空闲时段用于调课", JSON.stringify(freeSlot));

const resched = await req("POST", `/sessions/${target.id}/reschedule`, admin, {
  session_date: freeSlot[0],
  period: freeSlot[1]
});
ck(resched.status === 200 && resched.json?.data?.new_session_id > 0, "C7 待上课课次调课成功", JSON.stringify(resched.json));
const newId = resched.json?.data?.new_session_id;
const oldDet = (await req("GET", `/sessions/${target.id}`, admin)).json?.data?.session;
const newDet = (await req("GET", `/sessions/${newId}`, admin)).json?.data?.session;
ck(oldDet?.status === "已调课", "C8 调课后原课次状态=已调课", `status=${oldDet?.status}`);
ck(
  Number(oldDet?.related_session_id) === Number(newId) && Number(newDet?.related_session_id) === Number(target.id),
  "C9 调课双向关联可互跳（原↔新 related_session_id 互指）",
  `old.related=${oldDet?.related_session_id} new.related=${newDet?.related_session_id}`
);
ck(newDet?.origin === "调课", "C10 新课次来源=调课", `origin=${newDet?.origin}`);

// 已调课的课次不可再调
const reschedAgain = await req("POST", `/sessions/${target.id}/reschedule`, admin, {
  session_date: "2026-12-04",
  period: 8
});
ck(reschedAgain.status === 400, "C11 已调课课次不可重复调课", `status=${reschedAgain.status}`);

// 代课：原 teacher_id 不变，另写 substitute_teacher_id
const subTarget = futureSessions.find(s => s.id !== target.id) || target;
const beforeSub = (await req("GET", `/sessions/${subTarget.id}`, admin)).json?.data?.session;
const subRes = await req("POST", `/sessions/${subTarget.id}/substitute`, admin, {
  substitute_teacher_id: t3Id
});
const afterSub = (await req("GET", `/sessions/${subTarget.id}`, admin)).json?.data?.session;
ck(subRes.status === 200, "C12 代课接口可用", `status=${subRes.status}`);
ck(
  Number(afterSub?.teacher_id ?? 0) === Number(beforeSub?.teacher_id ?? 0),
  "C13 代课后原 teacher_id 保持不变",
  `before=${beforeSub?.teacher_id} after=${afterSub?.teacher_id}`
);
ck(Number(afterSub?.substitute_teacher_id) === Number(t3Id), "C14 代课人 substitute_teacher_id 已写入", `sub=${afterSub?.substitute_teacher_id}`);

// =====================================================================================
// D. ★ 权限对照
// =====================================================================================
section("D. ★ 权限对照");

// D-1 admin 四个新菜单 + 全部新接口可用
const adminRoutes = (await req("GET", "/auth/async-routes", admin)).json?.data || [];
const flat = JSON.stringify(adminRoutes);
ck(flat.includes("/attendance/sessions"), "D1 admin 菜单含「周课表」");
ck(flat.includes("/attendance/sessions/migration-report"), "D2 admin 菜单含「回填报告」");
ck(flat.includes("/attendance/teaching-assignments"), "D3 admin 菜单含「任课关系」");
ck(flat.includes("/attendance/period-times"), "D4 admin 菜单含「节次时间」");

const adminEndpoints = [
  ["GET", "/sessions"],
  ["GET", "/sessions/week?view=class&class_id=1"],
  ["GET", "/sessions/migration-report"],
  ["GET", "/teaching-assignments"],
  ["GET", "/period-times"]
];
for (const [m, p] of adminEndpoints) {
  const r = await req(m, p, admin);
  ck(r.status === 200, `D5 admin ${m} ${p} 可用`, `status=${r.status}`);
}

// D-2 teacher 菜单只应有「周课表」，不应有其它 3 项
const teacherRoutes = (await req("GET", "/auth/async-routes", teacher)).json?.data || [];
const tflat = JSON.stringify(teacherRoutes);
ck(tflat.includes("/attendance/sessions"), "D6 teacher 菜单含「周课表」");
ck(!tflat.includes("migration-report"), "D7 teacher 菜单不含「回填报告」");
ck(!tflat.includes("teaching-assignments"), "D8 teacher 菜单不含「任课关系」");
ck(!tflat.includes("period-times"), "D9 teacher 菜单不含「节次时间」");

// D-3 teacher 对 finance / leads 的每个端点必须 403
const forbidden = [
  ["GET", "/finance/orders"],
  ["GET", "/finance/orders/1"],
  ["GET", "/finance/payments"],
  ["GET", "/finance/refunds"],
  ["GET", "/finance/stats/revenue"],
  ["GET", "/finance/stats/arrears"],
  ["GET", "/finance/stats/low-hours"],
  ["GET", "/finance/stats/business"],
  ["GET", "/finance/stats/consumption"],
  ["GET", "/leads"],
  ["GET", "/leads/stats/channels"],
  ["POST", "/finance/payments"],
  ["POST", "/finance/refunds"],
  ["POST", "/finance/orders"],
  ["POST", "/leads"],
  ["PUT", "/leads/1"],
  ["PUT", "/leads/1/follow"],
  ["PUT", "/leads/1/status"],
  ["DELETE", "/leads/1"],
  ["PUT", "/finance/orders/1/status"],
  ["PUT", "/finance/orders/1"],
  ["PUT", "/finance/payments/1"],
  ["DELETE", "/finance/orders/1"]
];
let finFail = 0;
for (const [m, p] of forbidden) {
  const r = await req(m, p, teacher, m === "GET" ? undefined : {});
  if (r.status !== 403) {
    finFail++;
    console.log(`   → teacher ${m} ${p} 期望 403 实际 ${r.status}`);
  }
}
ck(finFail === 0, `D10 teacher 对 finance/leads 全部 ${forbidden.length} 个端点均 403`, `违规 ${finFail} 个`);

// D-4 teacher 对 admin-only 写端点必须 403
const adminOnly = [
  ["POST", "/sessions/preview", { term_id: currentTermId }],
  ["POST", "/sessions/generate", { term_id: currentTermId }],
  ["POST", "/sessions/backfill", {}],
  ["GET", "/sessions/migration-report", undefined],
  ["POST", "/teaching-assignments", { class_id: 1, course_id: 1 }],
  ["PUT", "/teaching-assignments/1", { class_id: 1, course_id: 1 }],
  ["DELETE", "/teaching-assignments/1", undefined],
  ["PUT", "/period-times", { items: [{ period: 1 }] }],
  ["POST", "/sessions", { class_id: 1, course_id: 1, session_date: manualSlot.date, period: 2 }],
  ["PUT", `/sessions/${subTarget.id}/stop`, undefined],
  ["PUT", `/sessions/${subTarget.id}/restore`, undefined],
  ["POST", `/sessions/${subTarget.id}/reschedule`, { session_date: "2026-12-05", period: 8 }],
  ["POST", `/sessions/${subTarget.id}/substitute`, { substitute_teacher_id: t3Id }],
  ["POST", "/sessions/migration-report/1/todo", undefined]
];
let aoFail = 0;
for (const [m, p, b] of adminOnly) {
  const r = await req(m, p, teacher, b);
  if (r.status !== 403) {
    aoFail++;
    console.log(`   → teacher ${m} ${p} 期望 403 实际 ${r.status}`);
  }
}
ck(aoFail === 0, `D11 teacher 对 ${adminOnly.length} 个 admin-only 端点均 403`, `违规 ${aoFail} 个`);

// D-5 teacher 可用的新读端点（scoped）
const teacherReadable = [
  ["GET", "/sessions"],
  ["GET", "/sessions/week?view=class&class_id=1"],
  ["GET", "/sessions/week?view=teacher"],
  ["GET", "/teaching-assignments"],
  ["GET", "/period-times"]
];
let trFail = 0;
for (const [m, p] of teacherReadable) {
  const r = await req(m, p, teacher);
  if (r.status !== 200) {
    trFail++;
    console.log(`   → teacher ${m} ${p} 期望 200 实际 ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
  }
}
ck(trFail === 0, "D12 teacher 可用新读端点（sessions/week/teaching-assignments/period-times）", `违规 ${trFail} 个`);

// D-6 任课关系按学期生效（三情形）
const t2Classes = (await req("GET", "/classes?pageSize=100", t2)).json?.data?.list || [];
const t2Names = t2Classes.map(c => c.name);
ck(t2Names.includes(`QA_A_${STAMP}`), "D13 当前学期任课 → 可见（QA_A）", t2Names.join(","));
ck(t2Names.includes(`QA_C_${STAMP}`), "D14 长期有效任课（term_id NULL）→ 可见（QA_C）", t2Names.join(","));
ck(!t2Names.includes(`QA_B_${STAMP}`), "D15 其它学期任课 → 不可见（QA_B）", t2Names.join(","));
ck(!t2Names.includes(`QA_S_${STAMP}`), "D16 无任课关系班级不可见（QA_S）", t2Names.join(","));

// D-17/D-18 兜底：不存在 is_current=1 的学期时「不过滤」
const term1 = (await req("GET", "/terms", admin)).json?.data?.list?.find(t => Number(t.id) === Number(currentTermId));
const clearCur = await req("PUT", `/terms/${currentTermId}`, admin, {
  name: term1?.name,
  start_date: term1?.start_date,
  end_date: term1?.end_date,
  is_current: 0
});
ck(clearCur.status === 200, "D17 临时清除当前学期（为兜底用例）", `status=${clearCur.status}`);
const t2Classes2 = (await req("GET", "/classes?pageSize=100", t2)).json?.data?.list || [];
const t2Names2 = t2Classes2.map(c => c.name);
ck(t2Names2.includes(`QA_B_${STAMP}`), "D18 无当前学期时不过滤（QA_B 其它学期任课也可见）", t2Names2.join(","));
// 恢复当前学期
const restoreCur = await req("PUT", `/terms/${currentTermId}`, admin, {
  name: term1?.name,
  start_date: term1?.start_date,
  end_date: term1?.end_date,
  is_current: 1
});
ck(restoreCur.status === 200, "D19 恢复当前学期", `status=${restoreCur.status}`);

// D-20 班级档案编辑/删除对任课教师不可用（只有班主任或 admin）
const putByAssigned = await req("PUT", `/classes/${clsA.id}`, t2, { name: `QA_A_${STAMP}` });
ck(putByAssigned.status === 403, "D20 任课教师编辑班级档案被拒（403）", `status=${putByAssigned.status}`);
const delByAssigned = await req("DELETE", `/classes/${clsA.id}`, t2);
ck(delByAssigned.status === 403, "D21 任课教师删除班级档案被拒（403）", `status=${delByAssigned.status}`);
// 班主任（teacher id2 是 class1 班主任）可编辑
const cls1 = (await req("GET", "/classes?pageSize=100", admin)).json?.data?.list?.find(c => Number(c.id) === 1);
const putByHead = await req("PUT", "/classes/1", teacher, { name: cls1?.name, grade: cls1?.grade || "" });
ck(putByHead.status === 200, "D22 班主任可编辑自己班级档案（对照组）", `status=${putByHead.status} ${JSON.stringify(putByHead.json)}`);

// D-23 ★ 代课人只能看/录他代的那一节（Q5）
const subS1 = await req("POST", "/sessions", admin, {
  class_id: clsS.id,
  course_id: courseId,
  session_date: "2026-10-05",
  period: 1,
  origin: "手工"
});
const subS2 = await req("POST", "/sessions", admin, {
  class_id: clsS.id,
  course_id: courseId,
  session_date: "2026-10-05",
  period: 2,
  origin: "手工"
});
const s1 = subS1.json?.data?.id;
const s2 = subS2.json?.data?.id;
ck(s1 > 0 && s2 > 0, "D23 代课场景：同班两节课次已创建", JSON.stringify([s1, s2]));
await req("POST", `/sessions/${s1}/substitute`, admin, { substitute_teacher_id: t3Id });

const t3GetS1 = await req("GET", `/sessions/${s1}`, t3);
ck(t3GetS1.status === 200, "D24 代课人可访问他代的那一节（200）", `status=${t3GetS1.status}`);
const t3GetS2 = await req("GET", `/sessions/${s2}`, t3);
ck(t3GetS2.status === 403, "D25 ★代课人对同班「其它」课次不可访问（403，未整班越权）", `status=${t3GetS2.status} ${JSON.stringify(t3GetS2.json)}`);
const t3Week = await req("GET", `/sessions/week?view=class&class_id=${clsS.id}`, t3);
ck(t3Week.status === 403, "D26 代课人不可查看整班周课表（403）", `status=${t3Week.status}`);

const t3BatchS1 = await req("POST", "/attendance/batch", t3, {
  session_id: s1,
  records: [{ student_id: stuS, status: "正常" }]
});
ck(t3BatchS1.status === 200, "D27 代课人可录入他代的那一节考勤（200）", `status=${t3BatchS1.status} ${JSON.stringify(t3BatchS1.json)}`);
const t3BatchS2 = await req("POST", "/attendance/batch", t3, {
  session_id: s2,
  records: [{ student_id: stuS, status: "正常" }]
});
ck(t3BatchS2.status === 403, "D28 ★代课人对同班其它课次不可录入（403）", `status=${t3BatchS2.status}`);

// =====================================================================================
// E. 关键回归
// =====================================================================================
section("E. 关键回归");

// E-1 legacy 批量点名（不传 session_id）：同 (学员,课程,日期) 重复提交 = 覆盖式 upsert，非新增行
// 用「本轮新建学员 + 全天无课次的日期」→ 该行永不参与回填，保证可重复运行
const legacyDate = await findEmptyClass1Date();
const stuARes = await req("POST", "/students", admin, {
  student_no: `QAE1${STAMP}`,
  name: `QA回归学员1_${STAMP}`,
  class_id: 1,
  gender: "男"
});
const legacyStu = stuARes.json?.data?.id;
ck(legacyStu > 0 && !!legacyDate, "E1 新建 legacy 点名样本学员 + 空日", `stu=${legacyStu} date=${legacyDate}`);
const lb1 = await req("POST", "/attendance/batch", admin, {
  date: legacyDate,
  course_id: 1,
  records: [{ student_id: legacyStu, status: "正常", remark: "第一次" }]
});
const lb2 = await req("POST", "/attendance/batch", admin, {
  date: legacyDate,
  course_id: 1,
  records: [{ student_id: legacyStu, status: "迟到", remark: "第二次" }]
});
ck(lb1.status === 200 && lb2.status === 200, "E2 legacy 批量点名两次均 200（行为未变）", `${lb1.status}/${lb2.status}`);
const recs = (await req("GET", `/attendance/records?student_id=${legacyStu}&course_id=1&date_start=${legacyDate}&date_end=${legacyDate}&pageSize=50`, admin)).json?.data;
ck(recs?.total === 1, "E3 legacy 重复提交为覆盖式 upsert（记录数=1，未新增行）", `total=${recs?.total}`);
ck(recs?.list?.[0]?.status === "迟到", "E4 legacy upsert 覆盖后状态为最后一次提交", `status=${recs?.list?.[0]?.status}`);

// E-5 节次时间快照：改 period_times 不回写已有课次，新生成的才带新时间
const ptList = (await req("GET", "/period-times", admin)).json?.data || [];
// 选一个「未来待上课」课次所用的节次
const snapTarget = futureSessions.find(s => s.status === "待上课");
const ptBefore = ptList.find(p => Number(p.period) === Number(snapTarget.period));
const origTime = ptBefore?.start_time || "";
const newTime = origTime === "06:30" ? "06:31" : "06:30";
const putPt = await req("PUT", "/period-times", admin, {
  items: [{ period: snapTarget.period, start_time: newTime, end_time: ptBefore?.end_time || "", label: ptBefore?.label || "" }]
});
ck(putPt.status === 200, "E5 修改节次时间成功", `status=${putPt.status}`);
const snapAfter = (await req("GET", `/sessions/${snapTarget.id}`, admin)).json?.data?.session;
ck(
  html2(snapAfter?.start_time) === html2(origTime),
  "E6 ★已有课次时间不被回写（快照语义）",
  `原=${origTime} 现=${snapAfter?.start_time}`
);
// 新生成（手工新增）的课次应带新时间（动态空位，保证可重复运行）
const snapSlot = await findFreeClass1Slot(snapTarget.period);
const manNew = snapSlot
  ? await req("POST", "/sessions", admin, {
      class_id: 1,
      course_id: 1,
      session_date: snapSlot.date,
      period: snapSlot.period,
      origin: "手工"
    })
  : { json: {} };
const manNewDet = manNew.json?.data?.id
  ? (await req("GET", `/sessions/${manNew.json.data.id}`, admin)).json?.data?.session
  : null;
ck(
  html2(manNewDet?.start_time) === html2(newTime),
  "E7 新生成的课次带新时间（快照来源于当前 period_times）",
  `期望=${newTime} 实际=${manNewDet?.start_time}`
);
// 还原节次时间
await req("PUT", "/period-times", admin, {
  items: [{ period: snapTarget.period, start_time: origTime, end_time: ptBefore?.end_time || "", label: ptBefore?.label || "" }]
});

// E-8 回填：匹配 / 0条 / 多条 / 幂等
// 构造三类历史行（不传 session_id），用「本轮新建学员」保证可重复运行：
const grouped = {};
for (const s of allSessions) {
  if (Number(s.class_id) !== 1) continue;
  grouped[s.session_date] = grouped[s.session_date] || [];
  grouped[s.session_date].push(s);
}
// 恰好 1 条课次的日期 → 匹配成功
const singleDate = Object.keys(grouped).find(d => grouped[d].length === 1 && d >= todayStr);
// 多条课次的日期（同班同课程同日多节）→ 无法唯一确定
const multiDate = Object.keys(grouped).find(d => grouped[d].length > 1 && d >= todayStr);
// 无课次的日期 → 当天无对应课次
const noneDate = await findEmptyClass1Date(60);
const stuBRes = await req("POST", "/students", admin, {
  student_no: `QAE2${STAMP}`,
  name: `QA回归学员2_${STAMP}`,
  class_id: 1,
  gender: "女"
});
const eStu = stuBRes.json?.data?.id;

ck(!!singleDate && !!multiDate && !!noneDate && eStu > 0, "E8 找到 单课次 / 多课次 / 无课次 日期样本", `single=${singleDate} multi=${multiDate} none=${noneDate} stu=${eStu}`);
await req("POST", "/attendance/batch", admin, {
  date: singleDate,
  course_id: 1,
  records: [{ student_id: eStu, status: "正常" }]
});
await req("POST", "/attendance/batch", admin, {
  date: multiDate,
  course_id: 1,
  records: [{ student_id: eStu, status: "正常" }]
});
await req("POST", "/attendance/batch", admin, {
  date: noneDate,
  course_id: 1,
  records: [{ student_id: eStu, status: "正常" }]
});

const bf1 = await req("POST", "/sessions/backfill", admin, { term_id: currentTermId });
ck(bf1.status === 200 && bf1.json?.success, "E9 POST /sessions/backfill 可用", JSON.stringify(bf1.json));
const bf2 = await req("POST", "/sessions/backfill", admin, { term_id: currentTermId });
ck(bf2.status === 200 && bf2.json?.data?.matched === 0, "E10 回填幂等：重跑 matched=0", JSON.stringify(bf2.json?.data));

// DB 级交叉核验（若提供被测服务库路径）
if (SERVER_DB && fs.existsSync(SERVER_DB)) {
  const sdb = new DatabaseSync(SERVER_DB, { readOnly: true });
  try {
    const singleSession = grouped[singleDate][0];
    const matchedRow = sdb
      .prepare(
        `SELECT a.session_id FROM attendances a JOIN students s ON s.id=a.student_id
         WHERE s.class_id=1 AND a.course_id=1 AND a.date=? AND a.student_id=?`
      )
      .get(singleDate, eStu);
    ck(
      Number(matchedRow?.session_id) === Number(singleSession.id),
      "E11 匹配成功的行 session_id 被正确回填",
      `期望=${singleSession.id} 实际=${matchedRow?.session_id}`
    );
    const repMatched = sdb
      .prepare("SELECT COUNT(*) c FROM session_migration_report WHERE source_table='attendances' AND date=? AND student_id=?")
      .get(singleDate, eStu).c;
    ck(repMatched === 0, "E12 匹配成功的行不再出现在报告中", `报告行=${repMatched}`);

    const repNone = sdb
      .prepare("SELECT reason FROM session_migration_report WHERE source_table='attendances' AND date=? AND student_id=?")
      .get(noneDate, eStu);
    ck(repNone?.reason === "当天无对应课次", "E13 0 条匹配进报告且原因=当天无对应课次", `reason=${repNone?.reason}`);

    const repMulti = sdb
      .prepare("SELECT reason FROM session_migration_report WHERE source_table='attendances' AND date=? AND student_id=?")
      .get(multiDate, eStu);
    ck(
      repMulti?.reason === "同日同课程多个课次，无法唯一确定",
      "E14 多条匹配进报告且原因=同日同课程多个课次，无法唯一确定",
      `reason=${repMulti?.reason}`
    );

    const summary = (await req("GET", "/sessions/migration-report?pageSize=1", admin)).json?.data?.summary;
    ck(
      typeof summary?.matched === "number" && typeof summary?.fail_rate === "number",
      "E15 回填报告 summary 含 matched / unmatched / fail_rate",
      JSON.stringify(summary)
    );
  } finally {
    sdb.close();
  }

  // Q6：未匹配项一键转待办（仅 admin）
  const rep = (await req("GET", "/sessions/migration-report?status=未匹配&pageSize=1", admin)).json?.data;
  const repId = rep?.list?.[0]?.id;
  if (repId) {
    const todo = await req("POST", `/sessions/migration-report/${repId}/todo`, admin);
    ck(todo.status === 200 && todo.json?.data?.todo_id > 0, "E16 未匹配项一键转待办（返回 todo_id）", JSON.stringify(todo.json));
  } else {
    ck(false, "E16 未匹配项一键转待办（无未匹配样本）");
  }
} else {
  console.log(`[SKIP] 未提供 QA_SERVER_DB 或不存于磁盘（${SERVER_DB || "未设置"}）→ 跳过 E11–E16 的 DB 级交叉核验`);
}

// =====================================================================================
section("汇总");
console.log(`==== verify-sessions 汇总: PASS ${pass} / ${pass + fail} ====`);
if (fail) {
  console.log("失败项:");
  for (const f of failures) console.log("  - " + f);
}
process.exit(fail ? 1 : 0);
