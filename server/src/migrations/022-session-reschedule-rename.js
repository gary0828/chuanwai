// v22：课次「调课」→「挪课」术语改名（纯改名，无结构/行为变化）
//
// 背景（为什么改）：系统里存在两套「课表」和两套「调课」，用户无法区分：
//   1. 两套课表 —— schedules 表是「每周重复的排课模板」（一条记录管一学期）；
//      class_sessions 表是「某天某节的具体课次实例」（一节课一条）。
//   2. 两套调课 ——「数据管理 → 调课审批」（schedule_adjustments）改的是长期排课模板，
//      审批通过后以后每周都变；而课次维度的调课只是把「某一节」挪到另一个时段。
//
// 两者语义完全不同却共用一个词，是用户认知混淆的主要来源。因此产品侧拍板：
//   课次维度的「调课」统一改称「挪课」（只挪某一节），「调课审批」保持原名不动。
//
// 本迁移落地数据层的改名：
//   1. class_sessions.status：'已调课' → '已挪课'
//   2. class_sessions.origin：'调课'   → '挪课'
//   3. 重建 class_sessions 以更新两处 CHECK 约束（SQLite 无法直接改 CHECK）
//
// ★ 顺序说明：不能「先 UPDATE 再重建」。SQLite 的 CHECK 对 UPDATE 同样生效，
//   旧表的 CHECK 仍写着 '已调课'，直接 UPDATE 成 '已挪课' 会被旧约束拒绝。
//   因此改名在「拷进新表」这一步用 CASE 完成（新表 CHECK 已是新字面量），
//   建完再补一条「旧值残留 = 0」的断言兜底。
//
// ★ 影响面极小：本地库 114 条课次中仅 2 条 status='已调课'、2 条 origin='调课'。
// ★ 只改枚举字面量与 CHECK，列名 / 类型 / 索引 / 唯一键 / 外键全部保持原样。
// ★ 声明 disableForeignKeys：class_sessions 有自引用 related_session_id，
//    重建（DROP + RENAME）时必须关闭外键，否则自引用与其它表的外键会被级联破坏。
const PERIOD_MIN = 1;
const PERIOD_MAX = 8;

module.exports = {
  version: 22,
  name: "课次「调课」改称「挪课」（status/origin 枚举值 + CHECK 约束，重建 class_sessions）",
  disableForeignKeys: true,
  up(db) {
    // ── 1) 重建 class_sessions：仅两处 CHECK 的字面量变化，其余照抄 v21 ────
    //      存量改名在 INSERT 时用 CASE 完成（旧表 CHECK 会拒绝直接 UPDATE）
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
  period                INTEGER NOT NULL CHECK (period BETWEEN ${PERIOD_MIN} AND ${PERIOD_MAX}),
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
         end_time,
         CASE status WHEN '已调课' THEN '已挪课' ELSE status END,
         CASE origin  WHEN '调课'   THEN '挪课'   ELSE origin  END,
         related_session_id, topic, created_at, updated_at
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

    // ── 2) 改名彻底性断言：旧字面量必须一条不剩 ───────────────────────────
    const leftStatus = db.prepare("SELECT COUNT(*) AS c FROM class_sessions WHERE status = '已调课'").get().c;
    const leftOrigin = db.prepare("SELECT COUNT(*) AS c FROM class_sessions WHERE origin = '调课'").get().c;
    if (Number(leftStatus) !== 0 || Number(leftOrigin) !== 0) {
      throw new Error(
        `课次改名不彻底：残留 status='已调课' ${leftStatus} 条、origin='调课' ${leftOrigin} 条`
      );
    }

    // ── 4) 外键完整性校验（非空即 throw，落库失败整体回滚）──────────────────
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
