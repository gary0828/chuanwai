// 补课管理：为缺勤/请假学员登记补课，状态流转「待安排 → 已完成」
// 标记完成时事务内联动扣减课时包（写 hour_consumptions 流水），撤销时回补，幂等由状态机保证
// 数据权限：teacher 仅本班；admin 全量
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageClass, canManageStudent } = require("../utils/scope");
const { audit } = require("../utils/audit");

const router = express.Router();

/** 补课列表（分页 + 状态/学员/日期筛选；teacher 仅本班） */
router.get("/", auth, (req, res) => {
  const { status, student_id, date_start, date_end, class_id, page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  if (req.user.role === "teacher") {
    where += " AND m.class_id IN (SELECT id FROM classes WHERE head_teacher_id = ?)";
    params.push(req.user.id);
  }
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
    .prepare(`SELECT COUNT(*) AS c FROM makeup_classes m ${where}`)
    .get(...params).c;
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
       ${where}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 登记补课（admin / teacher 本班；校验学员属于班级） */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { student_id, class_id, course_id, original_date, makeup_date, remark } = req.body || {};
  if (!student_id || !class_id || !original_date || !makeup_date) {
    return res.status(400).json({ success: false, message: "学员、班级、原始日期、补课日期为必填项" });
  }
  if (!canManageClass(req, class_id)) {
    return res.status(403).json({ success: false, message: "无权为该班级登记补课" });
  }
  if (!canManageStudent(req, student_id)) {
    return res.status(403).json({ success: false, message: "无权为该学员登记补课" });
  }
  const stu = db.prepare("SELECT id, class_id FROM students WHERE id = ?").get(Number(student_id));
  if (!stu) return res.status(404).json({ success: false, message: "学员不存在" });
  if (Number(stu.class_id) !== Number(class_id)) {
    return res.status(400).json({ success: false, message: "学员不属于该班级" });
  }
  if (original_date > makeup_date) {
    return res.status(400).json({ success: false, message: "补课日期不能早于原始日期" });
  }
  const info = db
    .prepare(
      `INSERT INTO makeup_classes (student_id, class_id, course_id, original_date, makeup_date, remark, apply_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(Number(student_id), Number(class_id), course_id ? Number(course_id) : null, original_date, makeup_date, remark || "", req.user.id);
  audit(req.user, "登记补课", `补课#${info.lastInsertRowid}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 补课状态流转：已完成 → 联动扣减课时包；待安排（撤销完成）→ 回补课时包
 *  幂等：仅状态切换瞬间触发扣减/回补，重复提交同一状态不重复操作 */
router.put("/:id/status", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["待安排", "已完成"].includes(status)) {
    return res.status(400).json({ success: false, message: "补课状态仅支持「待安排」或「已完成」" });
  }
  const mk = db.prepare("SELECT * FROM makeup_classes WHERE id = ?").get(id);
  if (!mk) return res.status(404).json({ success: false, message: "补课记录不存在" });
  if (!canManageClass(req, mk.class_id)) {
    return res.status(403).json({ success: false, message: "无权操作该补课记录" });
  }
  if (mk.status === status) {
    return res.status(400).json({ success: false, message: `补课已是「${status}」状态，无需重复操作` });
  }

  // 匹配「在读 + 同一课程 + 设置了课时包」的订单做联动扣减/回补（与考勤口径一致）
  // v13：扣减优先选择剩余课时最多的订单（余额为 0 跳过）；回补不限制余额（余额为 0 也能恢复）
  const findDeductOrder = db.prepare(
    "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 AND remain_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
  );
  const findRefundOrder = db.prepare(
    "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
  );
  const deductOrder = db.prepare(
    "UPDATE orders SET remain_hours = MAX(0, remain_hours - 1), updated_at = datetime('now','localtime') WHERE id = ?"
  );
  const refundOrder = db.prepare(
    "UPDATE orders SET remain_hours = MIN(total_hours, remain_hours + 1), updated_at = datetime('now','localtime') WHERE id = ?"
  );
  const insertCons = db.prepare(
    "INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, hours, type, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const getCourse = db.prepare("SELECT id FROM courses WHERE id = ?");

  db.exec("BEGIN");
  try {
    const toComplete = status === "已完成";
    // 待安排 → 已完成：扣 1 课时 + 流水（缺勤/请假日本未扣，补课完成补扣一次）
    // 已完成 → 待安排：回补 1 课时 + 流水（撤销补课，恢复课时）
    if (mk.course_id && getCourse.get(mk.course_id)) {
      const order = (toComplete ? findDeductOrder : findRefundOrder).get(mk.student_id, mk.course_id);
      if (order) {
        if (toComplete) {
          deductOrder.run(order.id);
          insertCons.run(mk.student_id, order.id, mk.course_id, mk.class_id, mk.makeup_date, 1, "扣减", req.user.id);
        } else {
          refundOrder.run(order.id);
          insertCons.run(mk.student_id, order.id, mk.course_id, mk.class_id, mk.makeup_date, 1, "回补", req.user.id);
        }
      }
    }
    db.prepare(
      "UPDATE makeup_classes SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(status, id);
    db.exec("COMMIT");
    audit(req.user, status === "已完成" ? "完成补课" : "撤销补课完成", `补课#${id}`);
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
  if (!mk) return res.status(404).json({ success: false, message: "补课记录不存在" });
  if (!canManageClass(req, mk.class_id)) {
    return res.status(403).json({ success: false, message: "无权删除该补课记录" });
  }
  let refunded = false;
  if (mk.status === "已完成" && mk.course_id) {
    // 已完成：撤销扣减（与「已完成 → 待安排」回补逻辑一致）
    const findRefundOrder = db.prepare(
      "SELECT id FROM orders WHERE student_id = ? AND course_id = ? AND status = '在读' AND total_hours > 0 ORDER BY remain_hours DESC, id LIMIT 1"
    );
    const refundOrder = db.prepare(
      "UPDATE orders SET remain_hours = MIN(total_hours, remain_hours + 1), updated_at = datetime('now','localtime') WHERE id = ?"
    );
    const insertCons = db.prepare(
      "INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, hours, type, operator_id) VALUES (?, ?, ?, ?, ?, ?, '回补', ?)"
    );
    db.exec("BEGIN");
    try {
      const order = findRefundOrder.get(mk.student_id, mk.course_id);
      if (order) {
        refundOrder.run(order.id);
        insertCons.run(mk.student_id, order.id, mk.course_id, mk.class_id, mk.makeup_date, 1, req.user.id);
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
  audit(req.user, "删除补课记录", `补课#${id}${refunded ? "（已回补课时）" : ""}`);
  res.json({ success: true, data: null });
});

module.exports = router;
