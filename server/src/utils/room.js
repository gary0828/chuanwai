// 教室参数校验（★ 2026-09-30 v23 新增）
//
// 三处需要同一套规则：排课模板（schedules）写 room_id、课次（sessions）改 room_id、
// 教室字典自身的增改（rooms）。提取到此处，避免三份实现漂移。
//
// 规则：空（null/undefined/""）→ null（表示"未指定教室"）；
//       给了值 → 必须是正整数且该教室存在，否则返回可读错误。
const db = require("../db");

/**
 * @param {*} roomId 请求体里的 room_id
 * @returns {{ok:true, value:number|null} | {ok:false, message:string}}
 */
function parseRoomId(roomId) {
  if (roomId === null || roomId === undefined || roomId === "") {
    return { ok: true, value: null };
  }
  const id = Number(roomId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "教室参数不合法" };
  }
  if (!db.prepare("SELECT 1 FROM rooms WHERE id = ?").get(id)) {
    return { ok: false, message: "教室不存在" };
  }
  return { ok: true, value: id };
}

module.exports = { parseRoomId };
