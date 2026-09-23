// 考勤扣课状态集中读取点（G1-P0-12）
//
// 背景：此前扣课状态硬编码在 routes/attendance.js（["正常","迟到","早退"]）。
// 为后续「考勤 × 课消规则矩阵」（G14）铺垫，抽成单一权威来源。
// ★ 本文件只做「集中读取」，**行为不变**（仍是 正常/迟到/早退 三种状态扣减课时）。
const DEDUCT_STATUSES = ["正常", "迟到", "早退"];

/** 返回视为「已出勤（应扣课时）」的考勤状态列表（副本，调用方可安全修改） */
function getDeductStatuses() {
  return [...DEDUCT_STATUSES];
}

module.exports = { getDeductStatuses, DEDUCT_STATUSES };
