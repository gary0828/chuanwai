// 审计日志工具：记录登录用户的关键写操作
const db = require("../db");

/**
 * 写入一条审计日志
 * @param user 当前登录用户（含 id/username/role）
 * @param action 动作描述，如「新增学生」「考勤登记」「删除备份」
 * @param detail 补充说明（如操作对象名称）
 * @param req Express 请求对象（取方法/路径/IP）
 */
function audit(user, action, detail = "", req = null) {
  if (!user || !user.id) return; // 未登录用户（如登录接口本身）不记录
  try {
    db.prepare(
      `INSERT INTO audit_logs (user_id, username, action, method, path, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.id,
      user.username ?? "",
      action,
      req?.method ?? "",
      req?.path ?? "",
      detail || "",
      req?.ip ?? ""
    );
  } catch (e) {
    // 审计失败不影响主流程
    console.warn("[audit] 写入失败:", e.message);
  }
}

module.exports = { audit };
