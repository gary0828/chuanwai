// 金额口径统一（对齐 ADR-003）
//
// ★ 2026-09-26 新增。背景：
//   「实缴 / 实收」此前在 finance.js 与 reports.js 里各自内联 `SUM(payments.amount)`，
//   **从不减去退费** → 每个订单的「已缴」偏高、欠费被低估、报表里的"实收"是毛额。
//   而项目自家 ADR-003 早已定义：
//       实缴 = SUM(payments) − SUM(已审批通过的 refunds)
//   analytics.js 的口径字典（METRIC_DEFINITIONS.revenue_total）也一直是对的，
//   **是 finance / reports 侧的实现没跟上定义** —— 与出勤率那次同属「同一指标两套算法」。
//
//   把 SQL 片段放这里共用，避免"改了 A 忘了 B"再次发生。

/**
 * 生成「按订单的实缴净额」SQL 片段
 *
 * @param {string} orderRef SQL 中订单主键的引用，例如 "o.id"（调用方传入，非用户输入）
 * @returns {string} 可直接嵌进 SELECT 的表达式（返回净额，单位元）
 *
 * @example
 *   db.prepare(`SELECT o.id, ${paidNetSql("o.id")} AS paid FROM orders o`)
 */
function paidNetSql(orderRef) {
  return `
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = ${orderRef}), 0)
           - COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.order_id = ${orderRef} AND r.status = '通过'), 0)`;
}

/**
 * 退费的「发生时间」表达式 —— 与 analytics.js 保持一致：
 * 优先取审批时间，其次申请时间，最后创建时间。
 * 用于把退费归入某个时间区间（营收按月/按天统计时对齐口径）。
 */
const REFUND_TIME_SQL = "COALESCE(r.approve_time, r.apply_time, r.created_at)";

module.exports = { paidNetSql, REFUND_TIME_SQL };
