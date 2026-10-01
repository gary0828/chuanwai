// 节次范围（★ v24 起由 `period_times` 表决定，不再写死 1–8）
//
// 背景：v21 曾拍板「节次固定 1–8（Q3）」；2026-10-01 校区反馈「机构不是学校，
// 节次数量与时间要能自定义」→ v24 迁移去掉 DB 层的固定上限，本模块把散在
// 4 处（2 个迁移 + period-times.js + session-engine.js）的常量**收口到一处**。
//
// 口径（用户拍板「上限不限」，但要有合理保护）：
//   · 节次**可以自由增加**（如机构一天 5 节、集训期 12 节）—— 数量 = `period_times` 的行数
//   · 但**排课/加课时**必须落在**已配置的节次**范围内 —— 否则就会出现"排了第 9 节
//     但节次时间表里没有第 9 节"的悬空课次（课表渲染也会缺行）
//   · 下限恒为 1（DB 层 `CHECK (period >= 1)` 只保底、不封顶）
const db = require("../db");

/** 已配置的节次范围：`{ min, max }`（表为空时回落 1..1，不阻断启动） */
function getPeriodRange() {
  const r = db
    .prepare("SELECT MIN(period) AS lo, MAX(period) AS hi FROM period_times")
    .get();
  return { min: r && r.lo != null ? Number(r.lo) : 1, max: r && r.hi != null ? Number(r.hi) : 1 };
}

/** 全部已配置节次（升序；含 label 与起止时间） */
function listPeriods() {
  return db
    .prepare("SELECT period, label, start_time, end_time FROM period_times ORDER BY period")
    .all();
}

/**
 * 校验「排课 / 加课 / 挪课」用的节次是否合法。
 * @returns {{ok:true, value:number} | {ok:false, message:string}}
 */
function checkPeriod(period) {
  const p = Number(period);
  if (!Number.isInteger(p) || p < 1) {
    return { ok: false, message: "节次必须是不小于 1 的整数" };
  }
  const { max } = getPeriodRange();
  if (p > max) {
    return {
      ok: false,
      message: `节次超出已配置范围（当前最多 ${max} 节）—— 请先到「排课与课表 → 节次时间」增加节次`
    };
  }
  return { ok: true, value: p };
}

module.exports = { getPeriodRange, listPeriods, checkPeriod };
