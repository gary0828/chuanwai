// 课次路由：列表 / 周视图 / 详情 / 预览 / 生成 / 回填 / 报告 / 停课 / 恢复 / 挪课 / 代课 / 手工新增
//
// 权限（对齐设计 §3.2）：
//   GET  /sessions、/sessions/week、/sessions/:id  → auth（scope；:id 含该课次代课人）
//   POST /preview、/generate、/backfill、/sessions（手工） → admin
//   GET  /migration-report、POST /migration-report/:id/todo → admin
//   PUT  /:id/stop、/:id/restore；POST /:id/reschedule、/:id/substitute → admin
// 响应体统一 { success, data?, message? }。
//
// ★ 路由注册顺序：/week、/preview、/generate、/backfill、/migration-report 必须先于 /:id。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageClass, canAccessSession, teacherClassPredicate } = require("../utils/scope");
const { parseDate } = require("../utils/validate");
const engine = require("../utils/session-engine");

const router = express.Router();

const STATUSES = ["待上课", "已上课", "已停课", "已挪课", "已取消"];
const ORIGINS = ["模板生成", "挪课", "补课", "手工"];
const DOW_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 解析 statuses 查询参数（可为逗号分隔字符串或数组），仅保留合法状态 */
function parseStatuses(raw) {
  if (raw == null || raw === "") return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(",");
  return arr.map(s => String(s).trim()).filter(s => STATUSES.includes(s));
}

/** 依次尝试多个可选筛选值的辅助（返回给 push 用的数组） */
function toIntOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 周基准：给定日期（或今天）所在周的周一（YYYY-MM-DD） */
function mondayOf(dateStr) {
  const base = dateStr ? engine.parseYmd(dateStr) : new Date();
  const dt = dateStr ? base : new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
  const dow = engine.isoDow(dt); // 1..7
  return engine.fmtYmd(new Date(dt.getTime() - (dow - 1) * 24 * 60 * 60 * 1000));
}

/** 组装课次行（含班级/课程/教师/代课人/关联课次日期）的公共 SELECT 片段 */
const SESSION_SELECT = `
  cs.id, cs.term_id, cs.schedule_id, cs.class_id, c.name AS class_name,
  cs.course_id, co.name AS course_name,
  cs.teacher_id, t.name AS teacher_name,
  cs.substitute_teacher_id, st.name AS substitute_teacher_name,
  cs.room_id, cs.session_date, cs.period, cs.start_time, cs.end_time,
  cs.status, cs.origin, cs.related_session_id,
  (SELECT rs.session_date FROM class_sessions rs WHERE rs.id = cs.related_session_id) AS related_date,
  cs.topic, cs.created_at, cs.updated_at`;

const SESSION_FROM = `
  FROM class_sessions cs
  JOIN classes c ON cs.class_id = c.id
  LEFT JOIN courses co ON cs.course_id = co.id
  LEFT JOIN users t ON cs.teacher_id = t.id
  LEFT JOIN users st ON cs.substitute_teacher_id = st.id`;

// ─────────────────────────────────────────────────────────────
// 列表
// ─────────────────────────────────────────────────────────────
router.get("/", auth, (req, res) => {
  const { term_id, class_id, teacher_id, status, date_start, date_end, page = 1, pageSize = 20 } = req.query;
  const p = Number(page) || 1;
  const ps = Math.min(Number(pageSize) || 20, 200);
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  // 教师：本班（班主任或任课）或该课次代课人
  if (req.user.role === "teacher") {
    where += ` AND (${teacherClassPredicate("c")} OR cs.substitute_teacher_id = ?)`;
    params.push(req.user.id, req.user.id, req.user.id);
  }
  const tid = toIntOrNull(term_id);
  if (tid) { where += " AND cs.term_id = ?"; params.push(tid); }
  const cid = toIntOrNull(class_id);
  if (cid) { where += " AND cs.class_id = ?"; params.push(cid); }
  const teach = toIntOrNull(teacher_id);
  if (teach) { where += " AND (cs.teacher_id = ? OR cs.substitute_teacher_id = ?)"; params.push(teach, teach); }
  if (status && STATUSES.includes(status)) { where += " AND cs.status = ?"; params.push(status); }
  if (date_start) { where += " AND cs.session_date >= ?"; params.push(date_start); }
  if (date_end) { where += " AND cs.session_date <= ?"; params.push(date_end); }

  const total = db
    .prepare(`SELECT COUNT(*) AS c ${SESSION_FROM} ${where}`)
    .get(...params).c;
  const list = db
    .prepare(`SELECT ${SESSION_SELECT} ${SESSION_FROM} ${where} ORDER BY cs.session_date DESC, cs.period DESC, cs.id DESC LIMIT ? OFFSET ?`)
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

// ─────────────────────────────────────────────────────────────
// 周视图（一次取全：days / periods / sessions）
// ─────────────────────────────────────────────────────────────
router.get("/week", auth, (req, res) => {
  const { view = "class", class_id, teacher_id, week_start } = req.query;
  const statuses = parseStatuses(req.query.statuses);

  let ws;
  if (week_start && parseDate(week_start, { field: "周起始" }).ok) {
    ws = mondayOf(week_start);
  } else {
    ws = mondayOf(null);
  }
  const startDate = engine.parseYmd(ws);
  const we = engine.fmtYmd(new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000));
  const today = engine.todayStr();

  let where = "WHERE cs.session_date >= ? AND cs.session_date <= ?";
  const params = [ws, we];

  if (view === "teacher") {
    // Q8：teacher 角色默认锁定本人；admin 可指定任意教师
    let tid = req.user.role === "teacher" ? req.user.id : toIntOrNull(teacher_id);
    if (!tid) {
      return res.status(400).json({ success: false, message: "请选择教师" });
    }
    where += " AND (cs.teacher_id = ? OR cs.substitute_teacher_id = ?)";
    params.push(tid, tid);
  } else {
    const cid = toIntOrNull(class_id);
    if (!cid) {
      return res.status(400).json({ success: false, message: "请选择班级" });
    }
    if (req.user.role === "teacher" && !canManageClass(req, cid)) {
      return res.status(403).json({ success: false, message: "无权查看该班级周课表" });
    }
    where += " AND cs.class_id = ?";
    params.push(cid);
  }

  if (statuses.length) {
    where += ` AND cs.status IN (${statuses.map(() => "?").join(",")})`;
    params.push(...statuses);
  }

  const sessions = db
    .prepare(`SELECT ${SESSION_SELECT} ${SESSION_FROM} ${where} ORDER BY cs.session_date, cs.period, cs.id`)
    .all(...params);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = engine.fmtYmd(d);
    days.push({
      date: dateStr,
      day_of_week: i + 1,
      label: DOW_LABELS[i],
      is_today: dateStr === today
    });
  }

  const periodMap = engine.getPeriodTimeMap();
  const periods = [];
  for (let per = engine.PERIOD_MIN; per <= engine.PERIOD_MAX; per++) {
    const pt = periodMap.get(per);
    periods.push({
      period: per,
      label: (pt && pt.label) || `第${per}节`,
      start_time: pt ? pt.start_time : "",
      end_time: pt ? pt.end_time : ""
    });
  }

  res.json({ success: true, data: { week_start: ws, week_end: we, days, periods, sessions } });
});

// ─────────────────────────────────────────────────────────────
// 回填报告（必须先于 /:id）
// ─────────────────────────────────────────────────────────────
router.get("/migration-report", auth, requireRole("admin"), (req, res) => {
  const { data_type, class_id, date_start, date_end, reason, status, page = 1, pageSize = 20 } = req.query;
  const p = Number(page) || 1;
  const ps = Math.min(Number(pageSize) || 20, 200);
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  if (data_type) { where += " AND r.data_type = ?"; params.push(data_type); }
  const cid = toIntOrNull(class_id);
  if (cid) { where += " AND r.class_id = ?"; params.push(cid); }
  if (date_start) { where += " AND r.date >= ?"; params.push(date_start); }
  if (date_end) { where += " AND r.date <= ?"; params.push(date_end); }
  if (reason) { where += " AND r.reason LIKE ?"; params.push(`%${reason}%`); }
  if (status) { where += " AND r.status = ?"; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM session_migration_report r ${where}`).get(...params).c;
  const list = db
    .prepare(
      `SELECT r.*, c.name AS class_name, co.name AS course_name, s.name AS student_name
       FROM session_migration_report r
       LEFT JOIN classes c ON c.id = r.class_id
       LEFT JOIN courses co ON co.id = r.course_id
       LEFT JOIN students s ON s.id = r.student_id
       ${where}
       ORDER BY r.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  // 汇总：已匹配 = 总量 − 未匹配（总量=三张源表行数之和，未匹配=报告行数）
  const srcTotal =
    db.prepare("SELECT COUNT(*) AS c FROM attendances").get().c +
    db.prepare("SELECT COUNT(*) AS c FROM hour_consumptions").get().c +
    db.prepare("SELECT COUNT(*) AS c FROM class_evaluations").get().c;
  const unmatched = db.prepare("SELECT COUNT(*) AS c FROM session_migration_report").get().c;
  const matched = Math.max(0, srcTotal - unmatched);
  const fail_rate = srcTotal > 0 ? Number(((unmatched / srcTotal) * 100).toFixed(2)) : 0;

  res.json({
    success: true,
    data: { list, total, summary: { matched, unmatched, total: srcTotal, fail_rate } }
  });
});

/** 未匹配项一键转待办（Q6：仅指派 admin） */
router.post("/migration-report/:id/todo", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM session_migration_report WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "报告记录不存在" });
  if (row.status === "已转待办" && row.todo_id) {
    return res.json({ success: true, data: { todo_id: row.todo_id, already: true } });
  }
  const title = `课次回填未匹配：${row.data_type} ${row.date || ""}`.trim();
  const content = `来源表 ${row.source_table}#${row.source_id}，原因：${row.reason || "未说明"}`;
  const info = db
    .prepare(
      `INSERT INTO todos (title, content, owner_id, creator_id, source, status, priority)
       VALUES (?, ?, ?, ?, 'manual', '待办', '普通')`
    )
    .run(title, content, req.user.id, req.user.id);
  db.prepare(
    "UPDATE session_migration_report SET status = '已转待办', todo_id = ? WHERE id = ?"
  ).run(info.lastInsertRowid, id);
  res.json({ success: true, data: { todo_id: info.lastInsertRowid } });
});

// ─────────────────────────────────────────────────────────────
// 预览 / 生成 / 回填（admin）
// ─────────────────────────────────────────────────────────────
router.post("/preview", auth, requireRole("admin"), (req, res) => {
  const termId = toIntOrNull((req.body || {}).term_id);
  if (!termId) return res.status(400).json({ success: false, message: "请选择学期" });
  try {
    res.json({ success: true, data: engine.previewGeneration(termId) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

router.post("/generate", auth, requireRole("admin"), (req, res) => {
  const termId = toIntOrNull((req.body || {}).term_id);
  if (!termId) return res.status(400).json({ success: false, message: "请选择学期" });
  try {
    res.json({ success: true, data: engine.generateSessions(termId, req.user.id) });
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ success: false, message: "生成过程中出现唯一键冲突，请刷新后重试" });
    }
    return res.status(400).json({ success: false, message: e.message });
  }
});

router.post("/backfill", auth, requireRole("admin"), (req, res) => {
  const termId = toIntOrNull((req.body || {}).term_id);
  try {
    res.json({ success: true, data: engine.backfillSessions(termId) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 手工新增课次（加课 / 补课）
// ─────────────────────────────────────────────────────────────
router.post("/", auth, requireRole("admin"), (req, res) => {
  const { class_id, course_id, teacher_id, session_date, period, room_id, origin = "手工" } = req.body || {};
  const classId = toIntOrNull(class_id);
  const courseId = toIntOrNull(course_id);
  const per = Number(period);
  if (!classId) return res.status(400).json({ success: false, message: "请选择班级" });
  if (!courseId) return res.status(400).json({ success: false, message: "请选择课程" });
  if (!Number.isInteger(per) || per < engine.PERIOD_MIN || per > engine.PERIOD_MAX) {
    return res.status(400).json({ success: false, message: `节次范围 ${engine.PERIOD_MIN}-${engine.PERIOD_MAX}` });
  }
  const dateRes = parseDate(session_date, { field: "上课日期" });
  if (!dateRes.ok) return res.status(400).json({ success: false, message: dateRes.message });
  if (!ORIGINS.includes(origin) || origin === "模板生成" || origin === "挪课") {
    return res.status(400).json({ success: false, message: "来源仅支持「手工」或「补课」" });
  }
  if (!db.prepare("SELECT 1 FROM classes WHERE id = ?").get(classId)) {
    return res.status(400).json({ success: false, message: "班级不存在" });
  }
  if (!db.prepare("SELECT 1 FROM courses WHERE id = ?").get(courseId)) {
    return res.status(400).json({ success: false, message: "课程不存在" });
  }
  const currentTerm = db.prepare("SELECT id FROM terms WHERE is_current = 1").get();
  const termId = currentTerm ? Number(currentTerm.id) : null;
  const teachId = toIntOrNull(teacher_id) || engine.resolveTeacher(classId, courseId, termId);
  if (teachId && !db.prepare("SELECT 1 FROM users WHERE id = ?").get(teachId)) {
    return res.status(400).json({ success: false, message: "授课教师不存在" });
  }
  const pt = engine.getPeriodTimeMap().get(per);
  const start_time = pt ? pt.start_time : "";
  const end_time = pt ? pt.end_time : "";
  const today = engine.todayStr();
  const status = dateRes.value < today ? engine.STATUS_DONE : engine.STATUS_SCHEDULED;
  const roomId = toIntOrNull(room_id);
  try {
    const info = db
      .prepare(
        `INSERT INTO class_sessions
           (term_id, schedule_id, class_id, course_id, teacher_id, substitute_teacher_id, room_id,
            session_date, period, start_time, end_time, status, origin, related_session_id, topic)
         VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, '')`
      )
      .run(termId, classId, courseId, teachId, roomId, dateRes.value, per, start_time, end_time, status, origin);
    res.json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ success: false, message: "该班级在该日期该节次已存在课次" });
    }
    throw e;
  }
});

// ─────────────────────────────────────────────────────────────
// 详情（含该课次代课人）
// ─────────────────────────────────────────────────────────────
router.get("/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "课次 ID 不合法" });
  }
  const session = db
    .prepare(`SELECT ${SESSION_SELECT} ${SESSION_FROM} WHERE cs.id = ?`)
    .get(id);
  if (!session) return res.status(404).json({ success: false, message: "课次不存在" });
  if (!canAccessSession(req, id)) {
    return res.status(403).json({ success: false, message: "无权查看该课次" });
  }

  const students = db
    .prepare(
      `SELECT s.id AS student_id, s.student_no, s.name, a.status, a.remark, a.id AS attendance_id
       FROM students s
       LEFT JOIN attendances a ON a.student_id = s.id AND a.session_id = ?
       WHERE s.class_id = ? AND s.status = '在读'
       ORDER BY s.student_no`
    )
    .all(id, session.class_id);

  const evaluations = db
    .prepare(
      `SELECT student_id, focus, participation, mastery, teacher_note, updated_at
       FROM class_evaluations WHERE session_id = ? ORDER BY student_id`
    )
    .all(id);

  const consumptions = db
    .prepare(
      `SELECT hc.id, hc.student_id, s.name AS student_name, hc.hours, hc.type, hc.date, hc.created_at
       FROM hour_consumptions hc
       LEFT JOIN students s ON s.id = hc.student_id
       WHERE hc.session_id = ? ORDER BY hc.id`
    )
    .all(id);

  let related = null;
  if (session.related_session_id) {
    related = db
      .prepare("SELECT id, session_date, period, status FROM class_sessions WHERE id = ?")
      .get(session.related_session_id) || null;
  }

  res.json({ success: true, data: { session, students, evaluations, consumptions, related } });
});

// ─────────────────────────────────────────────────────────────
// 停课 / 恢复 / 挪课 / 代课（admin）
// ─────────────────────────────────────────────────────────────
router.put("/:id/stop", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "课次不存在" });
  if (session.status !== "待上课") {
    return res.status(400).json({ success: false, message: `仅「待上课」的课次可停课（当前：${session.status}）` });
  }
  db.prepare(
    "UPDATE class_sessions SET status = '已停课', updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(id);
  res.json({ success: true, data: null });
});

router.put("/:id/restore", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "课次不存在" });
  if (session.status !== "已停课") {
    return res.status(400).json({ success: false, message: `仅「已停课」的课次可恢复（当前：${session.status}）` });
  }
  db.prepare(
    "UPDATE class_sessions SET status = '待上课', updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(id);
  res.json({ success: true, data: null });
});

router.post("/:id/reschedule", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { session_date, period, room_id } = req.body || {};
  const session = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "课次不存在" });
  if (session.status !== "待上课") {
    return res.status(400).json({ success: false, message: "仅「待上课」的课次可挪课（Q4）" });
  }
  if (session.related_session_id != null) {
    return res.status(400).json({ success: false, message: "该课次已挪课，不可重复挪课" });
  }
  const per = Number(period);
  if (!Number.isInteger(per) || per < engine.PERIOD_MIN || per > engine.PERIOD_MAX) {
    return res.status(400).json({ success: false, message: `节次范围 ${engine.PERIOD_MIN}-${engine.PERIOD_MAX}` });
  }
  const dateRes = parseDate(session_date, { field: "挪课日期" });
  if (!dateRes.ok) return res.status(400).json({ success: false, message: dateRes.message });
  if (dateRes.value === session.session_date && per === Number(session.period)) {
    return res.status(400).json({ success: false, message: "目标时段与原时段相同，无需挪课" });
  }
  const pt = engine.getPeriodTimeMap().get(per);
  const today = engine.todayStr();
  const newStatus = dateRes.value < today ? engine.STATUS_DONE : engine.STATUS_SCHEDULED;
  const roomId = room_id === undefined ? session.room_id : toIntOrNull(room_id);

  db.exec("BEGIN");
  try {
    const info = db
      .prepare(
        `INSERT INTO class_sessions
           (term_id, schedule_id, class_id, course_id, teacher_id, substitute_teacher_id, room_id,
            session_date, period, start_time, end_time, status, origin, related_session_id, topic)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '挪课', NULL, ?)`
      )
      .run(
        session.term_id,
        session.schedule_id,
        session.class_id,
        session.course_id,
        session.teacher_id,
        roomId,
        dateRes.value,
        per,
        pt ? pt.start_time : "",
        pt ? pt.end_time : "",
        newStatus,
        session.topic || ""
      );
    const newId = info.lastInsertRowid;
    db.prepare(
      "UPDATE class_sessions SET status = '已挪课', related_session_id = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(newId, id);
    db.prepare(
      "UPDATE class_sessions SET related_session_id = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(id, newId);
    db.exec("COMMIT");
    res.json({ success: true, data: { new_session_id: newId } });
  } catch (e) {
    db.exec("ROLLBACK");
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ success: false, message: "目标时段已存在课次，请选择其他时段" });
    }
    throw e;
  }
});

router.post("/:id/substitute", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { substitute_teacher_id, room_id } = req.body || {};
  const session = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "课次不存在" });
  const subId = toIntOrNull(substitute_teacher_id);
  if (!subId) return res.status(400).json({ success: false, message: "请选择代课人" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(subId)) {
    return res.status(400).json({ success: false, message: "代课人不存在" });
  }
  const roomId = room_id === undefined ? session.room_id : toIntOrNull(room_id);
  db.prepare(
    `UPDATE class_sessions
     SET substitute_teacher_id = ?, room_id = ?, updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(subId, roomId, id);
  res.json({ success: true, data: null });
});

module.exports = router;
