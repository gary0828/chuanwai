// 统一分页参数钳制（唯一来源）
//
// 背景（2026-10-18 深度测试 P2-4）：各路由直接用 `Number(page) || 1`，
// 导致 `page=1e999` → Infinity → SQLite `datatype mismatch` 500；
// `pageSize=-1` → SQLite `LIMIT -1` = 不限行数（绕过上限、全表返回）。
// 本工具把非法输入收敛到安全范围，并给 pageSize 硬上限。
//
// 用法：
//   const { clampPagination } = require("../utils/pagination");
//   const { page, pageSize, offset } = clampPagination(req.query);
//
// 约定：pageSize 上限默认 200（导出类端点不受此工具约束，由调用方决定）。
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 200;

/**
 * @param {object} query 一般是 req.query（允许字符串/数字）
 * @param {object} [opts]
 * @param {number} [opts.defaultSize]
 * @param {number} [opts.maxSize]
 * @param {boolean} [opts.allowAll] 传 true 时，pageSize 为 -1/0 表示"全部"（仅导出用），返回 pageSize=null
 * @returns {{ page: number, pageSize: number|null, offset: number }}
 */
function clampPagination(query = {}, opts = {}) {
  const defaultSize = opts.defaultSize || DEFAULT_PAGE_SIZE;
  const maxSize = opts.maxSize || MAX_PAGE_SIZE;

  const rawSize = Number(query.pageSize);
  const rawPage = Number(query.page);

  let pageSize;
  if (opts.allowAll && (rawSize === -1 || rawSize === 0)) {
    pageSize = null;
  } else if (!Number.isFinite(rawSize) || rawSize < 1) {
    pageSize = defaultSize;
  } else {
    pageSize = Math.min(Math.floor(rawSize), maxSize);
  }

  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const offset = pageSize === null ? 0 : (page - 1) * pageSize;

  return { page, pageSize, offset };
}

module.exports = { clampPagination, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
