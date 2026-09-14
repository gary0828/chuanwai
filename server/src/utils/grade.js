// 成绩等级换算：按得分率分档
//   >=90% 优 / >=80% 良 / >=70% 中 / >=60% 及格 / 否则不及格
// 由 exams.js（成绩录入）与 reports.js（学习报告）共用，避免两处各维护一份副本。
/** @param score 得分 @param fullScore 满分（<=0 时按 0 分处理） */
function calcGrade(score, fullScore) {
  const ratio = fullScore > 0 ? score / fullScore : 0;
  if (ratio >= 0.9) return "优";
  if (ratio >= 0.8) return "良";
  if (ratio >= 0.7) return "中";
  if (ratio >= 0.6) return "及格";
  return "不及格";
}

module.exports = { calcGrade };
