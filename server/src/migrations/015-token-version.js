// v15：JWT 凭证可吊销（上线门禁 H2 修复）
// 1. users 新增 token_version，默认 0
// 2. 签发的 accessToken / refreshToken 均携带 tv 声明，鉴权时与 users.token_version 比对
//    → 登出 / 改密 / 改角色 / 删号 时递增即可立即吊销该用户全部已签发凭证
//
// 兼容性：升级前已签发的旧 token 不含 tv 声明，视为 0，与本列默认值 0 相等，
//         因此升级不会强制已登录员工重新登录。
module.exports = {
  version: 15,
  name: "JWT 凭证可吊销（users.token_version）",
  up(db) {
    db.exec(`
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
`);

    // 外键完整性校验（与既有迁移保持一致的收尾动作）
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
