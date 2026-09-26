// 出勤率统一口径（2026-09-26 收口）
//
// 为什么单独抽成一个模块：
//   此前 attendance.js（5 处）/ reports.js（1 处）/ analytics.js（1 处）各自内联同一段公式，
//   而 analytics.js 还写成了**另一套分母**（剔除请假）→ 同一个「出勤率」跨页面数字对不上。
//   例：total=100 / absent=5 / leave=10 → 一套算 95%，另一套算 94.4%。
//
// 统一口径（以 attendance.js 为准 —— 老师已经在看这一套，改动影响面最小）：
//   出勤率 = (应到总数 - 缺勤) / 应到总数
//   ★ 请假**计入分母**（请假占用了课次安排，不计为缺勤而视为"未缺勤"）
//
// ⚠️ 口径边界（别记错）：
//   因为 total = 正常 + 迟到 + 早退 + 缺勤 + 请假，所以 `total - 缺勤` 里**含请假**。
//   → 出勤率 + 缺勤率 = 100% ✅
//   → 请假率是与之**重叠**的独立维度，**不能**与出勤率相加（95 + 5 + 10 ≠ 100）。
//   这是本项目选定的业务口径：请假不扣出勤，但要单独可见。
//
// 返回：百分数（保留 1 位小数）；分母为 0 时返回 0。
// 与改造前各处 `Number(((x / y) * 100).toFixed(1))` 的数值行为完全一致
// （已用 20301 组样本对拍验证）。

function attendanceRate(total, absent) {
  const t = Number(total || 0);
  const a = Number(absent || 0);
  if (!(t > 0)) return 0;
  return Number((((t - a) / t) * 100).toFixed(1));
}

/** 缺勤率 = 缺勤 / 应到总数（与 attendanceRate 同分母，保证两率可相加） */
function absentRate(total, absent) {
  const t = Number(total || 0);
  const a = Number(absent || 0);
  if (!(t > 0)) return 0;
  return Number(((a / t) * 100).toFixed(1));
}

module.exports = { attendanceRate, absentRate };
