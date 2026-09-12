// 考勤：名单、批量提交、记录查询、统计（学生/班级）、周月趋势、缺勤预警
// 数据权限：教师仅可操作/统计自己绑定班级的考勤；管理员不限
const express = require("express");
const db = require("../db");
const { auth } = require("../middleware/auth");
const { canManageClass, canManageStudent } = require("../utils/scope");

const router = express.Router();

const STATUSES = ["正常", "迟到", "早退", "缺勤", "请假"];

/** 教师数据过滤（classes 别名 c） */
function classScopeClause(req) {
  if (req.user.role !== "teacher") return { clause: "", params: [] };
  return { clause: " AND c.head_teacher_id = ?", params: [req.user.id] };
}

/** 某课程某日全班考勤名单（教师仅限本班） */
router.get("/", auth, (req, res) => {
  const { date, class_id, course_id } = req.query;
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
  const { date, course_id, records } = req.body || {};
  if (!date || !course_id || !Array.isArray(records) || records.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "请先选择日期、课程并填写考勤记录" });
  }
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

  const insert = db.prepare(
    `INSERT INTO attendances (student_id, course_id, date, status, remark)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(student_id, course_id, date)
     DO UPDATE SET status = excluded.status, remark = excluded.remark, updated_at = datetime('now', 'localtime')`
  );
  const getOld = db.prepare(
    "SELECT status FROM attendances WHERE student_id = ? AND course_id = ? AND date = ?"
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
  // 课时消耗流水：扣减/回补后落流水（date 为考勤日期，供课消统计与收入确认）
  const insertCons = db.prepare(
    "INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, hours, type, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const getStudentClass = db.prepare(
    "SELECT class_id FROM students WHERE id = ?"
  );
  const DEDUCT_STATUSES = ["正常", "迟到", "早退"];
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
      const oldRow = getOld.get(Number(r.student_id), Number(course_id), date);
      const oldStatus = oldRow?.status;
      insert.run(
        Number(r.student_id),
        Number(course_id),
        date,
        r.status,
        r.remark || ""
      );
      if (oldStatus !== r.status) {
        const order = (
          isDeduct(r.status) ? findDeductOrder : findRefundOrder
        ).get(Number(r.student_id), Number(course_id));
        if (order) {
          const oldDeduct = oldStatus ? isDeduct(oldStatus) : false;
          const newDeduct = isDeduct(r.status);
          const classId =
            getStudentClass.get(Number(r.student_id))?.class_id ?? null;
          if (!oldDeduct && newDeduct) {
            deductOrder.run(order.id);
            insertCons.run(
              Number(r.student_id),
              order.id,
              Number(course_id),
              classId,
              date,
              1,
              "扣减",
              req.user.id
            );
          } else if (oldDeduct && !newDeduct) {
            refundOrder.run(order.id);
            insertCons.run(
              Number(r.student_id),
              order.id,
              Number(course_id),
              classId,
              date,
              1,
              "回补",
              req.user.id
            );
          }
        }
        // 缺勤通知联动
        if (r.status === "缺勤") {
          if (hasAbsentNotice.get(Number(r.student_id), date).c === 0) {
            const student = getStudentName.get(Number(r.student_id));
            const course = getCourseName.get(Number(course_id));
            const title = "考勤缺勤提醒";
            const content = `${student?.name || "学员"} ${date} ${course?.name || "课程"} 缺勤，请家长关注`;
            const parentName =
              getParentName.get(Number(r.student_id))?.parent_name || "";
            insertNotice.run(
              Number(r.student_id),
              title,
              content,
              date,
              parentName
            );
          }
        } else if (oldStatus === "缺勤") {
          deleteAbsentNotice.run(Number(r.student_id), date);
        }
        // v13 考勤↔请假联动（G11）：标记"请假"→ 生成待审批考勤同步请假单（幂等：覆盖任意来源的待审批/通过单则不重复）；
        //        改回其他状态 → 撤销当日同步单（待审批/已通过一并删除）+ 撤销"请假审批通过"通知
        if (r.status === "请假") {
          if (!hasSyncLeave.get(Number(r.student_id), date, date)) {
            insertSyncLeave.run(Number(r.student_id), date, date);
          }
        } else if (oldStatus === "请假") {
          deleteSyncLeave.run(Number(r.student_id), date, date);
          deleteLeaveApprovedNotice.run(Number(r.student_id), date, date);
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
    where += " AND c.head_teacher_id = ?";
    params.push(req.user.id);
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
      ? " AND a.student_id IN (SELECT s.id FROM students s JOIN classes c ON s.class_id = c.id WHERE c.head_teacher_id = ?)"
      : "";
  const summaryParams =
    req.user.role === "teacher" ? [req.user.id, ...params] : [...params];
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
      attendance_rate:
        total > 0 ? Number((((total - absent) / total) * 100).toFixed(1)) : 0
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
      attendance_rate:
        total > 0 ? Number((((total - absent) / total) * 100).toFixed(1)) : 0
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
      ? " AND a.student_id IN (SELECT s.id FROM students s JOIN classes c ON s.class_id = c.id WHERE c.head_teacher_id = ?)"
      : "";
  const summaryParams =
    req.user.role === "teacher" ? [req.user.id, ...params] : [...params];
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
      attendance_rate:
        total > 0 ? Number((((total - absent) / total) * 100).toFixed(1)) : 0
    };
    c.total += total;
    c.absent += absent;
  }
  const rowList = [...byClass.values()].map(c => ({
    ...c,
    attendance_rate:
      c.total > 0
        ? Number((((c.total - c.absent) / c.total) * 100).toFixed(1))
        : 0
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
        attendance_rate:
          sTotal > 0
            ? Number((((sTotal - sAbsent) / sTotal) * 100).toFixed(1))
            : 0
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
      const rateVal = Number((((total - absent) / total) * 100).toFixed(1));
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
