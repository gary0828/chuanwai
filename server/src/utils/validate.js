// 输入校验工具：服务端边界统一收口
//
// 背景（2026-09-12 全面测试发现）：多个接口把客户端传入的日期、字符串长度、
// 数值范围直接落库，未做服务端校验。后果示例：
//   · POST /api/attendance/batch 传 date="2026-99-99" / "xxxx-xx-xx" 会被接受，
//     落库为不可排序的垃圾日期，并**照常扣减真实课时**；
//   · 班级/课程/学生名可写入 400 字符，撑破表格与导出；
//   · exams.full_score 可写入负数。
// 本模块提供统一的解析/校验函数，各路由在写库前调用。

/** 被校验的值是否为空（undefined / null / 空串） */
function isBlank(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * 校验并规整「日期」字段（严格 YYYY-MM-DD，且必须是真实存在的日期）
 * 注：不接受 "20260901" / "2026-99-99" / "0000-00-00" 等形态。
 * @returns {{ok:true,value:string}|{ok:false,message:string}}
 */
function parseDate(value, { field = "日期", required = true } = {}) {
  if (isBlank(value)) {
    if (!required) return { ok: true, value: "" };
    return { ok: false, message: `请选择${field}` };
  }
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { ok: false, message: `${field}格式不正确，应为 YYYY-MM-DD` };
  }
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900 || y > 2999) return { ok: false, message: `${field}年份超出合理范围` };
  // 用 UTC 构造后回读，排除 2026-02-30 / 2026-99-99 这类「格式对但不存在」的日期
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, message: `${field}不是一个真实存在的日期` };
  }
  return { ok: true, value: s };
}

/**
 * 校验并规整「日期时间」字段：接受 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss
 * @returns {{ok:true,value:string}|{ok:false,message:string}}
 */
function parseDateTime(value, { field = "时间", required = true } = {}) {
  if (isBlank(value)) {
    if (!required) return { ok: true, value: "" };
    return { ok: false, message: `请选择${field}` };
  }
  const s = String(value).trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return { ok: false, message: `${field}格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss` };
  const dateRes = parseDate(m[1], { field });
  if (!dateRes.ok) return dateRes;
  if (m[2] !== undefined) {
    const hh = Number(m[2]), mm = Number(m[3]), ss = m[4] === undefined ? 0 : Number(m[4]);
    if (hh > 23 || mm > 59 || ss > 59) return { ok: false, message: `${field}时刻不合法` };
  }
  return { ok: true, value: s };
}

/**
 * 校验并规整「字符串长度」
 * @returns {{ok:true,value:string}|{ok:false,message:string}}
 */
function parseText(value, { field = "内容", max = 100, required = false } = {}) {
  if (isBlank(value)) {
    if (required) return { ok: false, message: `请输入${field}` };
    return { ok: true, value: "" };
  }
  const s = String(value).trim();
  if (s.length > max) return { ok: false, message: `${field}不能超过 ${max} 个字符（当前 ${s.length}）` };
  return { ok: true, value: s };
}

/**
 * 校验「数值」：必须是真正的 number 类型（拒绝 true / "1" / null 等隐式转换），
 * 且落在 [min, max] 闭区间内。
 * @returns {{ok:true,value:number}|{ok:false,message:string}}
 */
function parseNumber(value, { field = "数值", min = -Infinity, max = Infinity, integer = false, required = true } = {}) {
  if (isBlank(value)) {
    if (!required) return { ok: true, value: null };
    return { ok: false, message: `请输入${field}` };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, message: `${field}必须是数字` };
  }
  if (integer && !Number.isInteger(value)) {
    return { ok: false, message: `${field}必须是整数` };
  }
  if (value < min) return { ok: false, message: `${field}不能小于 ${min}` };
  if (value > max) return { ok: false, message: `${field}不能大于 ${max}` };
  return { ok: true, value };
}

/** 判断错误是否为 SQLite 约束类错误（供全局错误处理映射为 4xx） */
function isConstraintError(err) {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  return (
    /FOREIGN KEY constraint failed/i.test(msg) ||
    /UNIQUE constraint failed/i.test(msg) ||
    /CHECK constraint failed/i.test(msg) ||
    /NOT NULL constraint failed/i.test(msg) ||
    /SQLITE_CONSTRAINT/i.test(code)
  );
}

/** 把 SQLite 约束错误翻译为可读的 400 提示（不泄露表名列名） */
function constraintMessage(err) {
  const msg = String(err?.message || "");
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return "关联的对象不存在（可能已被删除），请刷新后重试";
  }
  if (/UNIQUE constraint failed/i.test(msg)) {
    return "存在重复数据（唯一字段冲突）";
  }
  if (/CHECK constraint failed/i.test(msg)) {
    return "字段取值不在允许范围内";
  }
  if (/NOT NULL constraint failed/i.test(msg)) {
    return "必填字段缺失";
  }
  return "数据不满足约束条件";
}

module.exports = {
  isBlank,
  parseDate,
  parseDateTime,
  parseText,
  parseNumber,
  isConstraintError,
  constraintMessage
};
