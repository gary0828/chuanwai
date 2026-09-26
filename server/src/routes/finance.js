// 财务管理：报班订单 / 收费记录 / 退费记录 / 财务统计
// 权限（2026-09-12 权限收紧）：全部接口仅 admin。
//   此前订单/缴费/退费/营收/欠费/课消统计对 teacher 开放（本班范围内），
//   按「教师仅保留授课相关权限、费用与业务运营内容一律不可见」的要求收回。
//   随之移除数据范围过滤（financeScope）与订单归属校验（canManageOrder）：
//   全部接口仅 admin 可达，前者恒返回空串、后者恒为 true，保留只会给 SQL 拼接引入噪声。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageStudent } = require("../utils/scope");
const { audit } = require("../utils/audit");
const { parseDate, parseDateTime } = require("../utils/validate");
const { scanReferences, describeImpacts } = require("../utils/delete-guard");

const { paidNetSql, REFUND_TIME_SQL } = require("../utils/money");

const router = express.Router();


// ── 金额 / 课时边界校验（上线门禁 B4）────────────────────────────────
// 此前金额仅做 Number() 转换、课时完全无校验，可写入负数或超大值污染财务。
const MAX_AMOUNT = 10000000; // 单笔金额上限 1000 万元
const MAX_HOURS = 100000; // 单订单课时上限
const toNullableNumber = v => (v === undefined || v === null || v === "") ? null : v;

/**
 * 校验金额
 * @param value 原始入参（空值按 0 处理）
 * @param options.allowZero 是否允许 0（报班订单可赠课；缴费/退费不允许）
 * @param options.field 错误提示中的字段名
 */
function parseAmount(value, { allowZero = false, field = "金额" } = {}) {
  const raw = toNullableNumber(value);
  if (raw !== null && (typeof raw === "boolean" || typeof raw === "object")) {
    return { ok: false, message: `${field}必须是数字` };
  }
  const n = raw === null ? 0 : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, message: `${field}必须是数字` };
  }
  if (allowZero ? n < 0 : n <= 0) {
    return {
      ok: false,
      message: `${field}${allowZero ? "不能为负数" : "必须大于 0"}`
    };
  }
  if (n > MAX_AMOUNT) {
    return { ok: false, message: `${field}不能超过 ${MAX_AMOUNT} 元` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 }; // 金额保留 2 位小数
}

/** 校验课时：非负整数且不超过上限（空值按 0 处理） */
function parseHours(value, { field = "课时" } = {}) {
  const raw = toNullableNumber(value);
  const n = raw === null ? 0 : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, message: `${field}必须是整数` };
  }
  if (n < 0) {
    return { ok: false, message: `${field}不能为负数` };
  }
  if (n > MAX_HOURS) {
    return { ok: false, message: `${field}不能超过 ${MAX_HOURS}` };
  }
  return { ok: true, value: n };
}

// ==================== 报班订单 ====================

/** 订单列表（分页 + 筛选：状态/关键字/班级/低课时） */
router.get("/orders", auth, requireRole("admin"), (req, res) => {
  const { status, keyword, class_id, low_hours, page = 1, pageSize = 10 } = req.query;
  const conds = [];
  const params = [];
  if (status) { conds.push("o.status = ?"); params.push(status); }
  if (keyword) { conds.push("(s.name LIKE ? OR s.student_no LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  if (class_id) { conds.push("o.class_id = ?"); params.push(Number(class_id)); }
  if (low_hours) { conds.push("o.status = '在读' AND o.total_hours > 0 AND o.remain_hours <= ?"); params.push(Number(low_hours)); }
  const where = conds.length ? conds.join(" AND ") : "1=1";
  const allParams = params;

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM orders o JOIN students s ON s.id = o.student_id WHERE ${where}`)
    .get(...allParams).c;
  const list = db.prepare(`
    SELECT o.id, o.student_id, s.student_no, s.name AS student_name, s.class_id,
           c.name AS class_name, cu.name AS course_name,
           o.enroll_date, o.amount, o.total_hours, o.remain_hours,
           o.status, o.remark, o.created_at,
           u.name AS enroll_user_name,
           ${paidNetSql("o.id")} AS paid
    FROM orders o
    JOIN students s ON s.id = o.student_id
    LEFT JOIN classes c ON c.id = o.class_id
    LEFT JOIN courses cu ON cu.id = o.course_id
    LEFT JOIN users u ON u.id = o.enroll_user_id
    WHERE ${where}
    ORDER BY o.id DESC
    LIMIT ? OFFSET ?
  `).all(...allParams, Number(pageSize), (Number(page) - 1) * Number(pageSize));

  res.json({ success: true, data: { list, total } });
});

/** 订单详情（含缴费明细与退费记录） */
router.get("/orders/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT o.*, s.student_no, s.name AS student_name, s.phone,
           c.name AS class_name, cu.name AS course_name, u.name AS enroll_user_name
    FROM orders o
    JOIN students s ON s.id = o.student_id
    LEFT JOIN classes c ON c.id = o.class_id
    LEFT JOIN courses cu ON cu.id = o.course_id
    LEFT JOIN users u ON u.id = o.enroll_user_id
    WHERE o.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ success: false, message: "订单不存在" });
  if (!canManageStudent(req, row.student_id)) {
    return res.status(403).json({ success: false, message: "无权查看该订单" });
  }
  const payments = db.prepare(`
    SELECT p.*, u.name AS pay_user_name
    FROM payments p LEFT JOIN users u ON u.id = p.pay_user_id
    WHERE p.order_id = ? ORDER BY p.pay_time DESC
  `).all(id);
  const refunds = db.prepare(`
    SELECT r.*, u1.name AS apply_user_name, u2.name AS approved_name
    FROM refunds r
    LEFT JOIN users u1 ON u1.id = r.apply_user_id
    LEFT JOIN users u2 ON u2.id = r.approved_by
    WHERE r.order_id = ? ORDER BY r.apply_time DESC
  `).all(id);
  res.json({ success: true, data: { ...row, payments, refunds } });
});

/** 新增订单（学员报班） */
router.post("/orders", auth, requireRole("admin"), (req, res) => {
  const { student_id, class_id, course_id, enroll_date, amount, total_hours, remark } = req.body;
  if (!student_id) return res.status(400).json({ success: false, message: "请选择学员" });
  // ★ 2026-09-26 课程改为必填：考勤自动扣课时依赖订单的 course_id 精确匹配
  //   （见 attendance.js 的 findDeductOrder：student_id + course_id + status='在读'）。
  //   此前 course_id 可空 → 不选课程建出的订单**永远不会扣课时**，
  //   而界面没有任何提示 → 用户以为在扣、实际课时只增不减。
  if (!course_id) {
    return res.status(400).json({
      success: false,
      message: "请选择课程（考勤按「学员 + 课程」匹配订单来扣课时，不选课程将无法自动扣课时）"
    });
  }
  if (!canManageStudent(req, student_id)) {
    return res.status(403).json({ success: false, message: "无权为该学员报班" });
  }
  // B4：金额与课时的边界校验
  const amountRes = parseAmount(amount, { allowZero: true, field: "订单金额" });
  if (!amountRes.ok) return res.status(400).json({ success: false, message: amountRes.message });
  const hoursRes = parseHours(total_hours, { field: "课时包总课时" });
  if (!hoursRes.ok) return res.status(400).json({ success: false, message: hoursRes.message });
  const hours = hoursRes.value;
  // 报班日期：提供时必须是真实存在的 YYYY-MM-DD（未提供则取当天）
  let enrollDate = new Date().toLocaleDateString("sv");
  if (enroll_date !== undefined && enroll_date !== null && enroll_date !== "") {
    const dRes = parseDate(enroll_date, { field: "报班日期" });
    if (!dRes.ok) return res.status(400).json({ success: false, message: dRes.message });
    enrollDate = dRes.value;
  }
  const info = db.prepare(`
    INSERT INTO orders (student_id, class_id, course_id, enroll_date, amount, total_hours, remain_hours, status, enroll_user_id, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, '在读', ?, ?)
  `).run(
    Number(student_id),
    class_id ? Number(class_id) : null,
    course_id ? Number(course_id) : null,
    enrollDate,
    amountRes.value,
    hours,
    hours,
    req.user.id,
    remark || ""
  );
  audit(req.user, "新增报班订单", `订单#${info.lastInsertRowid} 学员ID=${student_id}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 变更订单状态（结业 / 退班） */
router.put("/orders/:id/status", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!["在读", "结业", "退班"].includes(status)) {
    return res.status(400).json({ success: false, message: "无效的订单状态" });
  }
  const info = db.prepare(`
    UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `).run(status, id);
  if (info.changes === 0) return res.status(404).json({ success: false, message: "订单不存在" });
  audit(req.user, "变更订单状态", `订单#${id} → ${status}`);
  res.json({ success: true, data: null });
});

/** 修改订单信息（班级/课程/金额/课时/备注；未传字段保留原值）
 *  v13：校验 remain_hours <= total_hours */
router.put("/orders/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { class_id, course_id, amount, total_hours, remain_hours, remark } = req.body;
  const cur = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!cur) return res.status(404).json({ success: false, message: "订单不存在" });

  // B4：边界校验（未传字段保留原值）
  let nextAmount = Number(cur.amount);
  if (amount !== undefined && amount !== null && amount !== "") {
    const r = parseAmount(amount, { allowZero: true, field: "订单金额" });
    if (!r.ok) return res.status(400).json({ success: false, message: r.message });
    nextAmount = r.value;
  }
  let nextTotal = Number(cur.total_hours);
  if (total_hours !== undefined && total_hours !== null && total_hours !== "") {
    const r = parseHours(total_hours, { field: "课时包总课时" });
    if (!r.ok) return res.status(400).json({ success: false, message: r.message });
    nextTotal = r.value;
  }
  let nextRemain = Number(cur.remain_hours);
  if (remain_hours !== undefined && remain_hours !== null && remain_hours !== "") {
    const r = parseHours(remain_hours, { field: "剩余课时" });
    if (!r.ok) return res.status(400).json({ success: false, message: r.message });
    nextRemain = r.value;
  }
  if (nextRemain > nextTotal) {
    return res.status(400).json({ success: false, message: `剩余课时不能大于总课时（${nextTotal}）` });
  }

  // B4：手工调整剩余课时必须留流水，保证 orders.remain_hours 与 hour_consumptions 始终对账
  const prevRemain = Number(cur.remain_hours);
  const manualAdjust = nextRemain !== prevRemain;
  const adjustHours = Math.abs(nextRemain - prevRemain);

  db.exec("BEGIN");
  try {
    const info = db.prepare(`
      UPDATE orders SET
        class_id = COALESCE(?, class_id),
        course_id = COALESCE(?, course_id),
        amount = ?,
        total_hours = ?,
        remain_hours = ?,
        remark = COALESCE(NULLIF(?, ''), remark),
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      class_id != null && class_id !== "" ? Number(class_id) : null,
      course_id != null && course_id !== "" ? Number(course_id) : null,
      nextAmount,
      nextTotal,
      nextRemain,
      remark || "",
      id
    );
    if (info.changes === 0) {
      db.exec("ROLLBACK");
      return res.status(404).json({ success: false, message: "订单不存在" });
    }
    if (manualAdjust) {
      db.prepare(`
        INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, hours, type, operator_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cur.student_id,
        id,
        cur.course_id,
        cur.class_id,
        new Date().toLocaleDateString("sv"),
        adjustHours,
        nextRemain < prevRemain ? "扣减" : "回补",
        req.user.id
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  audit(
    req.user,
    "修改报班订单",
    manualAdjust
      ? `订单#${id}（剩余课时 ${prevRemain} → ${nextRemain}，已记流水 ${adjustHours} 课时）`
      : `订单#${id}`
  );
  res.json({ success: true, data: null });
});

/** 删除订单（v13：存在缴费/退费记录时禁止删除，保护资金历史；仅有课时流水允许级联清理，供测试/清理场景） */
router.delete("/orders/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT id, status FROM orders WHERE id = ?").get(id);
  if (!cur) {
    return res.status(404).json({ success: false, message: "订单不存在" });
  }

  // ★ 2026-09-26 补删除守卫（K-052），并做**分级**处理：
  //
  //   原实现只拦 payments / refunds，**漏了 hour_consumptions（CASCADE）** ——
  //   删掉一张已上过课的订单，它的课消流水会被静默清空，课消收入凭空减少且不可追溯。
  //
  //   但一刀切拒绝会造成死结：**学员上过课 → 订单永远删不掉 → 学员档案也永远删不掉**
  //   （students 的删除保护要求无订单）。所以按订单状态分级：
  //     · **在读**：有课消流水就拒绝 —— 学员还在读，课时账必须完整可追溯；
  //     · **非在读（结业/退班）**：允许删除连同课消流水 —— 学员已离校，
  //       档案需要能被清理（清理动作由 audit 留痕，可追溯"谁在何时删了什么"）。
  const impacts = scanReferences("orders", id);
  if (impacts.length > 0) {
    const hasConsumption = impacts.some(i => i.table === "hour_consumptions");
    if (cur.status === "在读" && hasConsumption) {
      return res.status(400).json({
        success: false,
        message:
          `该订单仍在读且有课时消耗，禁止删除：${describeImpacts(impacts)}。` +
          `如需清理档案，请先把订单置为「结业」或「退班」后再删除。`
      });
    }
    if (!hasConsumption) {
      return res.status(400).json({
        success: false,
        message: `该订单已被以下数据引用，禁止删除：${describeImpacts(impacts)}`
      });
    }
    // 非在读 + 有课消流水 → 允许（连带清理），下面照常删除
  }

  db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  audit(req.user, "删除报班订单", `订单#${id} 状态=${cur.status}`);
  res.json({ success: true, data: null });
});

// ==================== 收费记录 ====================

/** 缴费记录列表（分页 + 筛选：订单/学员关键字/支付方式/时间范围） */
router.get("/payments", auth, requireRole("admin"), (req, res) => {
  const { order_id, keyword, pay_method, start, end, page = 1, pageSize = 10 } = req.query;
  const conds = [];
  const params = [];
  if (order_id) { conds.push("p.order_id = ?"); params.push(Number(order_id)); }
  if (keyword) { conds.push("(s.name LIKE ? OR s.student_no LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  if (pay_method) { conds.push("p.pay_method = ?"); params.push(pay_method); }
  if (start) { conds.push("date(p.pay_time) >= ?"); params.push(start); }
  if (end) { conds.push("date(p.pay_time) <= ?"); params.push(end); }
  const where = conds.length ? conds.join(" AND ") : "1=1";
  const allParams = params;

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM payments p JOIN students s ON s.id = p.student_id WHERE ${where}`)
    .get(...allParams).c;
  const list = db.prepare(`
    SELECT p.id, p.order_id, p.student_id, s.student_no, s.name AS student_name,
           c.name AS class_name, p.amount, p.pay_method, p.pay_time, p.remark,
           u.name AS pay_user_name
    FROM payments p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN users u ON u.id = p.pay_user_id
    WHERE ${where}
    ORDER BY p.pay_time DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...allParams, Number(pageSize), (Number(page) - 1) * Number(pageSize));
  const totalAmount = db
    .prepare(`SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p JOIN students s ON s.id = p.student_id WHERE ${where}`)
    .get(...allParams).total;

  res.json({ success: true, data: { list, total, totalAmount } });
});

/** 新增缴费记录（v13：校验订单属于所选学员，避免跨学员挂账） */
router.post("/payments", auth, requireRole("admin"), (req, res) => {
  const { order_id, student_id, amount, pay_method, pay_time, remark } = req.body;
  if (!order_id || !student_id) {
    return res.status(400).json({ success: false, message: "请选择订单与学员" });
  }
  // B4：金额边界校验（>0 且 ≤ 上限，保留 2 位小数）
  const amtRes = parseAmount(amount, { field: "缴费金额" });
  if (!amtRes.ok) return res.status(400).json({ success: false, message: amtRes.message });
  const amt = amtRes.value;
  if (!canManageStudent(req, student_id)) {
    return res.status(403).json({ success: false, message: "无权为该学员登记缴费" });
  }
  const order = db.prepare("SELECT id FROM orders WHERE id = ? AND student_id = ?").get(Number(order_id), Number(student_id));
  if (!order) {
    return res.status(400).json({ success: false, message: "订单与学员不匹配" });
  }
  // 缴费时间：提供时必须是合法的日期时间（未提供则取当前时间）
  let payTime = null;
  if (pay_time !== undefined && pay_time !== null && pay_time !== "") {
    const tRes = parseDateTime(pay_time, { field: "缴费时间" });
    if (!tRes.ok) return res.status(400).json({ success: false, message: tRes.message });
    payTime = tRes.value;
  }
  const info = db.prepare(`
    INSERT INTO payments (order_id, student_id, amount, pay_method, pay_user_id, pay_time, remark)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), ?)
  `).run(
    Number(order_id),
    Number(student_id),
    amt,
    pay_method || "转账",
    req.user.id,
    payTime,
    remark || ""
  );
  audit(req.user, "登记缴费", `订单#${order_id} ¥${amt}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 修改缴费记录（仅 admin） */
router.put("/payments/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { amount, pay_method, pay_time, remark } = req.body;
  // B4：金额边界校验
  const amtRes = parseAmount(amount, { field: "缴费金额" });
  if (!amtRes.ok) return res.status(400).json({ success: false, message: amtRes.message });
  const amt = amtRes.value;
  // 缴费时间：提供时必须是合法的日期时间（空值保留原值）
  let payTime = "";
  if (pay_time !== undefined && pay_time !== null && pay_time !== "") {
    const tRes = parseDateTime(pay_time, { field: "缴费时间" });
    if (!tRes.ok) return res.status(400).json({ success: false, message: tRes.message });
    payTime = tRes.value;
  }
  const info = db.prepare(`
    UPDATE payments SET amount = ?, pay_method = ?, pay_time = COALESCE(NULLIF(?, ''), pay_time), remark = ? WHERE id = ?
  `).run(amt, pay_method || "转账", payTime, remark || "", id);
  if (info.changes === 0) return res.status(404).json({ success: false, message: "缴费记录不存在" });
  audit(req.user, "修改缴费记录", `缴费#${id}`);
  res.json({ success: true, data: null });
});

/** 删除缴费记录（仅 admin） */
router.delete("/payments/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM payments WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ success: false, message: "缴费记录不存在" });
  audit(req.user, "删除缴费记录", `缴费#${id}`);
  res.json({ success: true, data: null });
});

// ==================== 退费记录 ====================

/** 退费记录列表（分页 + 筛选：状态/关键字） */
router.get("/refunds", auth, requireRole("admin"), (req, res) => {
  const { status, keyword, page = 1, pageSize = 10 } = req.query;
  const conds = [];
  const params = [];
  if (status) { conds.push("r.status = ?"); params.push(status); }
  if (keyword) { conds.push("(s.name LIKE ? OR s.student_no LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  const where = conds.length ? conds.join(" AND ") : "1=1";
  const allParams = params;

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM refunds r JOIN students s ON s.id = r.student_id WHERE ${where}`)
    .get(...allParams).c;
  const list = db.prepare(`
    SELECT r.id, r.order_id, r.student_id, s.student_no, s.name AS student_name,
           c.name AS class_name, r.amount, r.reason, r.status, r.apply_time, r.approve_time, r.remark,
           u1.name AS apply_user_name, u2.name AS approved_name
    FROM refunds r
    JOIN students s ON s.id = r.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN users u1 ON u1.id = r.apply_user_id
    LEFT JOIN users u2 ON u2.id = r.approved_by
    WHERE ${where}
    ORDER BY r.apply_time DESC, r.id DESC
    LIMIT ? OFFSET ?
  `).all(...allParams, Number(pageSize), (Number(page) - 1) * Number(pageSize));

  res.json({ success: true, data: { list, total } });
});

/** 提交退费申请（v13：校验订单属于所选学员） */
router.post("/refunds", auth, requireRole("admin"), (req, res) => {
  const { order_id, student_id, amount, reason, remark } = req.body;
  if (!order_id || !student_id) {
    return res.status(400).json({ success: false, message: "请选择订单与学员" });
  }
  // B4：金额边界校验
  const amtRes = parseAmount(amount, { field: "退费金额" });
  if (!amtRes.ok) return res.status(400).json({ success: false, message: amtRes.message });
  const amt = amtRes.value;
  if (!canManageStudent(req, student_id)) {
    return res.status(403).json({ success: false, message: "无权为该学员提交退费" });
  }
  const order = db.prepare("SELECT id, status FROM orders WHERE id = ? AND student_id = ?").get(Number(order_id), Number(student_id));
  if (!order) {
    return res.status(400).json({ success: false, message: "订单与学员不匹配" });
  }
  if (order.status !== "在读") {
    return res.status(400).json({ success: false, message: "仅在读订单可发起退费" });
  }
  // B4：退费金额不得超过「该订单已缴金额 − 已申请/已通过退费」，防止超额退款
  const paid = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE order_id = ?")
    .get(Number(order_id)).s;
  const refunded = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM refunds WHERE order_id = ? AND status IN ('待审批', '通过')"
    )
    .get(Number(order_id)).s;
  const refundable = Number(paid) - Number(refunded);
  if (amt > refundable) {
    return res.status(400).json({
      success: false,
      message: `退费金额超出可退上限（已缴 ¥${Number(paid).toFixed(2)} − 已退/在途 ¥${Number(refunded).toFixed(2)} = ¥${refundable.toFixed(2)}）`
    });
  }
  const info = db.prepare(`
    INSERT INTO refunds (order_id, student_id, amount, reason, status, apply_user_id, remark)
    VALUES (?, ?, ?, ?, '待审批', ?, ?)
  `).run(Number(order_id), Number(student_id), amt, reason || "", req.user.id, remark || "");
  audit(req.user, "提交退费申请", `订单#${order_id} ¥${amt}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 退费审批（通过/驳回，仅 admin）
 *  v13：审批「通过」→ 关联订单置「退班」（不再参与考勤课时扣减），剩余课时保留供账务核对 */
router.put("/refunds/:id/approve", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!["通过", "驳回"].includes(status)) {
    return res.status(400).json({ success: false, message: "无效的审批状态" });
  }
  const refund = db
    .prepare("SELECT r.id, r.status AS refund_status, r.order_id, o.status AS order_status FROM refunds r LEFT JOIN orders o ON o.id = r.order_id WHERE r.id = ?")
    .get(id);
  if (!refund) return res.status(404).json({ success: false, message: "退费记录不存在" });
  if (refund.refund_status !== "待审批") {
    return res.status(400).json({ success: false, message: "该退费已审批，请勿重复操作" });
  }
  if (status === "通过" && refund.order_status !== "在读") {
    return res.status(400).json({ success: false, message: "关联订单已非在读状态，无法通过退费" });
  }
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE refunds SET status = ?, approved_by = ?,
             approve_time = datetime('now','localtime')
      WHERE id = ?
    `).run(status, req.user.id, id);
    if (status === "通过") {
      // 订单置退班：考勤/补课的扣减查询仅匹配「在读」订单，自动停止从此订单扣课时
      db.prepare("UPDATE orders SET status = '退班', updated_at = datetime('now','localtime') WHERE id = ?")
        .run(refund.order_id);
    }
    db.exec("COMMIT");
    audit(req.user, "审批退费", `退费#${id} → ${status}${status === "通过" ? "（订单置退班）" : ""}`);
    res.json({ success: true, data: null });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

/** 删除退费记录（仅 admin） */
router.delete("/refunds/:id", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM refunds WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ success: false, message: "退费记录不存在" });
  audit(req.user, "删除退费记录", `退费#${id}`);
  res.json({ success: true, data: null });
});

// ==================== 财务统计 ====================

/** 营收统计：按天/按月聚合实收金额（pay_time 为收单时间） */
router.get("/stats/revenue", auth, requireRole("admin"), (req, res) => {
  const { start, end, granularity } = req.query;
  const unit = granularity === "month" ? 7 : 10; // substr(pay_time,1,7) 按月 / 1,10 按天
  const conds = [];
  const params = [];
  if (start) { conds.push("date(p.pay_time) >= ?"); params.push(start); }
  if (end) { conds.push("date(p.pay_time) <= ?"); params.push(end); }
  const where = conds.length ? conds.join(" AND ") : "1=1";
  const rows = db.prepare(`
    SELECT substr(p.pay_time, 1, ?) AS period, SUM(p.amount) AS total, COUNT(*) AS cnt
    FROM payments p
    JOIN students s ON s.id = p.student_id
    WHERE ${where}
    GROUP BY period ORDER BY period
  `).all(unit, ...params);

  // ★ 2026-09-26 净额口径（对齐 ADR-003）：减去同期「已审批通过」的退费。
  //   此前只算缴费 → 报表里的"实收"是毛额，**退出去的钱在任何报表里都看不见**。
  //   仍同时返回 gross（缴费毛额）与 refunded（同期退费），便于向业务解释差额。
  const rConds = [];
  const rParams = [];
  if (start) { rConds.push(`date(${REFUND_TIME_SQL}) >= date(?)`); rParams.push(start); }
  if (end) { rConds.push(`date(${REFUND_TIME_SQL}) <= date(?)`); rParams.push(end); }
  const rWhere = rConds.length ? rConds.join(" AND ") : "1=1";
  const refRows = db.prepare(`
    SELECT substr(${REFUND_TIME_SQL}, 1, ?) AS period, SUM(r.amount) AS total
    FROM refunds r
    WHERE r.status = '通过' AND ${rWhere}
    GROUP BY period
  `).all(unit, ...rParams);

  const payMap = Object.fromEntries(
    rows.map(r => [r.period, { total: Number(r.total) || 0, cnt: Number(r.cnt) || 0 }])
  );
  const refMap = Object.fromEntries(refRows.map(r => [r.period, Number(r.total) || 0]));
  const periods = [...new Set([...Object.keys(payMap), ...Object.keys(refMap)])].sort();
  const list = periods.map(p => {
    const pay = payMap[p] || { total: 0, cnt: 0 };
    const refunded = refMap[p] || 0;
    return {
      period: p,
      cnt: pay.cnt,
      gross: pay.total, // 缴费毛额（保留，便于解释差额）
      refunded, // 同期已通过退费
      total: Number((pay.total - refunded).toFixed(2)) // 净额（前端沿用 total，无需改动）
    };
  });
  const grand = Number(list.reduce((sum, r) => sum + r.total, 0).toFixed(2));
  res.json({ success: true, data: { list, totalRevenue: grand } });
});

/** 欠费统计：订单金额 > 实缴净额 的在读/结业订单 */
router.get("/stats/arrears", auth, requireRole("admin"), (req, res) => {
  // ★ 2026-09-26 「已缴」改为净额（减退费）：退款之后欠费应当回升，
  //   此前用缴费毛额 → 退过费的订单欠费被系统性低估。
  const rows = db.prepare(`
    SELECT o.id, o.student_id, s.student_no, s.name AS student_name,
           c.name AS class_name, o.enroll_date, o.amount,
           ${paidNetSql("o.id")} AS paid,
           o.amount - (${paidNetSql("o.id")}) AS arrears
    FROM orders o
    JOIN students s ON s.id = o.student_id
    LEFT JOIN classes c ON c.id = o.class_id
    WHERE o.status != '退班' AND o.amount > 0
    GROUP BY o.id
    HAVING arrears > 0
    ORDER BY arrears DESC
  `).all();
  const totalArrears = rows.reduce((sum, r) => sum + r.arrears, 0);
  res.json({ success: true, data: { list: rows, totalArrears } });
});

/** 剩余课时不足预警：在读且设了课时包的订单中，剩余课时 ≤ 阈值（教师仅本班） */
router.get("/stats/low-hours", auth, requireRole("admin"), (req, res) => {
  const { threshold = 5 } = req.query;
  const rows = db.prepare(`
    SELECT o.id, o.student_id, s.student_no, s.name AS student_name,
           c.name AS class_name, cu.name AS course_name,
           o.total_hours, o.remain_hours, o.enroll_date
    FROM orders o
    JOIN students s ON s.id = o.student_id
    LEFT JOIN classes c ON c.id = o.class_id
    LEFT JOIN courses cu ON cu.id = o.course_id
    WHERE o.status = '在读' AND o.total_hours > 0 AND o.remain_hours <= ?
    ORDER BY o.remain_hours ASC
  `).all(Number(threshold));
  res.json({ success: true, data: { list: rows, threshold: Number(threshold) } });
});

// ==================== 经营报表（仅 admin） ====================

/** 经营报表：招生/营收/续班/在读 汇总（近 12 个月营收、按课程营收、渠道转化、续班率、在读率） */
router.get("/stats/business", auth, requireRole("admin"), (req, res) => {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const twelveMonthsAgo = fmtDate(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  const sixMonthsAgo = fmtDate(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

  // 总览
  const totalStudents = db.prepare("SELECT COUNT(*) AS c FROM students").get().c;
  const activeStudents = db.prepare("SELECT COUNT(*) AS c FROM students WHERE status = '在读'").get().c;
  const activeOrders = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = '在读'").get().c;
  // ★ 2026-09-26 净额口径（对齐 ADR-003）：实收 = 缴费 − 已审批通过的退费。
  //   此前是缴费毛额 —— 校长在这一页看到的是"收了多少"，而不是"实际留下多少"。
  const monthPay = Number(
    db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE pay_time >= ?").get(monthStart).s || 0
  );
  const monthRefund = Number(
    db
      .prepare(`SELECT COALESCE(SUM(r.amount),0) AS s FROM refunds r WHERE r.status = '通过' AND ${REFUND_TIME_SQL} >= ?`)
      .get(monthStart).s || 0
  );
  const monthRevenue = Number((monthPay - monthRefund).toFixed(2));
  const totalPay = Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments").get().s || 0);
  const totalRefund = Number(
    db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM refunds WHERE status = '通过'").get().s || 0
  );
  const totalRevenue = Number((totalPay - totalRefund).toFixed(2));
  const totalLeads = db.prepare("SELECT COUNT(*) AS c FROM leads").get().c;
  const convertedLeads = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE status = '已转化'").get().c;

  // 续班率：近 6 个月结业的学员中，存在后续在读订单的比例
  const graduated6m = db.prepare(
    "SELECT COUNT(DISTINCT student_id) AS c FROM orders WHERE status = '结业' AND enroll_date >= ?"
  ).get(sixMonthsAgo).c;
  const renewed6m = db.prepare(`
    SELECT COUNT(DISTINCT o.student_id) AS c
    FROM orders o
    WHERE o.status = '结业' AND o.enroll_date >= ?
      AND EXISTS (
        SELECT 1 FROM orders o2
        WHERE o2.student_id = o.student_id AND o2.status = '在读' AND o2.id != o.id
      )
  `).get(sixMonthsAgo).c;

  // 近 12 个月月度营收（★ 2026-09-26 改为净额：按月减去同期已通过退费，退款不再从报表里消失）
  const payByMonth = db.prepare(`
    SELECT substr(p.pay_time, 1, 7) AS period, SUM(p.amount) AS total, COUNT(*) AS cnt
    FROM payments p
    WHERE p.pay_time >= ?
    GROUP BY period ORDER BY period
  `).all(twelveMonthsAgo);
  const refByMonth = db.prepare(`
    SELECT substr(${REFUND_TIME_SQL}, 1, 7) AS period, SUM(r.amount) AS total
    FROM refunds r
    WHERE r.status = '通过' AND ${REFUND_TIME_SQL} >= ?
    GROUP BY period ORDER BY period
  `).all(twelveMonthsAgo);
  const payMonthMap = Object.fromEntries(payByMonth.map(r => [r.period, r]));
  const refMonthMap = Object.fromEntries(refByMonth.map(r => [r.period, Number(r.total) || 0]));
  const monthPeriods = [...new Set([...Object.keys(payMonthMap), ...Object.keys(refMonthMap)])].sort();
  const revenueByMonth = monthPeriods.map(p => {
    const pay = payMonthMap[p];
    const gross = pay ? Number(pay.total) : 0;
    const refunded = refMonthMap[p] || 0;
    return {
      period: p,
      gross,
      refunded,
      cnt: pay ? Number(pay.cnt) : 0,
      total: Number((gross - refunded).toFixed(2))
    };
  });

  // 按课程营收（近 12 个月）★ 2026-09-26 改为净额：按课程减去同期退费（退费经订单关联到课程）
  const payByCourse = db.prepare(`
    SELECT COALESCE(cu.name, '未选课程') AS course_name, SUM(p.amount) AS total, COUNT(*) AS cnt
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN courses cu ON cu.id = o.course_id
    WHERE p.pay_time >= ?
    GROUP BY cu.id ORDER BY total DESC
  `).all(twelveMonthsAgo);
  const refByCourse = db.prepare(`
    SELECT COALESCE(cu.name, '未选课程') AS course_name, SUM(r.amount) AS total
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN courses cu ON cu.id = o.course_id
    WHERE r.status = '通过' AND ${REFUND_TIME_SQL} >= ?
    GROUP BY cu.id
  `).all(twelveMonthsAgo);
  const refCourseMap = Object.fromEntries(refByCourse.map(r => [r.course_name, Number(r.total) || 0]));
  const revenueByCourse = payByCourse
    .map(r => {
      const gross = Number(r.total);
      const refunded = refCourseMap[r.course_name] || 0;
      return {
        course_name: r.course_name,
        gross,
        refunded,
        cnt: Number(r.cnt),
        total: Number((gross - refunded).toFixed(2))
      };
    })
    .sort((a, b) => b.total - a.total);

  // 招生渠道统计（线索数 / 转化数 / 转化率）
  const channelStats = db.prepare(`
    SELECT source, COUNT(*) AS total,
           SUM(CASE WHEN status = '已转化' THEN 1 ELSE 0 END) AS converted
    FROM leads GROUP BY source
  `).all().map(r => {
    const total = Number(r.total);
    const converted = Number(r.converted);
    return {
      source: r.source,
      total,
      converted,
      conversion_rate: total > 0 ? Number((converted / total * 100).toFixed(1)) : 0
    };
  });

  res.json({
    success: true,
    data: {
      overview: {
        total_students: totalStudents,
        active_students: activeStudents,
        enrollment_rate: totalStudents > 0 ? Number((activeStudents / totalStudents * 100).toFixed(1)) : 0,
        active_orders: activeOrders,
        month_revenue: Number(monthRevenue),
        total_revenue: Number(totalRevenue),
        total_leads: totalLeads,
        converted_leads: convertedLeads,
        conversion_rate: totalLeads > 0 ? Number((convertedLeads / totalLeads * 100).toFixed(1)) : 0,
        graduated_6m: graduated6m,
        renewed_6m: renewed6m,
        renewal_rate: graduated6m > 0 ? Number((renewed6m / graduated6m * 100).toFixed(1)) : 0
      },
      revenue_by_month: revenueByMonth,
      revenue_by_course: revenueByCourse,
      channel_stats: channelStats
    }
  });
});

/** 课消统计：按维度（teacher|course|student）聚合课时消耗 + 收入确认汇总
 *  教师仅统计本班（s 为 students 别名）；can_see_amount 仅 admin 为 true */
router.get("/stats/consumption", auth, requireRole("admin"), (req, res) => {
  const { dimension = "teacher", start, end } = req.query;
  const conds = [];
  const params = [];
  if (start) { conds.push("hc.date >= ?"); params.push(start); }
  if (end) { conds.push("hc.date <= ?"); params.push(end); }
  const where = conds.length ? conds.join(" AND ") : "1=1";
  const allParams = params;

  const consumedExpr = `SUM(CASE WHEN hc.type = '扣减' THEN hc.hours ELSE 0 END)`;
  const refundedExpr = `SUM(CASE WHEN hc.type = '回补' THEN hc.hours ELSE 0 END)`;

  let list;
  if (dimension === "course") {
    list = db.prepare(`
      SELECT COALESCE(cu.name, '未指定课程') AS course_name,
             ${consumedExpr} AS consumed,
             ${refundedExpr} AS refunded,
             COUNT(DISTINCT hc.student_id) AS student_count
      FROM hour_consumptions hc
      JOIN students s ON s.id = hc.student_id
      LEFT JOIN courses cu ON cu.id = hc.course_id
      WHERE ${where}
      GROUP BY hc.course_id
      ORDER BY consumed DESC
    `).all(...allParams).map(r => ({
      course_name: r.course_name,
      consumed: Number(r.consumed || 0),
      refunded: Number(r.refunded || 0),
      student_count: Number(r.student_count || 0)
    }));
  } else if (dimension === "student") {
    list = db.prepare(`
      SELECT s.id AS student_id, s.student_no, s.name AS student_name,
             ${consumedExpr} AS consumed,
             ${refundedExpr} AS refunded,
             COALESCE((SELECT SUM(o.total_hours) FROM orders o
                       WHERE o.student_id = s.id AND o.status = '在读' AND o.total_hours > 0), 0) AS total_hours,
             COALESCE((SELECT SUM(o.remain_hours) FROM orders o
                       WHERE o.student_id = s.id AND o.status = '在读' AND o.total_hours > 0), 0) AS remain_hours
      FROM hour_consumptions hc
      JOIN students s ON s.id = hc.student_id
      WHERE ${where}
      GROUP BY s.id
      ORDER BY consumed DESC
    `).all(...allParams).map(r => ({
      student_id: r.student_id,
      student_no: r.student_no,
      student_name: r.student_name,
      consumed: Number(r.consumed || 0),
      refunded: Number(r.refunded || 0),
      total_hours: Number(r.total_hours || 0),
      remain_hours: Number(r.remain_hours || 0)
    }));
  } else {
    // teacher（默认）：按班级聚合，班主任为空归「未绑定班主任」
    list = db.prepare(`
      SELECT COALESCE(u.name, '未绑定') AS teacher_name, c.name AS class_name,
             ${consumedExpr} AS consumed,
             ${refundedExpr} AS refunded
      FROM hour_consumptions hc
      JOIN students s ON s.id = hc.student_id
      JOIN classes c ON c.id = s.class_id
      LEFT JOIN users u ON u.id = c.head_teacher_id
      WHERE ${where}
      GROUP BY c.id
      ORDER BY consumed DESC
    `).all(...allParams).map(r => ({
      teacher_name: r.teacher_name,
      class_name: r.class_name,
      consumed: Number(r.consumed || 0),
      refunded: Number(r.refunded || 0)
    }));
  }

  // 汇总：总扣减/回补 + 已确认收入 + 金额可见权限
  const totals = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN hc.type = '扣减' THEN hc.hours ELSE 0 END), 0) AS consumed_total,
           COALESCE(SUM(CASE WHEN hc.type = '回补' THEN hc.hours ELSE 0 END), 0) AS refunded_total
    FROM hour_consumptions hc
    JOIN students s ON s.id = hc.student_id
    WHERE ${where}
  `).get(...allParams);
  // B3：权责发生制收入 = Σ(订单金额 × 已消耗课时 / 总课时)
  // 注意：这里**不能**按 status 过滤。退班订单的已消耗课时是已经真实提供过的教学服务，
  //       对应收入应当保留（退款只退「剩余未消耗课时」对应的部分）。
  //       历史实现为 `o.status IN ('在读','结业')`，会把退班订单整单收入抹除，
  //       导致已上课的收入凭空消失且不可追溯（2026-09-12 上线门禁 B3）。
  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(o.amount * (o.total_hours - o.remain_hours) / o.total_hours), 0) AS revenue
    FROM orders o
    JOIN students s ON s.id = o.student_id
    WHERE o.total_hours > 0 AND o.remain_hours <= o.total_hours
  `).get();

  res.json({
    success: true,
    data: {
      list,
      summary: {
        consumed_total: Number(totals.consumed_total),
        refunded_total: Number(totals.refunded_total),
        revenue_recognized: Number(Number(revenueRow.revenue).toFixed(2)),
        can_see_amount: req.user.role === "admin"
      }
    }
  });
});

module.exports = router;
