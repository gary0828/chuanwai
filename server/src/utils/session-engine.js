// 课次引擎：模板展开（预览/执行共用）、课次生成、任课解析、节次时间快照、历史回填。
//
// 设计要点（对齐设计 §1.2 问题 3/4）：
// - 生成时把 period_times 的 start_time/end_time **快照**写入课次（不联表取）→ 历史不可篡改。
// - 幂等：INSERT ... ON CONFLICT(class_id, session_date, period) DO NOTHING（Q1 跳过已存在）。
// - 拆分：expandTemplates 为纯展开（预览与执行共用，保证「预览到的 = 将生成的」）。
// - 回填：对三张表 session_id IS NULL 的历史行按 (class_id, course_id, session_date) 反查课次；
//   恰好 1 条 → 回填；0 条 → 报告「当天无对应课次」；>1 条 → 报告「同日同课程多个课次，无法唯一确定」；
//   课程为空 → 报告「课程为空」（不做宽松兜底）。报告表 (source_table, source_id) 唯一，幂等可重跑。
const db = require("../db");

const PERIOD_MIN = 1;
const PERIOD_MAX = 8;
const STATUS_SCHEDULED = "待上课";
const STATUS_DONE = "已上课";

const REASON_NO_SESSION = "当天无对应课次";
const REASON_AMBIGUOUS = "同日同课程多个课次，无法唯一确定";
const REASON_NO_COURSE = "课程为空";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** 本地时区今天 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 把 YYYY-MM-DD 解析为 UTC 日期（避开本地时区偏移引起的跨日） */
function parseYmd(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** UTC 日期格式化为 YYYY-MM-DD */
function fmtYmd(dt) {
  const pad = n => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** ISO 星期：1=周一 … 7=周日（与 schedules 一致） */
function isoDow(dt) {
  const g = dt.getUTCDay(); // 0=Sunday
  return g === 0 ? 7 : g;
}

/** 节次时间快照表：Map<period, { start_time, end_time, label }> */
function getPeriodTimeMap() {
  const rows = db
    .prepare("SELECT period, start_time, end_time, label FROM period_times")
    .all();
  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.period), {
      start_time: r.start_time || "",
      end_time: r.end_time || "",
      label: r.label || ""
    });
  }
  return map;
}

/** 解析任课教师：优先命中指定学期，其次长期有效（term_id IS NULL）；均无则 null */
function resolveTeacher(classId, courseId, termId) {
  if (termId != null && termId !== "") {
    const exact = db
      .prepare(
        `SELECT teacher_id FROM teaching_assignments
         WHERE class_id = ? AND course_id = ? AND term_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(Number(classId), Number(courseId), Number(termId));
    if (exact) return exact.teacher_id == null ? null : Number(exact.teacher_id);
  }
  const longTerm = db
    .prepare(
      `SELECT teacher_id FROM teaching_assignments
       WHERE class_id = ? AND course_id = ? AND term_id IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(Number(classId), Number(courseId));
  return longTerm && longTerm.teacher_id != null ? Number(longTerm.teacher_id) : null;
}

/**
 * 展开：模板（schedules）× 学期日期范围 → 待生成课次单元格数组。
 * 纯计算、只读；预览与执行共用，保证「预览到的 = 将生成的」。
 * @returns {Array<object>}
 */
function expandTemplates(termId) {
  const term = db.prepare("SELECT * FROM terms WHERE id = ?").get(Number(termId));
  if (!term) throw new Error("学期不存在");
  const start = parseYmd(term.start_date);
  const end = parseYmd(term.end_date);
  if (start > end) throw new Error("学期起止日期非法");

  const templates = db
    .prepare(
      `SELECT id, class_id, course_id, day_of_week, period
       FROM schedules ORDER BY class_id, day_of_week, period`
    )
    .all();
  const periodMap = getPeriodTimeMap();
  const today = todayStr();

  const cells = [];
  for (const t of templates) {
    const dow = Number(t.day_of_week);
    if (dow < 1 || dow > 7) continue;
    const period = Number(t.period);
    if (period < PERIOD_MIN || period > PERIOD_MAX) continue;
    const pt = periodMap.get(period);
    const start_time = pt ? pt.start_time : "";
    const end_time = pt ? pt.end_time : "";
    const teacherId = resolveTeacher(t.class_id, t.course_id, termId);

    // 从学期起点定位到第一个匹配 dow 的日期，之后每 7 天一节
    const offset = (dow - isoDow(start) + 7) % 7;
    let cur = new Date(start.getTime() + offset * ONE_DAY_MS);
    while (cur <= end) {
      const dateStr = fmtYmd(cur);
      cells.push({
        term_id: Number(termId),
        schedule_id: Number(t.id),
        class_id: Number(t.class_id),
        course_id: Number(t.course_id),
        teacher_id: teacherId,
        session_date: dateStr,
        period,
        start_time,
        end_time,
        status: dateStr < today ? STATUS_DONE : STATUS_SCHEDULED,
        origin: "模板生成"
      });
      cur = new Date(cur.getTime() + 7 * ONE_DAY_MS);
    }
  }
  // 稳定排序，便于预览展示与测试断言
  cells.sort(
    (a, b) =>
      (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0) ||
      a.class_id - b.class_id ||
      a.period - b.period ||
      a.course_id - b.course_id
  );
  return cells;
}

/** 已存在课次键集合（按 (class_id|session_date|period)，与 ON CONFLICT 语义一致） */
function existingKeySet(dateStart, dateEnd) {
  const rows = db
    .prepare(
      `SELECT class_id, session_date, period FROM class_sessions
       WHERE session_date BETWEEN ? AND ?`
    )
    .all(dateStart, dateEnd);
  const set = new Set();
  for (const r of rows) set.add(`${r.class_id}|${r.session_date}|${r.period}`);
  return set;
}

/**
 * 预览：纯计算、只读，返回 { to_create, already_exists, classes, templates, missing_period_times, range }。
 */
function previewGeneration(termId) {
  const term = db.prepare("SELECT * FROM terms WHERE id = ?").get(Number(termId));
  if (!term) throw new Error("学期不存在");
  const cells = expandTemplates(termId);
  const existing = existingKeySet(term.start_date, term.end_date);

  let already = 0;
  const classSet = new Set();
  for (const c of cells) {
    classSet.add(c.class_id);
    if (existing.has(`${c.class_id}|${c.session_date}|${c.period}`)) already++;
  }

  const templates = db.prepare("SELECT COUNT(*) AS c FROM schedules").get().c;
  const periodMap = getPeriodTimeMap();
  const usedPeriods = [...new Set(cells.map(c => c.period))].sort((a, b) => a - b);
  const missing_period_times = [];
  for (const p of usedPeriods) {
    const pt = periodMap.get(p);
    if (!pt || !pt.start_time || !pt.end_time) {
      missing_period_times.push({ period: p, label: (pt && pt.label) || `第${p}节` });
    }
  }

  return {
    to_create: cells.length - already,
    already_exists: already,
    plan_total: cells.length,
    classes: classSet.size,
    templates: Number(templates),
    missing_period_times,
    range: { start: term.start_date, end: term.end_date }
  };
}

/** 单条回填：按 (class, course, date) 反查课次，返回命中的课次 id 数组（最多 2 条） */
function makeSessionLookup(termId) {
  const useTerm = termId != null && termId !== "";
  const sql = useTerm
    ? `SELECT id FROM class_sessions
       WHERE class_id = ? AND course_id = ? AND session_date = ?
         AND (term_id = ? OR term_id IS NULL) LIMIT 2`
    : `SELECT id FROM class_sessions
       WHERE class_id = ? AND course_id = ? AND session_date = ? LIMIT 2`;
  const stmt = db.prepare(sql);
  return (classId, courseId, date) =>
    useTerm
      ? stmt.all(Number(classId), Number(courseId), date, Number(termId))
      : stmt.all(Number(classId), Number(courseId), date);
}

/**
 * 历史回填（**假定调用方已开启事务，不自行 BEGIN/COMMIT**）。
 * @param {number|string|null} termId 可选，限定只回填该学期的课次
 * @returns {{matched:number, unmatched:number}}
 */
function backfillSessionsInTx(termId) {
  const findSession = makeSessionLookup(termId);
  const insertReport = db.prepare(
    `INSERT INTO session_migration_report
       (data_type, source_table, source_id, class_id, course_id, student_id, date, matched_session_id, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, '未匹配')
     ON CONFLICT(source_table, source_id) DO NOTHING`
  );
  const deleteReport = db.prepare(
    "DELETE FROM session_migration_report WHERE source_table = ? AND source_id = ?"
  );

  const sources = [
    {
      table: "attendances",
      dataType: "考勤",
      rows: db
        .prepare(
          `SELECT a.id, a.course_id, a.date, a.student_id, s.class_id
           FROM attendances a
           LEFT JOIN students s ON s.id = a.student_id
           WHERE a.session_id IS NULL`
        )
        .all(),
      setSession: db.prepare(
        "UPDATE attendances SET session_id = ?, updated_at = datetime('now','localtime') WHERE id = ?"
      )
    },
    {
      table: "hour_consumptions",
      dataType: "课消",
      rows: db
        .prepare(
          `SELECT id, class_id, course_id, date, student_id
           FROM hour_consumptions WHERE session_id IS NULL`
        )
        .all(),
      setSession: db.prepare("UPDATE hour_consumptions SET session_id = ? WHERE id = ?")
    },
    {
      table: "class_evaluations",
      dataType: "课评",
      rows: db
        .prepare(
          `SELECT id, class_id, course_id, eval_date AS date, student_id
           FROM class_evaluations WHERE session_id IS NULL`
        )
        .all(),
      setSession: db.prepare(
        "UPDATE class_evaluations SET session_id = ?, updated_at = datetime('now','localtime') WHERE id = ?"
      )
    }
  ];

  let matched = 0;
  let unmatched = 0;

  for (const src of sources) {
    for (const row of src.rows) {
      const classId = row.class_id == null ? null : Number(row.class_id);
      const courseId =
        row.course_id == null || row.course_id === "" ? null : Number(row.course_id);
      const date = row.date || "";

      if (classId == null || courseId == null) {
        insertReport.run(
          src.dataType, src.table, row.id, classId, courseId, row.student_id, date, REASON_NO_COURSE
        );
        unmatched++;
        continue;
      }

      const hits = findSession(classId, courseId, date);
      if (hits.length === 1) {
        src.setSession.run(hits[0].id, row.id);
        deleteReport.run(src.table, row.id); // 幂等重跑：清除历史未匹配报告
        matched++;
      } else if (hits.length === 0) {
        insertReport.run(
          src.dataType, src.table, row.id, classId, courseId, row.student_id, date, REASON_NO_SESSION
        );
        unmatched++;
      } else {
        insertReport.run(
          src.dataType, src.table, row.id, classId, courseId, row.student_id, date, REASON_AMBIGUOUS
        );
        unmatched++;
      }
    }
  }

  return { matched, unmatched };
}

/**
 * 生成本学期课次（幂等）+ 同一事务内回填历史。
 * @returns {{created:number, skipped:number, backfilled:number, report_unmatched:number}}
 */
function generateSessions(termId, _userId) {
  const term = db.prepare("SELECT * FROM terms WHERE id = ?").get(Number(termId));
  if (!term) throw new Error("学期不存在");
  const cells = expandTemplates(termId); // 事务外纯读，事务内只做写入
  const insert = db.prepare(
    `INSERT INTO class_sessions
       (term_id, schedule_id, class_id, course_id, teacher_id, substitute_teacher_id, room_id,
        session_date, period, start_time, end_time, status, origin, related_session_id, topic)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, '')
     ON CONFLICT(class_id, session_date, period) DO NOTHING`
  );

  let created = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const c of cells) {
      const r = insert.run(
        c.term_id,
        c.schedule_id,
        c.class_id,
        c.course_id,
        c.teacher_id,
        c.session_date,
        c.period,
        c.start_time,
        c.end_time,
        c.status,
        c.origin
      );
      if (r.changes > 0) created++;
      else skipped++;
    }
    const bf = backfillSessionsInTx(termId);
    db.exec("COMMIT");
    return {
      created,
      skipped,
      backfilled: bf.matched,
      report_unmatched: bf.unmatched
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 独立回填端点用包装（自带事务，可重跑、幂等） */
function backfillSessions(termId) {
  db.exec("BEGIN");
  try {
    const r = backfillSessionsInTx(termId);
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

module.exports = {
  PERIOD_MIN,
  PERIOD_MAX,
  STATUS_SCHEDULED,
  STATUS_DONE,
  todayStr,
  parseYmd,
  fmtYmd,
  isoDow,
  getPeriodTimeMap,
  resolveTeacher,
  expandTemplates,
  previewGeneration,
  generateSessions,
  backfillSessions,
  backfillSessionsInTx
};
