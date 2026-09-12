// v7：操作审计日志（记录登录用户的关键写操作，仅 admin 可查看）
module.exports = {
  version: 7,
  name: "操作审计日志",
  up(db) {
    db.exec(`
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
      CREATE INDEX idx_audit_logs_time ON audit_logs(created_at);
    `);
  }
};
