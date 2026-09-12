// v5：学期管理（统计/报表按学期筛选；is_current 标记当前学期，应用层保证仅一条为 1）
module.exports = {
  version: 5,
  name: "学期管理",
  up(db) {
    db.exec(`
      CREATE TABLE terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);
  }
};
