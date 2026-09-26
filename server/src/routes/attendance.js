// 考勤：名单、批量提交、记录查询、统计（学生/班级）、周月趋势、缺勤预警
// 数据权限：教师仅可操作/统计自己绑定班级的考勤；管理员不限
const express = require("express");
const db = require("../db");
const { auth } = require("../middleware/auth");
const {
  classScopeClause,
  canManageClass,
  canManageStudent,
  canAccessSession,
  teacherClassPredicate
} = require("../utils/scope");
const { getDeductStatuses } = require("../utils/attendance-rules");
const { attendanceRate } = require("../utils/attendance-rate");
const { parseDate } = require("../utils/validate");

const router = express.Router();

const STATUSES = ["正常", "迟到", "早退", "缺勤", "请假"];

/** 某课程某日 / 某课次 的全班考勤名单（教师仅限本班；传 session_id 时含停课校验 + 代课人可看）
 *  - 不传 session_id：旧行为（date + class_id + course_id 必填）
 *  - 传 session_id：按课次取名单，date/course_id 取自课次，班级为课次所属班级 */
router.get("/", auth, (req, res) => {
  const { date, class_id, course_id, session_id } = req.query;

  const sessionId = session_id != null && session_id !== "" ? Number(session_id) : null;
  if (sessionId != null) {
    const session = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "课次不存在" });
    }
    if (!canAccessSession(req, sessionId)) {
      return res.status(403).json({ success: false, message: "无权查看该课次考勤" });
    }
    const list = db
      .prepare(
        `SELECT s.id AS student_id, s.student_no, s.name, s.gender,
                a.status, a.remark, a.id AS attendance_id
         FROM students s
         LEFT JOIN attendances a
           ON a.student_id = s.id AND a.session_id = ?
         WHERE s.class_id = ? AND s.status = '在读'
         ORDER BY s.student_no`
      )
      .all(sessionId, Number(session.class_id));
    return res.json({ success: true, data: list });
  }

  if (!date || !class_id || !course_id) {
    return res
      .status(400)
      .json({ success: false, message: "日期、班级、课程均为必填" });
  }
  if (!canManageClass(req, class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权查看该班级考勤" });
  }
  const list = db
    .prepare(
      `SELECT s.id AS student_id, s.student_no, s.name, s.gender,
              a.status, a.remark, a.id AS attendance_id
       FROM students s
       LEFT JOIN attendances a
         ON a.student_id = s.id AND a.course_id = ? AND a.date = ?
       WHERE s.class_id = ? AND s.status = '在读'
       ORDER BY s.student_no`
    )
    .all(Number(course_id), date, Number(class_id));
  res.json({ success: true, data: list });
});

/** 批量保存某课程某日全班考勤（事务 upsert；教师仅可提交本班学生）
 *  课时联动：状态为 正常/迟到/早退 时扣减该学员匹配课时包的剩余课时；缺勤/请假不扣；
 *  修改既有考勤时按新旧状态差异自动回补/扣减 */
router.post("/batch", auth, (req, res) => {
  const body = req.body || {};
  let { date, course_id } = body;
  const { records } = body;
  const sessionIdIn =
    body.session_id != null && body.session_id !== "" ? Number(body.session_id) : null;

  if (!Array.isArray(records) || records.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "请先选择日期、课程并填写考勤记录" });
  }

  const getStudentClass = db.prepare("SELECT class_id FROM students WHERE id = ?");

  // 课次分支：按课次 upsert（含停课阻断 + 代课人可录，Q5/Q9）
  let session = null;
  if (sessionIdIn != null) {
    session = db.prepare("SELECT * FROM class_sessions WHERE id = ?").get(sessionIdIn);
    if (!session) {
      return res.status(404).json({ success: false, message: "课次不存在" });
    }
    if (!canAccessSession(req, sessionIdIn)) {
      return res.status(403).json({ success: false, message: "无权操作该课次考勤" });
    }
    if (session.status === "已停课") {
      return res
        .status(400)
        .json({ success: false, message: "该课次已停课，不能点名（请先恢复）" });
    }
    for (const r of records) {
      if (!STATUSES.includes(r.status)) {
        return res
          .status(400)
          .json({ success: false, message: `考勤状态「${r.status}」不合法` });
      }
      const st = getStudentClass.get(Number(r.student_id));
      if (!st || Number(st.class_id) !== Number(session.class_id)) {
        return res
          .status(403)
          .json({ success: false, message: "包含不属于该课次班级的学生记录" });
      }
    }
  } else {
    if (!date || !course_id) {
      return res
        .status(400)
        .json({ success: false, message: "请先选择日期、课程并填写考勤记录" });
    }
    // 日期必须是真实存在的 YYYY-MM-DD（2026-09-12 全面测试发现：此前任意字符串都会被接受，
    // 且照常扣减课时，例如 date="2026-99-99" / "xxxx-xx-xx" 均返回 200 并扣 1 课时）
    const dateRes = parseDate(date, { field: "考勤日期" });
    if (!dateRes.ok) {
      return res.status(400).json({ success: false, message: dateRes.message });
    }
    date = dateRes.value;
    for (const r of records) {
      if (!STATUSES.includes(r.status)) {
        return res
          .status(400)
          .json({ success: false, message: `考勤状态「${r.status}」不合法` });
      }
      if (!canManageStudent(req, r.student_id)) {
        return res
          .status(403)
          .json({ success: false, message: "包含无权操作的学生记录" });
      }
    }
  }

  // 有效字段：课次分支取自课次，避免与课次不一致造成脏数据
  const effCourseId = session ? Number(session.course_id) : Number(course_id);
  const effDate = session ? session.session_date : date;
  const effSessionId = session ? Number(session.id) : null;
  const effClassId = session ? Number(session.class_id) : null;

  // legacy 分支：唯一键现为部分索引（WHERE session_id IS NULL），冲突目标须显式带 WHERE
  const insert = db.prepare(
    `INSERT INTO attendances (student_id, course_id, date, status, remark)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(student_id, course_id, date) WHERE session_id IS NULL
     DO UPDATE SET status = excluded.status, remark = excluded.remark, updated_at = datetime('now', 'localtime')`
  );
  const getOld = db.prepare(
    "SELECT status FROM attendances WHERE student_id = ? AND course_id = ? AND date = ?"
  );
  // 课次分支：按 (session_id, student_id) 手动 select → insert/update
  const findAttBySession = db.prepare(
    "SELECT id FROM attendances WHERE session_id = ? AND student_id = ?"
  );
  const insertSessionAtt = db.prepare(
    "INSERT INTO attendances (student_id, course_id, date, status, remark, session_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const updateSessionAtt = db.prepare(
    "UPDATE attendances SET status = ?, remark = ?, updated_at = datetime('now','localtime') WHERE session_id = ? AND student_id = ?"
  );
  // 匹配「在读 + 同一课程 + 设置了课时包」的订单做联动扣减
  // v13：扣减优先选择剩余课时最多的订单（余额为 0 跳过），避免单个订单扣空后悬挂；
  //      回补使用不带余额条件的查询（余额为 0 时同样可以回补恢复）
  const findDeductOrder = db.prepare(
    "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 AND remain_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
  );
  const findRefundOrder = db.prepare(
    "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
  );
  const deductOrder = db.prepare(
    "UPDATE orders SET remain_hours = MAX(0, remain_hours - 1), updated_at = datetime('now','localtime') WHERE id = ?"
  );
  // v13：回补设上限（remain_hours 不超过 total_hours）
  const refundOrder = db.prepare(
    "UPDATE orders SET remain_hours = MIN(total_hours, remain_hours + 1), updated_at = datetime('now','localtime') WHERE id = ?"
  );
  // 课时消耗流水：扣减/回补后落流水（date 为考勤日期，session_id 课次分支落课次 id，legacy 为 NULL）
  const insertCons = db.prepare(
    "INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, session_id, hours, type, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  // 扣课状态集中读取点（G1-P0-12），行为不变
  const DEDUCT_STATUSES = getDeductStatuses();
  const isDeduct = st => DEDUCT_STATUSES.includes(st);

  // v13 考勤↔请假联动（G11 补齐反向缺口）：
  //  - 标记"请假"自动生成待审批同步请假单；幂等判断覆盖任意来源（手动/同步）的待审批或已通过单，避免重复生成
  //  - 改回其他状态撤销当日同步单（待审批删除 / 已通过删除，连同"请假审批通过"通知一并撤销）
  const hasSyncLeave = db.prepare(
    "SELECT 1 FROM leaves WHERE student_id = ? AND status IN ('待审批', '通过') AND start_date <= ? AND end_date >= ? LIMIT 1"
  );
  const insertSyncLeave = db.prepare(
    "INSERT INTO leaves (student_id, type, reason, start_date, end_date, status, source) VALUES (?, '其他', '考勤登记同步', ?, ?, '待审批', '考勤同步')"
  );
  const deleteSyncLeave = db.prepare(
    "DELETE FROM leaves WHERE student_id = ? AND source = '考勤同步' AND status IN ('待审批', '通过') AND start_date <= ? AND end_date >= ?"
  );
  const deleteLeaveApprovedNotice = db.prepare(
    "DELETE FROM notifications WHERE student_id = ? AND date BETWEEN ? AND ? AND type = '请假审批通过'"
  );

  // 缺勤通知联动（家校留痕）：状态变为「缺勤」→ 为学生档案的家长生成通知；改为非缺勤 → 撤销当日缺勤通知
  const getParentName = db.prepare(
    "SELECT parent_name FROM students WHERE id = ?"
  );
  const hasAbsentNotice = db.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE student_id = ? AND date = ? AND type = '考勤缺勤'"
  );
  const insertNotice = db.prepare(
    "INSERT INTO notifications (student_id, type, title, content, date, parent_name) VALUES (?, '考勤缺勤', ?, ?, ?, ?)"
  );
  const deleteAbsentNotice = db.prepare(
    "DELETE FROM notifications WHERE student_id = ? AND date = ? AND type = '考勤缺勤'"
  );
  const getStudentName = db.prepare("SELECT name FROM students WHERE id = ?");
  const getCourseName = db.prepare("SELECT name FROM courses WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const r of records) {
      const sid = Number(r.student_id);
      const existing = session ? findAttBySession.get(effSessionId, sid) : null;
      const oldStatus = session
        ? existing?.status
        : getOld.get(sid, effCourseId, effDate)?.status;

      if (session) {
        if (existing) {
          updateSessionAtt.run(r.status, r.remark || "", effSessionId, sid);
        } else {
          insertSessionAtt.run(sid, effCourseId, effDate, r.status, r.remark || "", effSessionId);
        }
      } else {
        insert.run(sid, effCourseId, effDate, r.status, r.remark || "");
      }

      if (oldStatus !== r.status) {
        const order = (
          isDeduct(r.status) ? findDeductOrder : findRefundOrder
        ).get(sid, effCourseId);
        if (order) {
          const oldDeduct = oldStatus ? isDeduct(oldStatus) : false;
          const newDeduct = isDeduct(r.status);
          const classId = session
            ? effClassId
            : getStudentClass.get(sid)?.class_id ?? null;
          if (!oldDeduct && newDeduct) {
            deductOrder.run(order.id);
            insertCons.run(
              sid,
              order.id,
              effCourseId,
              classId,
              effDate,
              effSessionId,
              1,
              "扣减",
              req.user.id
            );
          } else if (oldDeduct && !newDeduct) {
            refundOrder.run(order.id);
            insertCons.run(
              sid,
              order.id,
              effCourseId,
              classId,
              effDate,
              effSessionId,
              1,
              "回补",
              req.user.id
            );
          }
        }
        // 缺勤通知联动
        if (r.status === "缺勤") {
          if (hasAbsentNotice.get(sid, effDate).c === 0) {
            const student = getStudentName.get(sid);
            const course = getCourseName.get(effCourseId);
            const title = "考勤缺勤提醒";
            const content = `${student?.name || "学员"} ${effDate} ${course?.name || "课程"} 缺勤，请家长关注`;
            const parentName =
              getParentName.get(sid)?.parent_name || "";
            insertNotice.run(
              sid,
              title,
              content,
              effDate,
              parentName
            );
          }
        } else if (oldStatus === "缺勤") {
          deleteAbsentNotice.run(sid, effDate);
        }
        // v13 考勤↔请假联动（G11）：标记"请假"→ 生成待审批考勤同步请假单（幂等：覆盖任意来源的待审批/通过单则不重复）；
        //        改回其他状态 → 撤销当日同步单（待审批/已通过一并删除）+ 撤销"请假审批通过"通知
        if (r.status === "请假") {
          if (!hasSyncLeave.get(sid, effDate, effDate)) {
            insertSyncLeave.run(sid, effDate, effDate);
          }
        } else if (oldStatus === "请假") {
          deleteSyncLeave.run(sid, effDate, effDate);
          deleteLeaveApprovedNotice.run(sid, effDate, effDate);
        }
      }
    }
    db.exec("COMMIT");
    res.json({ success: true, data: { count: records.length } });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

/** 考勤记录查询（分页，供考勤记录页查看/导出） */
router.get("/records", auth, (req, res) => {
  const {
    date_start,
    date_end,
    course_id,
    class_id,
    student_id,
    status,
    page = 1,
    pageSize = 10
  } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  if (req.user.role === "teacher") {
    where += ` AND ${teacherClassPredicate("c")}`;
    params.push(req.user.id, req.user.id);
  }
  if (date_start) {
    where += " AND a.date >= ?";
    params.push(date_start);
  }
  if (date_end) {
    where += " AND a.date <= ?";
    params.push(date_end);
  }
  if (course_id) {
    where += " AND a.course_id = ?";
    params.push(Number(course_id));
  }
  if (class_id) {
    where += " AND s.class_id = ?";
    params.push(Number(class_id));
  }
  if (student_id) {
    where += " AND a.student_id = ?";
    params.push(Number(student_id));
  }
  if (status) {
    where += " AND a.status = ?";
    params.push(status);
  }

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM attendances a
       JOIN students s ON a.student_id = s.id
       JOIN classes c ON s.class_id = c.id
       ${where}`
    )
    .get(...params).c;
  const list = db
    .prepare(
      `SELECT a.id, a.date, a.status, a.remark, a.updated_at,
              a.session_id,
              s.id AS student_id, s.student_no, s.name AS student_name,
              c.name AS class_name, co.name AS course_name, co.id AS course_id
       FROM attendances a
       JOIN students s ON a.student_id = s.id
       JOIN classes c ON s.class_id = c.id
       LEFT JOIN courses co ON a.course_id = co.id
       ${where}
       ORDER BY a.date DESC, a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 考勤统计（dimension=student|class；教师仅统计本班） */
router.get("/statistics", auth, (req, res) => {
  const { dimension = "student", course_id, class_id, start, end } = req.query;
  const scope = classScopeClause(req);

  const cond = [];
  const params = [];
  if (course_id) {
    cond.push("a.course_id = ?");
    params.push(Number(course_id));
  }
  if (start) {
    cond.push("a.date >= ?");
    params.push(start);
  }
  if (end) {
    cond.push("a.date <= ?");
    params.push(end);
  }
  const joinCond = cond.length ? ` AND ${cond.join(" AND ")}` : "";

  const sumExpr = `
    COUNT(a.id) AS total,
    SUM(CASE WHEN a.status = '正常' THEN 1 ELSE 0 END) AS normal_count,
    SUM(CASE WHEN a.status = '迟到' THEN 1 ELSE 0 END) AS late_count,
    SUM(CASE WHEN a.status = '早退' THEN 1 ELSE 0 END) AS early_count,
    SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent_count,
    SUM(CASE WHEN a.status = '请假' THEN 1 ELSE 0 END) AS leave_count`;

  let list;
  if (dimension === "class") {
    let where = "WHERE 1=1";
    const whereParams = [...params, ...scope.params];
    if (class_id) {
      where += " AND c.id = ?";
      whereParams.push(Number(class_id));
    }
    list = db
      .prepare(
        `SELECT c.id, c.name, c.grade, c.head_teacher, ${sumExpr}
         FROM classes c
         LEFT JOIN students s ON s.class_id = c.id
         LEFT JOIN attendances a ON a.student_id = s.id${joinCond}
         ${where}${scope.clause}
         GROUP BY c.id
         ORDER BY c.id`
      )
      .all(...whereParams);
  } else {
    let where = "WHERE 1=1";
    const whereParams = [...params, ...scope.params];
    if (class_id) {
      where += " AND s.class_id = ?";
      whereParams.push(Number(class_id));
    }
    list = db
      .prepare(
        `SELECT s.id, s.student_no, s.name, c.name AS class_name, ${sumExpr}
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         LEFT JOIN attendances a ON a.student_id = s.id${joinCond}
         ${where}${scope.clause}
         GROUP BY s.id
         ORDER BY total DESC`
      )
      .all(...whereParams);
  }

  // 汇总（教师仅统计本班）
  const summaryScope =
    req.user.role === "teacher"
      ? ` AND a.student_id IN (SELECT s.id FROM students s JOIN classes c ON s.class_id = c.id WHERE ${teacherClassPredicate("c")})`
      : "";
  const summaryParams =
    req.user.role === "teacher" ? [req.user.id, req.user.id, ...params] : [...params];
  const summary = db
    .prepare(
      `SELECT
         COUNT(a.id) AS total,
         SUM(CASE WHEN a.status = '正常' THEN 1 ELSE 0 END) AS normal_count,
         SUM(CASE WHEN a.status = '迟到' THEN 1 ELSE 0 END) AS late_count,
         SUM(CASE WHEN a.status = '早退' THEN 1 ELSE 0 END) AS early_count,
         SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent_count,
         SUM(CASE WHEN a.status = '请假' THEN 1 ELSE 0 END) AS leave_count
       FROM attendances a WHERE 1=1${summaryScope}${cond.length ? ` AND ${cond.join(" AND ")}` : ""}`
    )
    .get(...summaryParams);

  const withRate = list.map(item => {
    const total = Number(item.total || 0);
    const absent = Number(item.absent_count || 0);
    return {
      ...item,
      total,
      normal_count: Number(item.normal_count || 0),
      late_count: Number(item.late_count || 0),
      early_count: Number(item.early_count || 0),
      absent_count: absent,
      leave_count: Number(item.leave_count || 0),
      attendance_rate: attendanceRate(total, absent)
    };
  });

  res.json({
    success: true,
    data: {
      list: withRate,
      summary: {
        total: Number(summary.total || 0),
        normal_count: Number(summary.normal_count || 0),
        late_count: Number(summary.late_count || 0),
        early_count: Number(summary.early_count || 0),
        absent_count: Number(summary.absent_count || 0),
        leave_count: Number(summary.leave_count || 0)
      }
    }
  });
});

/** 出勤趋势（period=day|week|month；教师仅统计本班） */
router.get("/statistics/trend", auth, (req, res) => {
  const { period = "day", course_id, class_id, start, end } = req.query;
  const scope = classScopeClause(req);

  const cond = [];
  const params = [];
  if (course_id) {
    cond.push("a.course_id = ?");
    params.push(Number(course_id));
  }
  if (class_id) {
    cond.push("s.class_id = ?");
    params.push(Number(class_id));
  }
  if (start) {
    cond.push("a.date >= ?");
    params.push(start);
  }
  if (end) {
    cond.push("a.date <= ?");
    params.push(end);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "WHERE 1=1";

  const labelExpr =
    period === "month"
      ? "strftime('%Y-%m', a.date)"
      : period === "week"
        ? "strftime('%Y-W%W', a.date)"
        : "a.date";

  const rows = db
    .prepare(
      `SELECT ${labelExpr} AS label,
         COUNT(a.id) AS total,
         SUM(CASE WHEN a.status = '正常' THEN 1 ELSE 0 END) AS normal_count,
         SUM(CASE WHEN a.status = '迟到' THEN 1 ELSE 0 END) AS late_count,
         SUM(CASE WHEN a.status = '早退' THEN 1 ELSE 0 END) AS early_count,
         SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent_count,
         SUM(CASE WHEN a.status = '请假' THEN 1 ELSE 0 END) AS leave_count
       FROM attendances a
       JOIN students s ON a.student_id = s.id
       JOIN classes c ON s.class_id = c.id
       ${where}${scope.clause}
       GROUP BY label ORDER BY label`
    )
    .all(...params, ...scope.params);

  const data = rows.map(r => {
    const total = Number(r.total || 0);
    const absent = Number(r.absent_count || 0);
    return {
      label: r.label,
      total,
      normal_count: Number(r.normal_count || 0),
      late_count: Number(r.late_count || 0),
      early_count: Number(r.early_count || 0),
      absent_count: absent,
      leave_count: Number(r.leave_count || 0),
      attendance_rate: attendanceRate(total, absent)
    };
  });

  res.json({ success: true, data });
});

/** 月度报表：按「班级 × 月份」聚合出勤情况（教师仅本班） */
router.get("/statistics/monthly", auth, (req, res) => {
  const { course_id, class_id, start, end } = req.query;
  const scope = classScopeClause(req);

  const cond = [];
  const params = [];
  if (course_id) {
    cond.push("a.course_id = ?");
    params.push(Number(course_id));
  }
  if (class_id) {
    cond.push("s.class_id = ?");
    params.push(Number(class_id));
  }
  if (start) {
    cond.push("a.date >= ?");
    params.push(start);
  }
  if (end) {
    cond.push("a.date <= ?");
    params.push(end);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "WHERE 1=1";

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', a.date) AS month,
              c.id AS class_id, c.name AS class_name,
              COUNT(a.id) AS total,
              SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent_count
       FROM attendances a
       JOIN students s ON a.student_id = s.id
       JOIN classes c ON s.class_id = c.id
       ${where}${scope.clause}
       GROUP BY month, c.id ORDER BY month, c.id`
    )
    .all(...params, ...scope.params);

  // 汇总（教师仅本班）
  const summaryScope =
    req.user.role === "teacher"
      ? ` AND a.student_id IN (SELECT s.id FROM students s JOIN classes c ON s.class_id = c.id WHERE ${teacherClassPredicate("c")})`
      : "";
  const summaryParams =
    req.user.role === "teacher" ? [req.user.id, req.user.id, ...params] : [...params];
  const summary = db
    .prepare(
      `SELECT COUNT(a.id) AS total,
              SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent_count
       FROM attendances a WHERE 1=1${summaryScope}${cond.length ? ` AND ${cond.join(" AND ")}` : ""}`
    )
    .get(...summaryParams);

  // 组装 班级 × 月份 矩阵
  const months = [...new Set(rows.map(r => r.month))];
  const byClass = new Map();
  for (const r of rows) {
    const total = Number(r.total || 0);
    const absent = Number(r.absent_count || 0);
    if (!byClass.has(r.class_id))
      byClass.set(r.class_id, {
        class_id: r.class_id,
        class_name: r.class_name,
        month_data: {},
        total: 0,
        absent: 0
      });
    const c = byClass.get(r.class_id);
    c.month_data[r.month] = {
      total,
      absent,
      attendance_rate: attendanceRate(total, absent)
    };
    c.total += total;
    c.absent += absent;
  }
  const rowList = [...byClass.values()].map(c => ({
    ...c,
    attendance_rate: attendanceRate(c.total, c.absent)
  }));

  const sTotal = Number(summary.total || 0);
  const sAbsent = Number(summary.absent_count || 0);
  res.json({
    success: true,
    data: {
      months,
      list: rowList,
      summary: {
        total: sTotal,
        absent: sAbsent,
        attendance_rate: attendanceRate(sTotal, sAbsent)
      }
    }
  });
});

/** 缺勤预警：低出勤率 + 连续缺勤（教师仅本班） */
router.get("/warnings", auth, (req, res) => {
  const { class_id, rate = 0.8, consecutive = 3, days = 14 } = req.query;
  const threshold = Number(rate) || 0.8;
  const consec = Number(consecutive) || 3;
  const rangeDays = Number(days) || 14;
  const scope = classScopeClause(req);

  const end = new Date();
  const start = new Date(end.getTime() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  const fmt = d =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startStr = fmt(start);
  const endStr = fmt(end);

  const cond = [];
  const params = [];
  if (class_id) {
    cond.push("s.class_id = ?");
    params.push(Number(class_id));
  }
  const where = cond.length ? `AND ${cond.join(" AND ")}` : "";

  // 1) 低出勤率
  const lowRateList = db
    .prepare(
      `SELECT s.id, s.student_no, s.name, c.name AS class_name,
         COUNT(a.id) AS total,
         SUM(CASE WHEN a.status = '缺勤' THEN 1 ELSE 0 END) AS absent_count,
         SUM(CASE WHEN a.status = '迟到' OR a.status = '早退' THEN 1 ELSE 0 END) AS late_early_count
       FROM students s
       JOIN classes c ON s.class_id = c.id
       LEFT JOIN attendances a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
       WHERE s.status = '在读' ${where}${scope.clause}
       GROUP BY s.id
       HAVING COUNT(a.id) > 0`
    )
    .all(startStr, endStr, ...params, ...scope.params)
    .map(r => {
      const total = Number(r.total || 0);
      const absent = Number(r.absent_count || 0);
      const rateVal = attendanceRate(total, absent);
      return {
        ...r,
        total,
        absent_count: absent,
        late_early_count: Number(r.late_early_count || 0),
        attendance_rate: rateVal
      };
    })
    .filter(r => r.attendance_rate < threshold * 100);

  // 2) 连续缺勤
  const absentRows = db
    .prepare(
      `SELECT s.id, s.student_no, s.name, c.name AS class_name, a.date
       FROM students s
       JOIN classes c ON s.class_id = c.id
       LEFT JOIN attendances a ON a.student_id = s.id AND a.status = '缺勤' AND a.date BETWEEN ? AND ?
       WHERE s.status = '在读' ${where}${scope.clause}
       ORDER BY s.id, a.date`
    )
    .all(startStr, endStr, ...params, ...scope.params);

  const byStudent = {};
  for (const row of absentRows) {
    if (!row.date) continue;
    if (!byStudent[row.id]) byStudent[row.id] = { ...row, dates: [] };
    byStudent[row.id].dates.push(row.date);
  }
  const consecutiveList = Object.values(byStudent)
    .map(st => {
      const dates = [...st.dates].sort();
      let maxRun = 0;
      let run = 0;
      for (let i = 0; i < dates.length; i++) {
        const prev = i > 0 ? new Date(dates[i - 1]) : null;
        const cur = new Date(dates[i]);
        const diff = prev ? (cur - prev) / (24 * 60 * 60 * 1000) : 1;
        run = diff === 1 ? run + 1 : 1;
        maxRun = Math.max(maxRun, run);
      }
      return { ...st, max_consecutive_absent: maxRun, dates: st.dates };
    })
    .filter(st => st.max_consecutive_absent >= consec);

  res.json({
    success: true,
    data: {
      range: { start: startStr, end: endStr, days: rangeDays },
      low_rate: lowRateList,
      consecutive_absent: consecutiveList
    }
  });
});

module.exports = router;
