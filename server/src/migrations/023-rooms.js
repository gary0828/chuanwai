// v23：教室字典（rooms 表 + schedules.room_id）
//
// 背景（2026-09-30 校区反馈⑤）：校区需要「课表上能看到上哪个教室」。
//
// 现状勘查结论：
// - `class_sessions.room_id` **早已存在**但**从未使用**（全库 0 条有值），且它是在
//   v21/v22 重建 class_sessions 时定的型，**没有外键**；给已有表补外键必须重建表，代价大。
// - `schedules`（排课模板）**没有**教室字段 → 想"模板设一次、生成的课次都继承"就缺这一列。
//
// 设计（用户 2026-09-30 拍板：用**字典表**而非自由文本）：
// - `rooms` 字典表：避免出现「302」「302教室」「三零二」三种写法；
//   后续可自然扩展「同教室同时段冲突检测」。
// - `schedules.room_id` **带外键**（ON DELETE SET NULL）→ 删除教室时
//   `utils/delete-guard.js` 能自动发现"被哪些排课模板引用"，不必手工列举。
// - `class_sessions.room_id` 保持**无外键**（不动既有表结构）：删除教室时由
//   `routes/rooms.js` **手工检查**课次引用并拒绝删除，避免出现"指向不存在教室的课次"。
//
// 回退方式（若需回滚）：DROP TABLE rooms; 并重建 schedules 去掉 room_id
// （SQLite 不支持 DROP COLUMN 早期版本，v3.35+ 支持 ALTER TABLE DROP COLUMN）。
module.exports = {
  version: 23,
  name: "教室字典（rooms + schedules.room_id）",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  capacity   INTEGER,
  remark     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

    // 排课模板的教室：生成的课次据此继承（见 utils/session-engine.js）
    // ★ ADD COLUMN 带外键时默认值必须为 NULL —— 本列不设默认值，满足该约束
    db.exec(`
ALTER TABLE schedules ADD COLUMN room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL;
`);

    // 外键完整性校验（与既有迁移保持一致的收尾动作）
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
