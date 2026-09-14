// v16：使用反馈
// 教师 / 管理员在使用系统过程中提交问题与建议，admin 汇总查看并跟踪处理结果。
// 设计说明：
// - 只记录提交人（user_id / username / user_role），用于定位「谁在什么角色下遇到问题」；
// - 不记录任何学员数据，避免反馈内容成为绕过权限的数据出口；
// - status 只允许「待处理 / 处理中 / 已处理 / 已忽略」四种取值，由后端白名单校验。
module.exports = {
  version: 16,
  name: "使用反馈",
  up(db) {
    db.exec(`
      CREATE TABLE feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        username TEXT NOT NULL DEFAULT '',
        user_role TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '其他',
        content TEXT NOT NULL,
        page_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '待处理',
        admin_reply TEXT NOT NULL DEFAULT '',
        handled_by INTEGER,
        handled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_feedbacks_status ON feedbacks(status);
      CREATE INDEX idx_feedbacks_user ON feedbacks(user_id);
      CREATE INDEX idx_feedbacks_time ON feedbacks(created_at);
    `);

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
