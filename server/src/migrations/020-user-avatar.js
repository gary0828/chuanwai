// v20：员工头像（users.avatar）
//
// 背景（2026-09-23）：顶栏头像一直是**写死的占位图** ——
// `routes/auth.js` 在登录与 /info 两处硬编码 `avatar: ""`，前端空值回落内置静态图，
// 员工没有任何可自助修改的"我的"这一层（C2 · 内容清点待办）。
//
// 设计：
// - 只存**相对路径**（如 `/assets/avatars/avatar-3-20260923...png`），**不存二进制** ——
//   见 ADR-008：DB 只存索引，文件本体落盘 `server/data/assets/avatars/`。
//   落盘目录随 `server/data/` 一起备份（只备份 db 会丢文件）。
// - 默认空串：未上传头像的员工沿用前端内置占位图，不做"默认头像写入"。
//
// 完整设计见 `docs/07-架构与决策/ROADMAP.md`。
module.exports = {
  version: 20,
  name: "员工头像（users.avatar）",
  up(db) {
    db.exec(`
ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
`);

    // 外键完整性校验（与既有迁移保持一致的收尾动作）
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
