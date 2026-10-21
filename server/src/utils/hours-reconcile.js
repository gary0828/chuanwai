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
// ★ 与其它模块的关系（2026-10-18 修正为如实描述 —— 此前注释写的是"已全部收口"，与代码不符）：
//   `attendance.js` / `makeups.js` / `leaves.js` 原先各自复制了一份
//   「匹配订单 → 扣减/回补 → 写流水」的代码（三处重复，改一处必漏两处）。
//
//   现状分两层，**改动前请先确认自己在哪一层**：
//     ① 对账层（本文件的 `reconcile`）：只有 `attendance.js` 在批量提交后调用，
//        负责"事件式漏扣"的兜底补扣；
//     ② 记账层（本文件的 `charge` / `refund`）：**扣减/回补的唯一入口**，
//        2026-10-18 起 attendance / leaves / makeups 三个调用方都必须走它，
//        不允许再自己拼 `UPDATE orders SET remain_hours = ...` 或自写流水 INSERT。
//
//   这样拆是因为两层解决的不是同一个问题：对账回答"有没有漏扣"，
//   记账回答"这一笔扣多少、流水怎么写"。混在一起会让补课/请假这类非考勤流水
//   被对账逻辑误判（它们没有出勤考勤作为基准）。
//
// ★ 课时单位（2026-10-18 新增 `class_sessions.hours` 后）：
//   一笔扣减的课时数 = 该课次的 `hours`（无课次的 legacy 考勤回退为 `DEFAULT_HOURS`）。
//   单位只在 `sessionHours()` 一处解析，任何调用方都不许自己写死 1。
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

/**
 * 课时单位的唯一回退值。
 *
 * ★ 为什么要有它：v30 之前「一节课 = 1 课时」硬编码在 6 处 SQL 里，改口径必漏。
 *   现在课时数挂在课次上（`class_sessions.hours`），这里只是**没有课次时**的回退
 *   （legacy 考勤、老数据）。任何调用方都不许再自己写死数字。
 */
const DEFAULT_HOURS = 1;

/** 出勤状态的 SQL 占位符（复用 attendance-rules，避免两处口径分叉） */
const STATUS_PH = DEDUCT_STATUSES.map(() => "?").join(",");

/**
 * 解析「这一笔该记几课时」：取课次的 hours，取不到则回退 DEFAULT_HOURS。
 *
 * @param {object} db        node:sqlite 连接
 * @param {number|null} sessionId 课次 id（legacy 考勤为 null）
 * @returns {number} 恒为正数
 */
function sessionHours(db, sessionId) {
  if (!sessionId) return DEFAULT_HOURS;
  const row = db
    .prepare("SELECT hours FROM class_sessions WHERE id = ?")
    .get(Number(sessionId));
  const h = Number(row?.hours);
  return Number.isFinite(h) && h > 0 ? h : DEFAULT_HOURS;
}

/**
 * 补课场景的课时数：补的是「原来缺的那一节课」，所以课时数应当随原课次走。
 *
 * ★ 为什么不直接用 DEFAULT_HOURS：
 *   学员缺的是两课时的课，补课时却只扣 1 课时 → 少扣一课时，且不会有任何提示。
 *
 * 取数路径：`makeup_classes.original_date` → 当天的考勤 → 考勤的课次 → 课次 hours。
 * 取不到（原缺课当天没录考勤、或老数据没有课次）则回退 DEFAULT_HOURS，
 * 这与 v29 之前的行为一致，不会因为补一条老记录就改变历史账。
 *
 * @param {object} db
 * @param {{studentId:number, courseId:number, originalDate:string}} p
 * @returns {number}
 */
function sessionHoursForMakeup(db, p) {
  if (!p?.courseId || !p?.originalDate) return DEFAULT_HOURS;
  const row = db
    .prepare(
      `SELECT cs.hours
       FROM attendances a
       JOIN class_sessions cs ON cs.id = a.session_id
       WHERE a.student_id = ? AND a.course_id = ? AND a.date = ?
       ORDER BY a.id DESC LIMIT 1`
    )
    .get(p.studentId, p.courseId, p.originalDate);
  const h = Number(row?.hours);
  return Number.isFinite(h) && h > 0 ? h : DEFAULT_HOURS;
}

/**
 * 【记账层·唯一入口】扣减课时 + 写流水。
 *
 * ★ 禁止在各路由里再拼 `UPDATE orders SET remain_hours = ...`：
 *   2026-10-18 审计发现同一段逻辑在 attendance / leaves / makeups 各存一份，
 *   改课时口径时必须同步改 6 处（必然漏）。全部走这里。
 *
 * @param {object} db
 * @param {object} p
 * @param {number} p.orderId
 * @param {number} p.studentId
 * @param {number} p.courseId
 * @param {number|null} p.classId
 * @param {string} p.date            业务日期（非提交时间）
 * @param {number|null} p.sessionId  课次 id
 * @param {number} p.hours           课时数（调用方用 sessionHours() 取，别写死）
 * @param {string} p.source          SOURCE.* 之一
 * @param {number|null} p.attendanceId 关联考勤 id（考勤链路才有）
 * @param {number|null} p.operatorId
 * @returns {number} 实际记账的课时数
 */
function charge(db, p) {
  const want = Number(p.hours) > 0 ? Number(p.hours) : DEFAULT_HOURS;
  // ★ 2026-10-19（业务逻辑深测 P1 修复）：余额不足时只记「**实际扣减量**」。
  //   旧实现 `MAX(0, remain - hours)` 会把余额截断到 0，但流水仍记全额
  //   （实测 total=3/remain=0 时流水净扣=4、课消统计 consumed=4，四口径永久发散）。
  //   charge 返回实际值，调用方/对账以流水为准即可保持一致。
  const order = db
    .prepare("SELECT total_hours, remain_hours FROM orders WHERE id = ?")
    .get(p.orderId);
  const actual = Math.min(want, Math.max(0, Number(order?.remain_hours) || 0));
  if (actual <= 0) return 0;
  db.prepare(
    `UPDATE orders SET remain_hours = remain_hours - ?,
       updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(actual, p.orderId);
  db.prepare(
    `INSERT INTO hour_consumptions
       (student_id, order_id, course_id, class_id, date, session_id, hours, type, source, attendance_id, operator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, '扣减', ?, ?, ?)`
  ).run(
    p.studentId,
    p.orderId,
    p.courseId,
    p.classId ?? null,
    p.date,
    p.sessionId ?? null,
    actual,
    p.source,
    p.attendanceId ?? null,
    p.operatorId ?? null
  );
  return actual;
}

/**
 * 【记账层·唯一入口】回补课时 + 写流水。与 `charge` 严格对称。
 *
 * ★ 上限保护（两道）：
 *   1. 不超过订单总课时（`total_hours - remain_hours` 是当前可回补上限）；
 *   2. 有 `attendanceId` 时按「该考勤实际净扣」封顶 —— 因为 `charge` 可能在
 *      余额不足时被截断（只扣 1 但调用方传 2），撤销时必须只回补真正扣掉的量，
 *      否则会凭空多回补。
 *
 * @returns {number} 实际记账的课时数
 */
function refund(db, p) {
  const want = Number(p.hours) > 0 ? Number(p.hours) : DEFAULT_HOURS;
  const order = db
    .prepare("SELECT total_hours, remain_hours FROM orders WHERE id = ?")
    .get(p.orderId);
  if (!order) return 0;
  let cap = Math.max(0, Number(order.total_hours) - Number(order.remain_hours));
  if (p.attendanceId != null) {
    const net = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type = '扣减' THEN hours ELSE -hours END), 0) AS net
         FROM hour_consumptions WHERE attendance_id = ?`
      )
      .get(p.attendanceId).net;
    cap = Math.min(cap, Math.max(0, Number(net) || 0));
  }
  const actual = Math.min(want, cap);
  if (actual <= 0) return 0;
  db.prepare(
    `UPDATE orders SET remain_hours = MIN(total_hours, remain_hours + ?),
       updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(actual, p.orderId);
  db.prepare(
    `INSERT INTO hour_consumptions
       (student_id, order_id, course_id, class_id, date, session_id, hours, type, source, attendance_id, operator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, '回补', ?, ?, ?)`
  ).run(
    p.studentId,
    p.orderId,
    p.courseId,
    p.classId ?? null,
    p.date,
    p.sessionId ?? null,
    actual,
    p.source,
    p.attendanceId ?? null,
    p.operatorId ?? null
  );
  return actual;
}

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
      `SELECT a.id, a.date, a.session_id,
              COALESCE(cs.hours, ${DEFAULT_HOURS}) AS hours
       FROM attendances a
       LEFT JOIN class_sessions cs ON cs.id = a.session_id
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
 * 【P2-9c】回补时定位「当初扣减的那张订单」—— 只做精确绑定，不做余额兜底。
 *
 * ★ 为什么需要它：`attendance.js` / `leaves.js` / `makeups.js` 的回补此前都按
 *   `ORDER BY remain_hours DESC` 选「余额最多的订单」。同一（学员,课程）存在多张订单时，
 *   A 单被扣、B 单被补 → 两张订单的台账同时漂移（P2-3 / P2-9c）。
 *   有了 `hour_consumptions.attendance_id`（v29 起写入），回补可以反查原扣减订单。
 *
 * ★ 安全边界（刻意保守，避免"补偿性多扣/多补"）：
 *   1. `attendanceId` 必须显式提供 —— 没有它就无法确定原扣减，返回 null 让调用方走旧逻辑；
 *   2. 只看该考勤**最后一条**流水：若最后一条是「回补」，说明这笔扣减已被对冲过，
 *      再回补就是重复回补 → 返回 null；
 *   3. 只返回订单行，**不写库**；调用方拿 `id` 去调 `refund()`，金额/来源仍由调用方决定；
 *   4. 不按 `orders.status` 过滤：原扣减订单可能已结业/退班，是否允许回补由调用方判断
 *      （返回行里带 status 供判断）。v29 之前的流水没有 attendance_id → 返回 null。
 *
 * @param {object} db
 * @param {{studentId:number, courseId:number, attendanceId:number}} p
 * @returns {object|null} 订单行 + `deduct_flow_id` / `deduct_hours` / `deduct_date`
 */
function findOrderForRefund(db, p = {}) {
  const studentId = Number(p.studentId);
  const courseId = Number(p.courseId);
  const attendanceId = Number(p.attendanceId);
  if (
    !Number.isFinite(studentId) ||
    studentId <= 0 ||
    !Number.isFinite(courseId) ||
    courseId <= 0 ||
    !Number.isFinite(attendanceId) ||
    attendanceId <= 0
  ) {
    return null;
  }
  const last = db
    .prepare(
      `SELECT id, order_id, type, hours, date
       FROM hour_consumptions
       WHERE attendance_id = ? AND student_id = ? AND course_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(attendanceId, studentId, courseId);
  if (!last || last.type !== "扣减") return null;
  const order = db
    .prepare(
      `SELECT id, student_id, course_id, class_id, status, total_hours, remain_hours
       FROM orders WHERE id = ?`
    )
    .get(last.order_id);
  if (!order) return null;
  return {
    ...order,
    deduct_flow_id: last.id,
    deduct_hours: last.hours,
    deduct_date: last.date
  };
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
function reconcile(
  db,
  { studentId, courseId, operatorId, source = SOURCE.RECONCILE, dryRun = false }
) {
  const snap = computeGap(db, studentId, courseId);
  const out = { gap: snap.gap, fixed: 0, reason: "", surplus: snap.surplus };

  if (snap.gap === 0) {
    // 没有欠扣。若流水反而多于考勤 → 异常，留给人工核查
    if (snap.surplus > 0)
      out.reason = `流水比考勤多 ${snap.surplus} 条，需人工核查`;
    return out;
  }
  if (dryRun) {
    out.reason = "未执行（试算）";
    return out;
  }

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
    // 走记账层唯一入口（v30：课时数取课次的 hours，不再写死 1）
    charge(db, {
      orderId: order.id,
      studentId,
      courseId,
      classId: order.class_id ?? order.student_class_id ?? null,
      date: a.date,
      sessionId: a.session_id ?? null,
      hours: a.hours,
      source,
      attendanceId: a.id,
      operatorId
    });
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
  DEFAULT_HOURS,
  DEDUCT_STATUSES,
  DEDUCTED_EXISTS,
  sessionHours,
  sessionHoursForMakeup,
  charge,
  refund,
  computeGap,
  reconcile,
  listGaps,
  findGrantOrder,
  findOrderForRefund
};
