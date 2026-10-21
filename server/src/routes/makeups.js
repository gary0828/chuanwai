// 补课管理：为缺勤/请假学员登记补课，状态流转「待安排 → 已完成」
// 标记完成时事务内联动扣减课时包（写 hour_consumptions 流水），撤销时回补，幂等由状态机保证
// 数据权限：teacher 仅「班主任 OR 任课教师」班级（G2，utils/scope.js 唯一口径）；admin 全量
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const {
  canManageClass,
  canManageStudent,
  classScopeClause,
  isStudentDeleted
} = require("../utils/scope");
const { audit } = require("../utils/audit");
const {
  SOURCE,
  charge,
  refund,
  sessionHoursForMakeup,
  DEFAULT_HOURS
} = require("../utils/hours-reconcile");
// ★ 统一分页钳制（2026-10-18 深度测试 P2-4）
const { clampPagination } = require("../utils/pagination");

const router = express.Router();

/**
 * 补课关联的「原课次」id（P0-2，2026-10-18）。
 *
 * 背景：补课扣减写流水时 `session_id` 一直是 NULL。而 `PUT /api/sessions/:id/hours`
 * 的护栏只查 `hour_consumptions.session_id` —— 于是「补课扣 2 课时后仍能把课次改成 1」
 * 再撤销补课只回 1，学员净损课时且无提示。现在补课流水挂到**原缺课课次**上，
 * 让护栏与对账都能看见这笔流水。
 */
function originalSessionIdOf(db, mk) {
  if (!mk?.course_id) return null;
  const row = db
    .prepare(
      `SELECT session_id FROM attendances
       WHERE student_id = ? AND course_id = ? AND date = ? AND session_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(mk.student_id, mk.course_id, mk.original_date);
  return row?.session_id ?? null;
}

/**
 * 撤销补课/删除补课时的回补课时数（P0-2）。
 *
 * ★ 必须按「当初扣减的流水 hours」回补，而不是按当前课次 hours 重算 ——
 *   否则补课期间课次课时数被改过（或重建）就会多退/少退。
 *   找不到流水（例如历史数据或课次 hours 从未变过）才回退到按原课次解析。
 */
function makeupRefundHours(db, mk) {
  if (!mk?.course_id) return DEFAULT_HOURS;
  const flow = db
    .prepare(
      `SELECT hours FROM hour_consumptions
       WHERE student_id = ? AND course_id = ? AND date = ? AND source = ? AND type = '扣减'
       ORDER BY id DESC LIMIT 1`
    )
    .get(mk.student_id, mk.course_id, mk.makeup_date, SOURCE.MAKEUP);
  const h = Number(flow?.hours);
  if (Number.isFinite(h) && h > 0) return h;
  return sessionHoursForMakeup(db, {
    studentId: mk.student_id,
    courseId: mk.course_id,
    originalDate: mk.original_date
  });
}

/** 补课列表（分页 + 状态/学员/日期筛选；teacher 仅本班） */
router.get("/", auth, (req, res) => {
  const { status, student_id, date_start, date_end, class_id } = req.query;
  const { pageSize: ps, offset } = clampPagination(req.query);
  // ★ G2：scope 统一用 classScopeClause（班主任 OR 任课教师）；列表/计数都 JOIN classes c
  const scope = classScopeClause(req);

  // 参数顺序与 SQL `${where}${scope.clause}` 一致：过滤参数在前、scope.params 在末尾
  let where = "WHERE 1=1";
  const params = [];
  if (status) {
    where += " AND m.status = ?";
    params.push(status);
  }
  if (student_id) {
    where += " AND m.student_id = ?";
    params.push(Number(student_id));
  }
  if (class_id) {
    where += " AND m.class_id = ?";
    params.push(Number(class_id));
  }
  if (date_start) {
    where += " AND m.makeup_date >= ?";
    params.push(date_start);
  }
  if (date_end) {
    where += " AND m.makeup_date <= ?";
    params.push(date_end);
  }

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM makeup_classes m
       JOIN classes c ON c.id = m.class_id
       ${where}${scope.clause}`
    )
    .get(...params, ...scope.params).c;
  const list = db
    .prepare(
      `SELECT m.id, m.student_id, s.student_no, s.name AS student_name, m.class_id, c.name AS class_name,
              m.course_id, co.name AS course_name, m.original_date, m.makeup_date, m.status, m.remark,
              m.apply_user_id, u.name AS apply_user_name, m.created_at, m.updated_at
       FROM makeup_classes m
       JOIN students s ON m.student_id = s.id
       JOIN classes c ON m.class_id = c.id
       LEFT JOIN courses co ON m.course_id = co.id
       LEFT JOIN users u ON m.apply_user_id = u.id
       ${where}${scope.clause}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ...scope.params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 登记补课（admin / teacher 本班；校验学员属于班级） */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const {
    student_id,
    class_id,
    course_id,
    original_date,
    makeup_date,
    remark
  } = req.body || {};
  if (!student_id || !class_id || !original_date || !makeup_date) {
    return res.status(400).json({
      success: false,
      message: "学员、班级、原始日期、补课日期为必填项"
    });
  }
  const stu = db
    .prepare("SELECT id, class_id FROM students WHERE id = ?")
    .get(Number(student_id));
  if (!stu)
    return res.status(404).json({ success: false, message: "学员不存在" });
  // ★ P1-1（v30 软删联动，2026-10-18）：已归档学员不得再产生新的业务数据。
  //   放在权限判断之前，保证 teacher 也拿到明确的 400（而不是笼统 403 / 静默成功）。
  if (isStudentDeleted(student_id)) {
    return res.status(400).json({
      success: false,
      message: "该学员档案已删除，请先恢复后再登记补课"
    });
  }
  if (!canManageClass(req, class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权为该班级登记补课" });
  }
  if (!canManageStudent(req, student_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权为该学员登记补课" });
  }
  if (Number(stu.class_id) !== Number(class_id)) {
    return res
      .status(400)
      .json({ success: false, message: "学员不属于该班级" });
  }
  if (original_date > makeup_date) {
    return res
      .status(400)
      .json({ success: false, message: "补课日期不能早于原始日期" });
  }
  const info = db
    .prepare(
      `INSERT INTO makeup_classes (student_id, class_id, course_id, original_date, makeup_date, remark, apply_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(student_id),
      Number(class_id),
      course_id ? Number(course_id) : null,
      original_date,
      makeup_date,
      remark || "",
      req.user.id
    );
  audit(req.user, "登记补课", `补课#${info.lastInsertRowid}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 补课状态流转：已完成 → 联动扣减课时包；待安排（撤销完成）→ 回补课时包
 *  幂等：仅状态切换瞬间触发扣减/回补，重复提交同一状态不重复操作 */
router.put("/:id/status", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["待安排", "已完成"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "补课状态仅支持「待安排」或「已完成」"
    });
  }
  const mk = db.prepare("SELECT * FROM makeup_classes WHERE id = ?").get(id);
  if (!mk)
    return res.status(404).json({ success: false, message: "补课记录不存在" });
  if (!canManageClass(req, mk.class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权操作该补课记录" });
  }
  // ★ P1-1（v30 软删联动）：已归档学员不再产生课时扣减/回补流水
  if (isStudentDeleted(mk.student_id)) {
    return res.status(400).json({
      success: false,
      message: "该学员档案已删除，请先恢复后再操作补课"
    });
  }
  if (mk.status === status) {
    return res.status(400).json({
      success: false,
      message: `补课已是「${status}」状态，无需重复操作`
    });
  }

  // 匹配「在读 + 同一课程 + 设置了课时包」的订单做联动扣减/回补（与考勤口径一致）
  // v13：扣减优先选择剩余课时最多的订单（余额为 0 跳过）；回补不限制余额（余额为 0 也能恢复）
  // ★ 2026-10-18：记账动作收口到 hours-reconcile 的 charge()/refund()，这里只留"找哪张订单"
  const findDeductOrder = db.prepare(
    "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 AND remain_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
  );
  const findRefundOrder = db.prepare(
    "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
  );
  const getCourse = db.prepare("SELECT id FROM courses WHERE id = ?");

  // v30：补的是「原来缺的那节课」，课时数随原课次（取不到则回退默认值）
  const mkHours = sessionHoursForMakeup(db, {
    studentId: mk.student_id,
    courseId: mk.course_id,
    originalDate: mk.original_date
  });
  // ★ P0-2：补课流水挂原课次（护栏可见）+ 撤销时按当初扣减额回补
  const origSessionId = originalSessionIdOf(db, mk);
  const refundHours = makeupRefundHours(db, mk);

  db.exec("BEGIN");
  try {
    const toComplete = status === "已完成";
    // 待安排 → 已完成：扣课时 + 流水（缺勤/请假日本未扣，补课完成补扣一次）
    // 已完成 → 待安排：回补同等课时 + 流水（撤销补课，恢复课时）
    if (mk.course_id && getCourse.get(mk.course_id)) {
      const order = (toComplete ? findDeductOrder : findRefundOrder).get(
        mk.student_id,
        mk.course_id
      );
      if (order) {
        const payload = {
          orderId: order.id,
          studentId: mk.student_id,
          courseId: mk.course_id,
          classId: mk.class_id,
          date: mk.makeup_date,
          sessionId: origSessionId,
          hours: toComplete ? mkHours : refundHours,
          source: SOURCE.MAKEUP,
          attendanceId: null,
          operatorId: req.user.id
        };
        if (toComplete) charge(db, payload);
        else refund(db, payload);
      }
    }
    db.prepare(
      "UPDATE makeup_classes SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(status, id);
    db.exec("COMMIT");
    audit(
      req.user,
      status === "已完成" ? "完成补课" : "撤销补课完成",
      `补课#${id}`
    );
    res.json({ success: true, data: null });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

/** 删除补课记录（admin 或本班 teacher）
 *  v13：若该补课已「已完成」（已扣课时），先回补课时 + 流水再删除，避免课时被多扣 */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const mk = db.prepare("SELECT * FROM makeup_classes WHERE id = ?").get(id);
  if (!mk)
    return res.status(404).json({ success: false, message: "补课记录不存在" });
  if (!canManageClass(req, mk.class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权删除该补课记录" });
  }
  let refunded = false;
  if (mk.status === "已完成" && mk.course_id) {
    // 已完成：撤销扣减（与「已完成 → 待安排」回补逻辑一致）
    // ★ P0-2：课时数取「当初扣减的流水 hours」（makeupRefundHours），流水挂原课次
    const findRefundOrder = db.prepare(
      "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
    );
    const refundHours = makeupRefundHours(db, mk);
    const origSessionId = originalSessionIdOf(db, mk);
    db.exec("BEGIN");
    try {
      const order = findRefundOrder.get(mk.student_id, mk.course_id);
      if (order) {
        refund(db, {
          orderId: order.id,
          studentId: mk.student_id,
          courseId: mk.course_id,
          classId: mk.class_id,
          date: mk.makeup_date,
          sessionId: origSessionId,
          hours: refundHours,
          source: SOURCE.MAKEUP,
          attendanceId: null,
          operatorId: req.user.id
        });
        refunded = true;
      }
      db.prepare("DELETE FROM makeup_classes WHERE id = ?").run(id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } else {
    db.prepare("DELETE FROM makeup_classes WHERE id = ?").run(id);
  }
  audit(
    req.user,
    "删除补课记录",
    `补课#${id}${refunded ? "（已回补课时）" : ""}`
  );
  res.json({ success: true, data: null });
});

module.exports = router;
