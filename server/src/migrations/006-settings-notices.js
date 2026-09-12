// v6：系统参数 + 通知公告
// settings：键值对（预警默认阈值、当前学期等），仅 admin 读写
// notices：公告（全员可见，admin 发布）
module.exports = {
  version: 6,
  name: "系统参数与通知公告",
  up(db) {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        creator_id INTEGER REFERENCES users(id),
        is_top INTEGER NOT NULL DEFAULT 0 CHECK(is_top IN (0, 1)),
        status TEXT NOT NULL DEFAULT '发布' CHECK(status IN ('发布','下架')),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      -- 预置系统参数默认值
      INSERT INTO settings (key, value) VALUES
        ('warn_rate', '80'),
        ('warn_consecutive', '3'),
        ('warn_days', '14'),
        ('term_id', '');
    `);
  }
};
