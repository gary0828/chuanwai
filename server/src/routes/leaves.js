// 请假管理：申请、审批
// 数据权限：教师仅可见/管理自己班级学生的请假；管理员不限
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageStudent } = require("../utils/scope");
const { parseDate } = require("../utils/validate");

const router = express.Router();

/** 教师数据过滤（leaves 表别名 l；学生必须属于教师绑定班级） */
function leaveScopeClause(req) {
  if (req.user.role !== "teacher") return { clause: "", params: [] };
  return {
    clause:
      " AND l.student_id IN (SELECT s.id FROM students s JOIN classes c ON s.class_id = c.id WHERE c.head_teacher_id = ?)",
    params: [req.user.id]
  };
}

/** 请假列表（学生/状态过滤 + 分页；教师仅本班） */
router.get("/", auth, (req, res) => {
  const { student_id, status = "", page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;
  const scope = leaveScopeClause(req);

  let where = "WHERE 1=1";
  const params = [...scope.params];
  if (student_id) {
    where += " AND l.student_id = ?";
    params.push(Number(student_id));
  }
  if (status) {
    where += " AND l.status = ?";
    params.push(status);
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM leaves l ${where}${scope.clause}`)
    .get(...params).c;
  const list = db
    .prepare(
      `SELECT l.*, s.student_no, s.name AS student_name, c.name AS class_name, u.name AS approver_name
       FROM leaves l
       LEFT JOIN students s ON l.student_id = s.id
       LEFT JOIN classes c ON s.class_id = c.id
       LEFT JOIN users u ON l.approved_by = u.id
       ${where}${scope.clause} ORDER BY l.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 新建请假申请（教师仅可为本班学生申请） */
router.post("/", auth, (req, res) => {
  const {
    student_id,
    type,
    reason = "",
    start_date,
    end_date
  } = req.body || {};
  if (!student_id || !type || !start_date || !end_date) {
    return res
      .status(400)
      .json({ success: false, message: "学生、请假类型、起止日期为必填项" });
  }
  if (!["病假", "事假", "其他"].includes(type)) {
    return res.status(400).json({ success: false, message: "请假类型不合法" });
  }
  // 先校日期格式：保证随后的字符串比较（start_date > end_date）在规范的 YYYY-MM-DD 上成立
  const startRes = parseDate(start_date, { field: "开始日期" });
  if (!startRes.ok)
    return res.status(400).json({ success: false, message: startRes.message });
  const endRes = parseDate(end_date, { field: "结束日期" });
  if (!endRes.ok)
    return res.status(400).json({ success: false, message: endRes.message });
  if (startRes.value > endRes.value) {
    return res
      .status(400)
      .json({ success: false, message: "开始日期不能晚于结束日期" });
  }
  if (!canManageStudent(req, student_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权为该学生提交请假" });
  }
  const student = db
    .prepare("SELECT id FROM students WHERE id = ?")
    .get(Number(student_id));
  if (!student) {
    return res.status(400).json({ success: false, message: "学生不存在" });
  }
  const result = db
    .prepare(
      "INSERT INTO leaves (student_id, type, reason, start_date, end_date) VALUES (?, ?, ?, ?, ?)"
    )
    .run(Number(student_id), type, reason, startRes.value, endRes.value);
  res.json({ success: true, data: { id: result.lastInsertRowid } });
});

/** 审批请假（teacher 及以上；教师仅可审批本班学生请假）
 *  v13 联动：审批「通过」→ 回写请假日期范围内已有考勤为「请假」+ 回补课时（原扣过课时）+ 通知绑定家长 */
router.put(
  "/:id/approve",
  auth,
  requireRole("admin", "teacher"),
  (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!["通过", "驳回"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "审批状态仅支持「通过」或「驳回」" });
    }
    const leave = db
      .prepare(
        `SELECT l.id, l.status, l.student_id, l.start_date, l.end_date, l.source, c.head_teacher_id
       FROM leaves l
       JOIN students s ON l.student_id = s.id
       JOIN classes c ON s.class_id = c.id
       WHERE l.id = ?`
      )
      .get(id);
    if (!leave) {
      return res
        .status(404)
        .json({ success: false, message: "请假记录不存在" });
    }
    if (req.user.role === "teacher" && leave.head_teacher_id !== req.user.id) {
      return res
        .status(403)
        .json({ success: false, message: "只能审批本班学生的请假" });
    }
    if (leave.status !== "待审批") {
      return res
        .status(400)
        .json({ success: false, message: "该请假已审批，请勿重复操作" });
    }

    // v13 联动的预置语句
    // 注意（2026-09-12 全面测试发现并修复）：回补查询**不能**带 `remain_hours > 0`。
    // 学员「剩余课时 = 1」时被扣至 0 后申请销假，带该条件会查不到订单 → 课时永久不回补
    // （考勤已改为「请假」但课时不退）。此处与 attendance.js 的 findRefundOrder 口径保持一致。
    const findOrder = db.prepare(
      "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
    );
    const refundOrder = db.prepare(
      "UPDATE orders SET remain_hours = MIN(total_hours, remain_hours + 1), updated_at = datetime('now','localtime') WHERE id = ?"
    );
    const insertCons = db.prepare(
      "INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, hours, type, operator_id) VALUES (?, ?, ?, ?, ?, ?, '回补', ?)"
    );
    const getStudentClass = db.prepare(
      "SELECT class_id FROM students WHERE id = ?"
    );
    const getStudentName = db.prepare("SELECT name FROM students WHERE id = ?");
    const getParentName = db.prepare(
      "SELECT parent_name FROM students WHERE id = ?"
    );
    const insertNotice = db.prepare(
      "INSERT INTO notifications (student_id, type, title, content, date, parent_name) VALUES (?, '请假审批通过', ?, ?, ?, ?)"
    );
    // v13 驳回联动：考勤同步单被驳回 → 覆盖日期内考勤「请假」恢复为「缺勤」
    //   （请假未获准 = 缺勤；缺勤/请假均不扣课时，课时留给补课，口径一致）
    const revertSyncAttendance = db.prepare(
      `UPDATE attendances SET status = '缺勤',
       remark = CASE WHEN remark = '请假审批同步' THEN '请假被驳回' ELSE remark END,
       updated_at = datetime('now','localtime')
     WHERE student_id = ? AND date BETWEEN ? AND ? AND status = '请假'`
    );

    db.exec("BEGIN");
    try {
      // 1. 更新请假状态
      db.prepare(
        "UPDATE leaves SET status = ?, approved_by = ?, approve_time = datetime('now', 'localtime') WHERE id = ?"
      ).run(status, req.user.id, id);

      if (status === "通过") {
        // 2. 回写考勤：请假日期范围内已有考勤（正常/迟到/早退→请假，缺勤/请假不变）
        const affected = db
          .prepare(
            `SELECT student_id, course_id, date FROM attendances
           WHERE student_id = ? AND date BETWEEN ? AND ? AND status IN ('正常', '迟到', '早退')`
          )
          .all(leave.student_id, leave.start_date, leave.end_date);
        const updateAtt = db.prepare(
          "UPDATE attendances SET status = '请假', remark = CASE WHEN remark = '' OR remark IS NULL THEN '请假审批同步' ELSE remark END, updated_at = datetime('now','localtime') WHERE student_id = ? AND course_id = ? AND date = ?"
        );
        for (const a of affected) {
          // 回补课时（原状态正常/迟到/早退已扣过 1 课时，回补 1 并落流水）
          const order = findOrder.get(a.student_id, a.course_id);
          if (order) {
            refundOrder.run(order.id);
            const classId = getStudentClass.get(a.student_id)?.class_id ?? null;
            insertCons.run(
              a.student_id,
              order.id,
              a.course_id,
              classId,
              a.date,
              1,
              req.user.id
            );
          }
          updateAtt.run(a.student_id, a.course_id, a.date);
        }
        // 3. 通知家长（家长姓名快照，仅内部留痕）
        const student = getStudentName.get(leave.student_id);
        const title = "请假审批通过";
        const content = `${student?.name || "学员"} ${leave.start_date}${leave.end_date !== leave.start_date ? ` 至 ${leave.end_date}` : ""} 请假已通过审批`;
        const parentName =
          getParentName.get(leave.student_id)?.parent_name || "";
        insertNotice.run(
          leave.student_id,
          title,
          content,
          leave.start_date,
          parentName
        );
      } else {
        // 驳回：回滚覆盖日期内考勤「请假」→「缺勤」（请假未获准 = 缺勤），与考勤↔请假状态保持一致
        // 课时不重复扣减：缺勤/请假均不扣课时（课时留给补课），口径一致
        revertSyncAttendance.run(
          leave.student_id,
          leave.start_date,
          leave.end_date
        );
      }
      db.exec("COMMIT");
      res.json({ success: true, data: null });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
);

module.exports = router;
