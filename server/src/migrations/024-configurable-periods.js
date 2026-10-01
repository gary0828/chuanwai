// v24：节次可配置 —— 去掉「固定 1–8」的锁（校区反馈：机构不是学校，节次数量与时间要能自定义）
//
// 背景（2026-10-01 用户反馈）：
//   「因为我们是机构，不能像学校一样固定 8 节课，希望做成可个性化创建节次数量和时间」。
//   而 v21 设计时拍过板「节次固定 1–8（Q3）」，本次按项目门禁**显式修订**（新 ADR 记录，
//   并在 `docs/04-API/API.md` 改掉那句表述）。
//
// 为什么必须重建表：
//   `period` 的 CHECK 约束写在**表定义**里，SQLite **不支持 ALTER 修改 CHECK** →
//   只能 `重建 + INSERT SELECT + DROP + RENAME`（与 v22 同一套模式，已验证可靠）。
//
// 新的约束口径（用户拍板「不限」）：
//   - `period >= 1` **只保底、不封顶**（避免 0 / 负数这种明显非法的值，但不限制上限）
//   - `UNIQUE(period)`（period_times）与 `UNIQUE(class_id, session_date, period)`（class_sessions）**保留**
//   - ★ 前端「新增节次」是逐个手动添加（不会批量误加），且可删除，故不设上限是可接受的
//
// ★ 声明 disableForeignKeys：class_sessions 有自引用 related_session_id，
//   重建（DROP + RENAME）时必须关闭外键，否则自引用与其它表的外键会被级联破坏。
module.exports = {
  version: 24,
  name: "节次可配置（去掉 period 的固定 1–8 约束，重建 class_sessions / period_times）",
  disableForeignKeys: true,
  up(db) {
    // ── 1) 重建 period_times：仅 CHECK 字面量变化，其余照抄 v21 ──────────────
    const ptBefore = db.prepare("SELECT COUNT(*) AS c FROM period_times").get().c;
    db.exec(`
CREATE TABLE period_times_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  period     INTEGER NOT NULL UNIQUE CHECK (period >= 1),
  start_time TEXT NOT NULL DEFAULT '',
  end_time   TEXT NOT NULL DEFAULT '',
  label      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT INTO period_times_new (id, period, start_time, end_time, label, updated_at)
  SELECT id, period, start_time, end_time, label, updated_at FROM period_times;
`);
    const ptAfter = db.prepare("SELECT COUNT(*) AS c FROM period_times_new").get().c;
    if (Number(ptBefore) !== Number(ptAfter)) {
      throw new Error(`period_times 重建行数比对失败：重建前 ${ptBefore} ≠ 重建后 ${ptAfter}`);
    }
    db.exec(`
DROP TABLE period_times;
ALTER TABLE period_times_new RENAME TO period_times;
DELETE FROM sqlite_sequence WHERE name = 'period_times';
INSERT INTO sqlite_sequence (name, seq) SELECT 'period_times', COALESCE(MAX(id),0) FROM period_times;
`);

    // ── 2) 重建 class_sessions：仅 period 的 CHECK 变化，其余列 / 索引 / 唯一键照抄 v22 ──
    const csBefore = db.prepare("SELECT COUNT(*) AS c FROM class_sessions").get().c;
    db.exec(`
CREATE TABLE class_sessions_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id               INTEGER REFERENCES terms(id)      ON DELETE SET NULL,
  schedule_id           INTEGER REFERENCES schedules(id)  ON DELETE SET NULL,
  class_id              INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id             INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  substitute_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room_id               INTEGER,
  session_date          TEXT NOT NULL,
  period                INTEGER NOT NULL CHECK (period >= 1),
  start_time            TEXT NOT NULL DEFAULT '',
  end_time              TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT '待上课'
                          CHECK (status IN ('待上课','已上课','已停课','已挪课','已取消')),
  origin                TEXT NOT NULL DEFAULT '模板生成'
                          CHECK (origin IN ('模板生成','挪课','补课','手工')),
  related_session_id    INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  topic                 TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (class_id, session_date, period)
);
INSERT INTO class_sessions_new (id, term_id, schedule_id, class_id, course_id, teacher_id,
                                substitute_teacher_id, room_id, session_date, period, start_time,
                                end_time, status, origin, related_session_id, topic, created_at, updated_at)
  SELECT id, term_id, schedule_id, class_id, course_id, teacher_id,
         substitute_teacher_id, room_id, session_date, period, start_time,
         end_time, status, origin, related_session_id, topic, created_at, updated_at
    FROM class_sessions;
`);
    const csAfter = db.prepare("SELECT COUNT(*) AS c FROM class_sessions_new").get().c;
    if (Number(csBefore) !== Number(csAfter)) {
      throw new Error(`class_sessions 重建行数比对失败：重建前 ${csBefore} ≠ 重建后 ${csAfter}`);
    }
    db.exec(`
DROP TABLE class_sessions;
ALTER TABLE class_sessions_new RENAME TO class_sessions;
DELETE FROM sqlite_sequence WHERE name = 'class_sessions';
INSERT INTO sqlite_sequence (name, seq) SELECT 'class_sessions', COALESCE(MAX(id),0) FROM class_sessions;
CREATE INDEX idx_cs_date          ON class_sessions(session_date);
CREATE INDEX idx_cs_class_date    ON class_sessions(class_id, session_date);
CREATE INDEX idx_cs_teacher_date  ON class_sessions(teacher_id, session_date);
CREATE INDEX idx_cs_sub_teacher   ON class_sessions(substitute_teacher_id, session_date);
CREATE INDEX idx_cs_term          ON class_sessions(term_id);
`);

    // ── 3) 约束放开断言：确认新表不再限制上限（写入一个 >8 的节次后回滚式自检）──
    //      不做真实写入，改为直接检查建表 SQL 里是否还残留 "BETWEEN 1 AND 8"
    const ptSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='period_times'")
      .get().sql;
    const csSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='class_sessions'")
      .get().sql;
    if (/BETWEEN\s+1\s+AND\s+8/i.test(ptSql) || /BETWEEN\s+1\s+AND\s+8/i.test(csSql)) {
      throw new Error("约束放开不彻底：建表 SQL 里仍残留 period BETWEEN 1 AND 8");
    }

    // ── 4) 外键完整性校验（非空即 throw，落库失败整体回滚）──────────────────
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
