// 成长时间轴 API
//
// 分两类端点，权限严格区分：
// 【采集端 · 面向一线老师，入口在 AI 工作台（统一入口 /ai/）】
//   ⚠️ 定位（2026-09-18 定案）：教务系统给校区负责人/非一线教学人员用，
//   AI 工作台给一线老师用。**老师要用的功能一律收在工作台**，
//   因此「课后随手记」落在工作台的「授课流程」页，而不是教务系统。
//   POST /class-eval        课后 10 秒：专注 / 参与 / 掌握 三维 + 可选备注
//   POST /kp-assessment     课后 1 分钟：批量给知识点打三档
//   GET  /eval-form         取「这节课该评谁、该评哪些知识点」的预填数据
//   ↑ 采集端与查询端**整体**对工作台凭证（type=ai_agent）放行 —— 读写必须同权，
//     否则老师能写却看不到自己写的数据。唯一例外：PUT /thresholds 属管理动作，仍挡。
//     安全边界靠 canManageClass / canManageStudent（老师只能碰自己带的班），
//     不靠"挡住读"。详见 middleware/auth.js。
// 【查询端 · 工作台读，也供教务端成长档案页读】
//   GET  /students/:id/timeline   单学员时间轴（三表 UNION + 新事件）
//   GET  /students/:id/growth     单学员成长画像（起点 vs 现在）
//   GET  /classes/:id/growth      整班成长概览（老师的使用动机来源）
//   GET  /thresholds              读成长阈值
//   PUT  /thresholds              admin 调阈值（不重建镜像）
//
// 权限：全部复用 utils/scope.js，教师只能碰自己带的班（与教务系统内一致）
// 审计：/api/growth 的写操作已计入 AUDIT_MODULES（见 src/index.js）
const express = require("express");
const db = require("../db");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/auth");
const { canManageClass, canManageStudent, canAccessSession } = require("../utils/scope");
const timeline = require("../utils/timeline");

const router = express.Router();

/** 校验日期格式 YYYY-MM-DD */
function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 取学员所属班级（用于权限校验与时间轴归档） */
function studentClass(studentId) {
  return db.prepare("SELECT class_id FROM students WHERE id = ?").get(Number(studentId));
}

// ─────────────────────────────────────────────────────────────
// 采集端
// ─────────────────────────────────────────────────────────────

/**
 * 课堂评价预填数据：老师打开「授课流程」页时，
 * 自动带出本班名单 + 本课时该评的知识点，老师只需点选。
 * 这是「减少老师工作量」的关键——不让老师自己找该评什么。
 */
router.get("/eval-form", auth, (req, res) => {
  const classId = Number(req.query.class_id);
  const date = req.query.date;
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ success: false, message: "class_id 不合法" });
  }
  if (!isDate(date)) {
    return res.status(400).json({ success: false, message: "date 需为 YYYY-MM-DD" });
  }
  if (!canManageClass(req, classId)) {
    return res.status(403).json({ success: false, message: "无权操作该班级" });
  }

  const students = db
    .prepare(
      `SELECT id, student_no, name FROM students
       WHERE class_id = ? AND status = '在读' ORDER BY student_no`
    )
    .all(classId);

  // 今天是否已评过（避免重复录入）
  const existing = db
    .prepare(
      `SELECT student_id, focus, participation, mastery, teacher_note
       FROM class_evaluations WHERE class_id = ? AND eval_date = ?`
    )
    .all(classId, date);
  const existingMap = new Map(existing.map(r => [Number(r.student_id), r]));

  // 该班课程对应的知识点（按单元/序号排，老师按顺序打勾即可）
  const courseRow = db
    .prepare(
      `SELECT c.id FROM courses c
       JOIN schedules s ON s.course_id = c.id
       WHERE s.class_id = ? LIMIT 1`
    )
    .get(classId);
  // ★ 只取**叶子知识点**（parent_id 非空），排除单元节点。
  // knowledge_points 是两级结构：单元（seq=0 / parent_id=NULL，如「第一单元 · 全等三角形」）
  // 与其下的知识点（seq>0 / parent_id=单元 id）。单元是**分组标题**，不是可评定的对象；
  // 若不过滤，采集页会列出老师无法打勾的行，且会被 LIMIT 挤掉真正可评的知识点。
  // 用 parent_id IS NOT NULL 而非 seq > 0：语义更准（有父节点才是叶子），
  // 即使将来新增「不按 seq 编号」的知识点也不会漏。
  const kps = courseRow
    ? db
        .prepare(
          `SELECT k.id, k.code, k.name, k.unit_no, k.seq, k.difficulty,
                  p.name AS unit_name
           FROM knowledge_points k
           LEFT JOIN knowledge_points p ON p.id = k.parent_id
           WHERE k.course_id = ? AND k.is_active = 1 AND k.parent_id IS NOT NULL
           ORDER BY k.unit_no, k.seq LIMIT 40`
        )
        .all(courseRow.id)
    : [];

  res.json({
    success: true,
    data: {
      class_id: classId,
      date,
      students: students.map(s => {
        const ex = existingMap.get(Number(s.id));
        return {
          id: Number(s.id),
          no: s.student_no,
          name: s.name,
          evaluated: !!ex,
          eval: ex
            ? {
                focus: Number(ex.focus),
                participation: Number(ex.participation),
                mastery: Number(ex.mastery),
                note: ex.teacher_note
              }
            : null
        };
      }),
      knowledge_points: kps.map(k => ({
        id: Number(k.id),
        code: k.code,
        name: k.name,
        unit_no: Number(k.unit_no),
        // 所属单元名，供采集页做分组标题（来源就是被过滤掉的那层单元节点，
        // 这样老师仍能看清"这个知识点属于哪一章"，只是它本身不可打勾）
        unit_name: k.unit_name || null,
        seq: Number(k.seq),
        difficulty: Number(k.difficulty)
      })),
      already_evaluated: existingMap.size
    }
  });
});

/**
 * 提交课堂评价（老师课后 10 秒动作）。
 * 幂等：同班同课同日期重复提交按覆盖处理（老师改主意是合理的），
 * 同时向时间轴追加一条事件——注意时间轴是只增不改，改评价会产生新事件。
 * 这里刻意区分：class_evaluations 是「当前状态」（可改），
 * student_timeline 是「历史事实」（不可改）。
 */
router.post("/class-eval", auth, (req, res, next) => {
  const { class_id, course_id, eval_date, items, session_no, session_id } = req.body || {};
  const classId = Number(class_id);
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ success: false, message: "class_id 不合法" });
  }
  if (!isDate(eval_date)) {
    return res.status(400).json({ success: false, message: "eval_date 需为 YYYY-MM-DD" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "items 不能为空" });
  }
  // 课次分支（G1-P0-4）：可选。传入时按时课次 upsert，并允许该课次代课人录入（Q5）
  const sessionId = session_id != null && session_id !== "" ? Number(session_id) : null;
  let sessionRow = null;
  if (sessionId != null) {
    sessionRow = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(sessionId);
    if (!sessionRow) {
      return res.status(400).json({ success: false, message: "课次不存在" });
    }
    if (Number(sessionRow.class_id) !== classId) {
      return res.status(400).json({ success: false, message: "课次不属于该班级" });
    }
    if (sessionRow.status === "已停课") {
      return res.status(400).json({ success: false, message: "该课次已停课，不能录课评" });
    }
  }
  if (!canManageClass(req, classId) && !(sessionId != null && canAccessSession(req, sessionId))) {
    return res.status(403).json({ success: false, message: "无权操作该班级" });
  }

  const clamp = v => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
  };

  // 课次序号由课次推算（不再手填）：该班截至本课次日期（含）的课次总数
  let sessionNo = Number(session_no) || 0;
  if (sessionRow) {
    sessionNo = db
      .prepare("SELECT COUNT(*) AS c FROM class_sessions WHERE class_id = ? AND session_date <= ?")
      .get(classId, sessionRow.session_date).c;
  }

  try {
    db.exec("BEGIN");
    let saved = 0;
    let appended = 0;

    // legacy（无课次）：唯一键为部分索引，冲突目标须显式带 WHERE session_id IS NULL
    const legacyUpsert = db.prepare(
      `INSERT INTO class_evaluations
         (class_id, course_id, student_id, eval_date, session_no,
          focus, participation, mastery, teacher_note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, course_id, eval_date) WHERE session_id IS NULL DO UPDATE SET
         focus = excluded.focus,
         participation = excluded.participation,
         mastery = excluded.mastery,
         teacher_note = excluded.teacher_note,
         updated_at = datetime('now','localtime')`
    );
    // 课次分支：按 (session_id, student_id) 手动 select → insert/update
    const findEvalBySession = db.prepare(
      "SELECT id FROM class_evaluations WHERE session_id = ? AND student_id = ?"
    );
    const insertEvalSession = db.prepare(
      `INSERT INTO class_evaluations
         (class_id, course_id, student_id, eval_date, session_id, session_no,
          focus, participation, mastery, teacher_note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updateEvalSession = db.prepare(
      `UPDATE class_evaluations
       SET focus = ?, participation = ?, mastery = ?, teacher_note = ?,
           updated_at = datetime('now','localtime')
       WHERE session_id = ? AND student_id = ?`
    );

    for (const it of items) {
      const sid = Number(it.student_id);
      if (!Number.isInteger(sid) || sid <= 0) continue;
      // 越权保护：学生必须属于该班
      const sc = studentClass(sid);
      if (!sc || Number(sc.class_id) !== classId) continue;

      const focus = clamp(it.focus);
      const participation = clamp(it.participation);
      const mastery = clamp(it.mastery);
      const note = typeof it.note === "string" ? it.note.slice(0, 200) : "";

      if (sessionRow) {
        if (findEvalBySession.get(sessionId, sid)) {
          updateEvalSession.run(focus, participation, mastery, note, sessionId, sid);
        } else {
          insertEvalSession.run(
            classId, course_id || null, sid, eval_date, sessionId, sessionNo,
            focus, participation, mastery, note, req.user.id
          );
        }
      } else {
        legacyUpsert.run(
          classId, course_id || null, sid, eval_date, sessionNo,
          focus, participation, mastery, note, req.user.id
        );
      }
      saved++;

      // 只增不改：每次提交都追加一条历史事件（payload 不含敏感字段）
      timeline.appendEvent({
        studentId: sid,
        classId,
        courseId: course_id || null,
        occurredAt: eval_date,
        eventType: "class_eval",
        payload: { focus, participation, mastery, teacherNote: note },
        source: "manual",
        createdBy: req.user.id
      });
      appended++;
    }

    db.exec("COMMIT");
    res.json({
      success: true,
      data: { saved, appended, eval_date, class_id: classId }
    });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    next(e);
  }
});

/**
 * 批量知识点评定（老师课后 1 分钟动作）。
 * 支持两种粒度：
 * - 全班同状态：kps: [{kp_id, level}], student_ids: [1,2,3...]（默认全班）
 * - 个别学生单独调：overrides: [{student_id, kp_id, level}]
 */
router.post("/kp-assessment", auth, (req, res, next) => {
  const { class_id, course_id, assessed_at, kps, student_ids, overrides, session_no } = req.body || {};
  const classId = Number(class_id);
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ success: false, message: "class_id 不合法" });
  }
  if (!isDate(assessed_at)) {
    return res.status(400).json({ success: false, message: "assessed_at 需为 YYYY-MM-DD" });
  }
  if (!Array.isArray(kps) || kps.length === 0) {
    return res.status(400).json({ success: false, message: "kps 不能为空" });
  }
  if (!canManageClass(req, classId)) {
    return res.status(403).json({ success: false, message: "无权操作该班级" });
  }

  const LEVELS = new Set(["未掌握", "部分掌握", "已掌握"]);

  // 目标学生：显式传入或默认全班在读
  let targets = Array.isArray(student_ids) && student_ids.length
    ? student_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : db
        .prepare("SELECT id FROM students WHERE class_id = ? AND status = '在读'")
        .all(classId)
        .map(r => Number(r.id));

  // 越权保护：剔除不属于该班的学生
  const validIds = new Set(
    db
      .prepare("SELECT id FROM students WHERE class_id = ?")
      .all(classId)
      .map(r => Number(r.id))
  );
  targets = targets.filter(id => validIds.has(id));

  const kpIds = kps.map(k => Number(k.kp_id)).filter(n => Number.isInteger(n) && n > 0);
  const kpInfo = new Map(
    db
      .prepare(
        `SELECT id, name FROM knowledge_points WHERE id IN (${kpIds.map(() => "?").join(",") || "NULL"})`
      )
      .all(...kpIds)
      .map(k => [Number(k.id), k.name])
  );

  // 覆盖项：个别学生的特殊状态
  const overrideMap = new Map();
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      const sid = Number(o.student_id);
      const kid = Number(o.kp_id);
      if (validIds.has(sid) && kpInfo.has(kid) && LEVELS.has(o.level)) {
        overrideMap.set(`${sid}:${kid}`, o.level);
      }
    }
  }

  try {
    db.exec("BEGIN");
    const ins = db.prepare(
      `INSERT INTO kp_assessments
         (student_id, kp_id, class_id, course_id, assessed_at, session_no, level, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let count = 0;
    for (const sid of targets) {
      for (const k of kps) {
        const kid = Number(k.kp_id);
        if (!kpInfo.has(kid)) continue;
        const key = `${sid}:${kid}`;
        const level = overrideMap.get(key) || k.level;
        if (!LEVELS.has(level)) continue;

        // 取上一次等级，写进事件 payload 用于「从 X → Y」的成长叙述
        const prev = db
          .prepare(
            `SELECT level FROM kp_assessments
             WHERE student_id = ? AND kp_id = ?
             ORDER BY assessed_at DESC, id DESC LIMIT 1`
          )
          .get(sid, kid);

        ins.run(sid, kid, classId, course_id || null, assessed_at,
                Number(session_no) || 0, level, req.user.id);
        count++;

        timeline.appendEvent({
          studentId: sid,
          classId,
          courseId: course_id || null,
          occurredAt: assessed_at,
          eventType: "kp_assessment",
          payload: {
            kpId: kid,
            kpName: kpInfo.get(kid),
            level,
            from: prev ? prev.level : null,
            changed: !prev || prev.level !== level
          },
          source: "manual",
          createdBy: req.user.id
        });
      }
    }

    db.exec("COMMIT");
    res.json({ success: true, data: { students: targets.length, records: count } });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────
// 查询端
// ─────────────────────────────────────────────────────────────

/** 单学员成长时间轴 */
router.get("/students/:id/timeline", auth, (req, res) => {
  const sid = Number(req.params.id);
  if (!Number.isInteger(sid) || sid <= 0) {
    return res.status(400).json({ success: false, message: "学员 ID 不合法" });
  }
  if (!canManageStudent(req, sid)) {
    return res.status(403).json({ success: false, message: "无权查看该学员" });
  }
  const data = timeline.studentTimeline(sid, {
    from: isDate(req.query.from) ? req.query.from : undefined,
    to: isDate(req.query.to) ? req.query.to : undefined
  });
  res.json({ success: true, data });
});

/** 单学员成长画像（起点 vs 现在） */
router.get("/students/:id/growth", auth, (req, res) => {
  const sid = Number(req.params.id);
  if (!Number.isInteger(sid) || sid <= 0) {
    return res.status(400).json({ success: false, message: "学员 ID 不合法" });
  }
  if (!canManageStudent(req, sid)) {
    return res.status(403).json({ success: false, message: "无权查看该学员" });
  }
  const data = timeline.studentGrowth(sid, {
    from: isDate(req.query.from) ? req.query.from : undefined,
    to: isDate(req.query.to) ? req.query.to : undefined
  });
  res.json({ success: true, data });
});

/** 整班成长概览 */
router.get("/classes/:id/growth", auth, (req, res) => {
  const cid = Number(req.params.id);
  if (!Number.isInteger(cid) || cid <= 0) {
    return res.status(400).json({ success: false, message: "班级 ID 不合法" });
  }
  if (!canManageClass(req, cid)) {
    return res.status(403).json({ success: false, message: "无权查看该班级" });
  }
  const data = timeline.classGrowth(cid, {
    from: isDate(req.query.from) ? req.query.from : undefined,
    to: isDate(req.query.to) ? req.query.to : undefined
  });
  res.json({ success: true, data });
});

/** 知识点列表（工作台做筛选与展示用） */
router.get("/knowledge-points", auth, (req, res) => {
  const courseId = Number(req.query.course_id);
  const where = [];
  const params = [];
  if (Number.isInteger(courseId) && courseId > 0) {
    where.push("course_id = ?");
    params.push(courseId);
  }
  const rows = db
    .prepare(
      `SELECT id, parent_id, code, name, course_id, grade, unit_no, seq, difficulty
       FROM knowledge_points
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY unit_no, seq`
    )
    .all(...params);
  res.json({
    success: true,
    data: rows.map(r => ({
      id: Number(r.id),
      parent_id: r.parent_id === null ? null : Number(r.parent_id),
      code: r.code,
      name: r.name,
      course_id: r.course_id === null ? null : Number(r.course_id),
      grade: r.grade,
      unit_no: Number(r.unit_no),
      seq: Number(r.seq),
      difficulty: Number(r.difficulty)
    }))
  });
});

/** 读成长阈值 */
router.get("/thresholds", auth, (_req, res) => {
  const rows = db
    .prepare("SELECT key, value, label, description FROM growth_thresholds ORDER BY key")
    .all();
  res.json({
    success: true,
    data: rows.map(r => ({
      key: r.key,
      value: Number(r.value),
      label: r.label,
      description: r.description
    }))
  });
});

/** 改成长阈值（仅 admin，改完立即生效、无需重建镜像） */
router.put("/thresholds", auth, requireRole("admin"), (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "items 不能为空" });
  }
  const upd = db.prepare(
    "UPDATE growth_thresholds SET value = ?, updated_by = ?, updated_at = datetime('now','localtime') WHERE key = ?"
  );
  let n = 0;
  for (const it of items) {
    if (typeof it.key !== "string" || !it.key) continue;
    if (!Number.isFinite(Number(it.value))) continue;
    const exists = db.prepare("SELECT 1 FROM growth_thresholds WHERE key = ?").get(it.key);
    if (!exists) continue;
    upd.run(String(it.value), req.user.id, it.key);
    n++;
  }
  res.json({ success: true, data: { updated: n } });
});

module.exports = router;
