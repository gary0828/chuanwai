// 课时对账（对账式扣课）—— 单一权威实现
//
// ★ 为什么需要这个文件（2026-10-12 真实事故）：
//   原先「扣课时」是**事件式**的 —— 只有考勤状态"发生变化的那一瞬间"才扣，
//   错过就永远不补。于是以下场景全部永久漏扣，且界面无任何提示：
//     · 订单没设课时包（total_hours = 0）时点名，事后补课时包 → 不补扣
//     · 先点名、后报班 → 不扣
//     · 订单退班后又改回「在读」 → 中间那段考勤不扣
//   本文件改为**对账式**：以「已有出勤考勤」为事实基准，核对「已扣流水」，
//   缺多少补多少。因此它是**幂等**的 —— 跑多少次结果都一样，补过就不会重复补。
//
// ★ 与其它模块的关系：
//   `attendance.js` / `makeups.js` / `leaves.js` 原先各自复制了一份
//   「匹配订单 → 扣减/回补 → 写流水」的代码（三处重复，改一处必漏两处）。
//   本次统一收口到本文件：三个调用方只负责"什么时候对账"，不再自己写 SQL。
//
// ★ 老数据的兼容策略（重要，别改坏）：
//   v29 之前的历史流水没有 `attendance_id`，无法精确归属到某条考勤。
//   故「已扣判定」是两段式：
//     ① 精确：`hc.attendance_id = 该考勤.id`            （v29 起的新数据）
//     ② 宽松：`hc.attendance_id IS NULL AND hc.date = 该考勤.date`（历史数据）
//   宽松段刻意选"宁可少补、绝不重复扣" —— 少补的会被对账清单列出，重复扣则会
//   凭空吃掉客户已付的课时，后者不可接受。
//   同时排除 `source = '补课'`：补课的扣减发生在缺勤日，与"出勤考勤"不是一回事。
const { DEDUCT_STATUSES } = require("./attendance-rules");

/** 流水来源（写入 hour_consumptions.source） */
const SOURCE = {
  ATTENDANCE: "考勤", // 考勤提交链路产生（含紧随其后触发的自动补扣）
  MAKEUP: "补课", // 补课"已完成"扣减 / 撤销回补
  LEAVE: "请假", // 请假审批通过的回补
  MANUAL: "手工调整", // 在报班管理里手工改剩余课时
  RECONCILE: "对账修正" // 由「课时对账」工具页手动触发
};

/** 出勤状态的 SQL 占位符（复用 attendance-rules，避免两处口径分叉） */
const STATUS_PH = DEDUCT_STATUSES.map(() => "?").join(",");

/**
 * 「已扣判定」：这条考勤产生的课时，现在到底还在不在学员账上？
 *
 * ★ 为什么用「**条数**净额」而不是 `SUM(hours)`（2026-10-12 实测数据定调）：
 *   查历史库发现 —— 出勤考勤与扣减流水**条数严格一一对应**（黄子涵 8 条对 8 条），
 *   但 `hours` 老口径是 2、新口径是 1。**若按 hours 求和判定，会把全部历史考勤
 *   误判成"没扣过"→ 一次性重复扣掉 88 节课**，这是不可接受的。
 *   条数则不受单位变化影响，且语义正好是我们想问的："这条考勤扣过了吗"。
 *
 * ★ 净额（扣减 +1 / 回补 −1）的意义：
 *   考勤「出勤 → 缺勤 → 出勤」会先扣、再回补、再扣。若只看"有没有扣减流水"，
 *   那条已作废的扣减会让中间那段"缺勤"被误判成"已扣"。取净额后：
 *   扣 1 补 1 = 0 → 判为未扣 → 该补就补，正好。
 *
 * ★ 两段式匹配（v29 之前的历史流水没有 attendance_id）：
 *     ① 精确：hc.attendance_id = 该考勤.id
 *     ② 宽松：hc.attendance_id IS NULL AND hc.date = 该考勤.date
 *   宽松段宁可少补、绝不重复扣（重复扣=凭空吃掉客户已付课时，不可接受）。
 *   同时排除 source='补课'：补课扣减发生在缺勤日，与「出勤考勤」不是一回事。
 *
 * 调用处必须把 attendances 别名为 a。
 */
const DEDUCTED_EXISTS = `
  EXISTS (
    SELECT 1 FROM hour_consumptions hc
    WHERE hc.student_id = a.student_id
      AND hc.course_id = a.course_id
      AND COALESCE(hc.source, '') <> '${SOURCE.MAKEUP}'
      AND (hc.attendance_id = a.id OR (hc.attendance_id IS NULL AND hc.date = a.date))
    GROUP BY hc.student_id, hc.course_id
    HAVING SUM(CASE WHEN hc.type = '扣减' THEN 1 ELSE -1 END) > 0
  )`;

/** 某学员某课程的明细对账（只读，不改库） */
function computeGap(db, studentId, courseId) {
  const attendCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM attendances a
       WHERE a.student_id = ? AND a.course_id = ? AND a.status IN (${STATUS_PH})`
    )
    .get(studentId, courseId, ...DEDUCT_STATUSES).c;

  const missing = db
    .prepare(
      `SELECT a.id, a.date, a.session_id FROM attendances a
       WHERE a.student_id = ? AND a.course_id = ? AND a.status IN (${STATUS_PH})
         AND NOT ${DEDUCTED_EXISTS}
       ORDER BY a.date, a.id`
    )
    .all(studentId, courseId, ...DEDUCT_STATUSES);

  const flowCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM hour_consumptions
       WHERE student_id = ? AND course_id = ? AND type = '扣减'
         AND COALESCE(source, '') <> ?`
    )
    .get(studentId, courseId, SOURCE.MAKEUP).c;

  const claimed = attendCount - missing.length; // 已被流水认领的考勤数
  return {
    studentId,
    courseId,
    attendCount,
    flowCount,
    missing, // 欠扣的考勤明细
    gap: missing.length, // 欠扣条数
    surplus: flowCount - claimed // >0 表示有流水找不到对应考勤（异常，本次只报告不自动改）
  };
}

/** 取「发课时」的订单：在读 + 同课程 + 有课时包，优先剩余最多的（与历史口径一致） */
function findGrantOrder(db, studentId, courseId) {
  return db
    .prepare(
      `SELECT o.id, o.class_id, o.remain_hours, s.class_id AS student_class_id
       FROM orders o JOIN students s ON s.id = o.student_id
       WHERE o.student_id = ? AND o.course_id = ? AND o.status = '在读' AND o.total_hours > 0
       ORDER BY o.remain_hours DESC, o.id LIMIT 1`
    )
    .get(studentId, courseId);
}

/**
 * 对某学员某课程执行对账补扣。
 *
 * ★ 本函数**不自己开事务** —— 因为调用方（如考勤批量提交）已经在事务里，
 *   而 SQLite 不支持嵌套事务。独立调用（对账工具页）请自行用 BEGIN/COMMIT 包裹。
 *
 * @param {object} db          node:sqlite 连接
 * @param {number} studentId
 * @param {number} courseId
 * @param {number} operatorId  操作人（写流水）
 * @param {string} source      写入流水的来源：SOURCE.ATTENDANCE 或 SOURCE.RECONCILE
 * @param {boolean} dryRun     true = 只算不写
 * @returns {{gap:number, fixed:number, reason:string, surplus:number}}
 */
function reconcile(db, { studentId, courseId, operatorId, source = SOURCE.RECONCILE, dryRun = false }) {
  const snap = computeGap(db, studentId, courseId);
  const out = { gap: snap.gap, fixed: 0, reason: "", surplus: snap.surplus };

  if (snap.gap === 0) {
    // 没有欠扣。若流水反而多于考勤 → 异常，留给人工核查
    if (snap.surplus > 0) out.reason = `流水比考勤多 ${snap.surplus} 条，需人工核查`;
    return out;
  }
  if (dryRun) {
    out.reason = "未执行（试算）";
    return out;
  }

  const deductOne = db.prepare(
    `UPDATE orders SET remain_hours = MAX(0, remain_hours - 1), updated_at = datetime('now','localtime') WHERE id = ?`
  );
  const insertCons = db.prepare(
    `INSERT INTO hour_consumptions
       (student_id, order_id, course_id, class_id, date, session_id, hours, type, source, attendance_id, operator_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, '扣减', ?, ?, ?)`
  );

  for (const a of snap.missing) {
    // 每补一条都重新取订单：剩余课时在循环里是变化的
    const order = findGrantOrder(db, studentId, courseId);
    if (!order) {
      out.reason = "该学员在此课程下没有「在读且已设课时包」的订单，无法补扣";
      break;
    }
    if (Number(order.remain_hours) <= 0) {
      // ★ 刻意**不**允许扣成负数：剩余课时归零即停，避免 ADR-003 的剩余学费出现负数。
      //   补足课时包后再跑一次对账即可接着补上 —— 对账是幂等的。
      out.reason = "剩余课时已为 0，请先补课时包后再对账";
      break;
    }
    deductOne.run(order.id);
    insertCons.run(
      studentId,
      order.id,
      courseId,
      order.class_id ?? order.student_class_id ?? null,
      a.date,
      a.session_id ?? null,
      source,
      a.id,
      operatorId ?? null
    );
    out.fixed++;
  }
  return out;
}

/**
 * 全量扫描存在欠扣的 (学员, 课程) 组合 —— 一次 SQL 查全，不做 N+1。
 * 给「课时对账」工具页与自动对账兜底使用。
 */
function listGaps(db) {
  return db
    .prepare(
      `SELECT a.student_id, a.course_id, s.name AS student_name, s.student_no,
              c.name AS course_name, COUNT(*) AS gap
       FROM attendances a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN courses c ON c.id = a.course_id
       WHERE a.status IN (${STATUS_PH})
         AND NOT ${DEDUCTED_EXISTS}
       GROUP BY a.student_id, a.course_id
       ORDER BY gap DESC, s.name`
    )
    .all(...DEDUCT_STATUSES);
}

module.exports = {
  SOURCE,
  DEDUCT_STATUSES,
  DEDUCTED_EXISTS,
  computeGap,
  reconcile,
  listGaps,
  findGrantOrder
};
