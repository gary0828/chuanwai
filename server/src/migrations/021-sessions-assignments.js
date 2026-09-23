// v21：课次实体与任课关系（G1 + G2）
//
// 背景：系统此前只有「排课模板」（schedules：班级 × 星期几 × 节次），没有「课次实例」
// （2026-09-23 周三第 3 节这一节具体的课）。导致教室冲突 / 代课 / 停课 / 教学进度都
// 没有载体，考勤与课评的唯一键是 (学员, 课程, 日期)，「同一课程同一天两节」第二节课签不进；
// 且系统里根本没有「谁教哪个班哪门课」这张表，任课教师看不到自己教的班。
//
// 本迁移落地「课次实例」这一教学事件枢纽，并把考勤 / 课消 / 课评 / 补课改挂它，同时建立任课关系：
//   1. period_times          节次时间表（独立结构化配置，非 settings KV）
//   2. teaching_assignments  任课关系（班级 × 课程 × 教师(可空) × 学期(可空)）
//   3. class_sessions        课次实例（唯一键 class_id + session_date + period）
//   4. session_migration_report 历史回填报告（只落「未匹配」，「已匹配」由差值算）
//   5. 重建 attendances       + session_id，唯一键改为 Q7 双条件部分唯一索引
//   6. 重建 class_evaluations + session_id，唯一键改为 Q7 双条件部分唯一索引
//   7. hour_consumptions / makeup_classes 加列（不重建）
//
// ★ 迁移只加列、不回填：历史行此时无课次可挂，全部落在 legacy 部分索引分区（session_id IS NULL）。
//   回填在「生成本学期课次」后的独立步骤执行（幂等、可重跑，失败显式进报告）。
// ★ 节次固定在 1–8，不放宽（Q3）。声明 disableForeignKeys（重建 attendances / class_evaluations）。
const PERIOD_MIN = 1;
const PERIOD_MAX = 8;

module.exports = {
  version: 21,
  name: "课次实体与任课关系（period_times / teaching_assignments / class_sessions / session_migration_report + 四表挂 session_id）",
  disableForeignKeys: true,
  up(db) {
    // ── 1) 节次时间表（独立表，非 settings KV）──────────────────────────────
    db.exec(`
CREATE TABLE period_times (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  period     INTEGER NOT NULL UNIQUE CHECK (period BETWEEN ${PERIOD_MIN} AND ${PERIOD_MAX}),
  start_time TEXT NOT NULL DEFAULT '',
  end_time   TEXT NOT NULL DEFAULT '',
  label      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT INTO period_times (period, start_time, end_time, label) VALUES
  (1,'08:00','08:45','第1节'),(2,'08:55','09:40','第2节'),
  (3,'10:00','10:45','第3节'),(4,'10:55','11:40','第4节'),
  (5,'14:00','14:45','第5节'),(6,'14:55','15:40','第6节'),
  (7,'16:00','16:45','第7节'),(8,'16:55','17:40','第8节');
`);

    // ── 2) 任课关系（班级 × 课程 × 教师 × 学期）────────────────────────────
    db.exec(`
CREATE TABLE teaching_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  term_id    INTEGER REFERENCES terms(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (class_id, course_id, term_id)
);
-- term_id 可空时 SQLite UNIQUE 不约束 NULL，补一条部分唯一索引防「长期有效」重复
CREATE UNIQUE INDEX ux_ta_no_term ON teaching_assignments(class_id, course_id) WHERE term_id IS NULL;
CREATE INDEX idx_ta_class   ON teaching_assignments(class_id);
CREATE INDEX idx_ta_teacher ON teaching_assignments(teacher_id);
`);

    // ── 3) 课次实例 ────────────────────────────────────────────────────────
    db.exec(`
CREATE TABLE class_sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id               INTEGER REFERENCES terms(id)      ON DELETE SET NULL,
  schedule_id           INTEGER REFERENCES schedules(id)  ON DELETE SET NULL,
  class_id              INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id             INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  substitute_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room_id               INTEGER,
  session_date          TEXT NOT NULL,
  period                INTEGER NOT NULL CHECK (period BETWEEN ${PERIOD_MIN} AND ${PERIOD_MAX}),
  start_time            TEXT NOT NULL DEFAULT '',
  end_time              TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT '待上课'
                          CHECK (status IN ('待上课','已上课','已停课','已调课','已取消')),
  origin                TEXT NOT NULL DEFAULT '模板生成'
                          CHECK (origin IN ('模板生成','调课','补课','手工')),
  related_session_id    INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  topic                 TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (class_id, session_date, period)
);
CREATE INDEX idx_cs_date          ON class_sessions(session_date);
CREATE INDEX idx_cs_class_date    ON class_sessions(class_id, session_date);
CREATE INDEX idx_cs_teacher_date  ON class_sessions(teacher_id, session_date);
CREATE INDEX idx_cs_sub_teacher   ON class_sessions(substitute_teacher_id, session_date);
CREATE INDEX idx_cs_term          ON class_sessions(term_id);
`);

    // ── 4) 回填报告（只落「未匹配」，「已匹配」由差值算）────────────────────
    db.exec(`
CREATE TABLE session_migration_report (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  data_type          TEXT NOT NULL CHECK (data_type IN ('考勤','课消','课评')),
  source_table       TEXT NOT NULL,
  source_id          INTEGER NOT NULL,
  class_id           INTEGER,
  course_id          INTEGER,
  student_id         INTEGER,
  date               TEXT NOT NULL DEFAULT '',
  matched_session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  reason             TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT '未匹配' CHECK (status IN ('未匹配','已转待办')),
  todo_id            INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (source_table, source_id)
);
CREATE INDEX idx_smr_status     ON session_migration_report(status);
CREATE INDEX idx_smr_class_date ON session_migration_report(class_id, date);
`);

    // ── 5) 重建 attendances：+ session_id，唯一键改双条件 ───────────────────
    const attBefore = db.prepare("SELECT COUNT(*) AS c FROM attendances").get().c;
    db.exec(`
CREATE TABLE attendances_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('正常','迟到','早退','缺勤','请假')),
  remark     TEXT NOT NULL DEFAULT '',
  session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT INTO attendances_new (id, student_id, course_id, date, status, remark, created_at, updated_at)
  SELECT id, student_id, course_id, date, status, remark, created_at, updated_at FROM attendances;
`);
    const attAfter = db.prepare("SELECT COUNT(*) AS c FROM attendances_new").get().c;
    if (Number(attBefore) !== Number(attAfter)) {
      throw new Error(`attendances 重建行数比对失败：重建前 ${attBefore} ≠ 重建后 ${attAfter}`);
    }
    db.exec(`
DROP TABLE attendances;
ALTER TABLE attendances_new RENAME TO attendances;
DELETE FROM sqlite_sequence WHERE name = 'attendances';
INSERT INTO sqlite_sequence (name, seq) SELECT 'attendances', COALESCE(MAX(id),0) FROM attendances;
CREATE INDEX idx_attendance_date        ON attendances(date);
CREATE INDEX idx_attendance_course_date ON attendances(course_id, date);
CREATE INDEX idx_attendance_session     ON attendances(session_id, student_id);
CREATE UNIQUE INDEX ux_attendance_legacy  ON attendances(student_id, course_id, date) WHERE session_id IS NULL;
CREATE UNIQUE INDEX ux_attendance_session ON attendances(session_id, student_id)         WHERE session_id IS NOT NULL;
`);

    // ── 6) 重建 class_evaluations：+ session_id，唯一键改双条件 ─────────────
    const ceBefore = db.prepare("SELECT COUNT(*) AS c FROM class_evaluations").get().c;
    db.exec(`
CREATE TABLE class_evaluations_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id     INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  eval_date     TEXT NOT NULL,
  session_id    INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  session_no    INTEGER NOT NULL DEFAULT 0,
  focus         INTEGER NOT NULL DEFAULT 3 CHECK (focus BETWEEN 1 AND 5),
  participation INTEGER NOT NULL DEFAULT 3 CHECK (participation BETWEEN 1 AND 5),
  mastery       INTEGER NOT NULL DEFAULT 3 CHECK (mastery BETWEEN 1 AND 5),
  teacher_note  TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT INTO class_evaluations_new (id, class_id, course_id, student_id, eval_date, session_no,
                                   focus, participation, mastery, teacher_note, created_by, created_at, updated_at)
  SELECT id, class_id, course_id, student_id, eval_date, session_no,
         focus, participation, mastery, teacher_note, created_by, created_at, updated_at FROM class_evaluations;
`);
    const ceAfter = db.prepare("SELECT COUNT(*) AS c FROM class_evaluations_new").get().c;
    if (Number(ceBefore) !== Number(ceAfter)) {
      throw new Error(`class_evaluations 重建行数比对失败：重建前 ${ceBefore} ≠ 重建后 ${ceAfter}`);
    }
    db.exec(`
DROP TABLE class_evaluations;
ALTER TABLE class_evaluations_new RENAME TO class_evaluations;
DELETE FROM sqlite_sequence WHERE name = 'class_evaluations';
INSERT INTO sqlite_sequence (name, seq) SELECT 'class_evaluations', COALESCE(MAX(id),0) FROM class_evaluations;
CREATE INDEX idx_ce_class_date   ON class_evaluations(class_id, eval_date);
CREATE INDEX idx_ce_student_date ON class_evaluations(student_id, eval_date);
CREATE INDEX idx_ce_session      ON class_evaluations(session_id, student_id);
CREATE UNIQUE INDEX ux_ce_legacy  ON class_evaluations(student_id, course_id, eval_date) WHERE session_id IS NULL;
CREATE UNIQUE INDEX ux_ce_session ON class_evaluations(session_id, student_id)          WHERE session_id IS NOT NULL;
`);

    // ── 7) hour_consumptions / makeup_classes 加列（不重建）────────────────
    db.exec(`
ALTER TABLE hour_consumptions ADD COLUMN session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL;
CREATE INDEX idx_hour_cons_session ON hour_consumptions(session_id);
ALTER TABLE makeup_classes ADD COLUMN original_session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL;
ALTER TABLE makeup_classes ADD COLUMN makeup_session_id   INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL;
`);

    // ── 8) 外键完整性校验（非空即 throw，落库失败整体回滚）──────────────────
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
