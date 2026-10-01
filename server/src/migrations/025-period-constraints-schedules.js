// v25：补漏 —— `schedules` 与 `schedule_adjustments` 的节次约束同样要放开
//
// 背景（2026-10-01）：
//   v24 把 `period_times` 与 `class_sessions` 的「固定 1–8」放开了，但**漏了两张也带节次列的表**：
//     · `schedules.period`（排课模板）—— 4 个 CHECK 里的一个
//     · `schedule_adjustments.from_period / to_period`（调课申请的源/目标节次）
//   结果：节次时间表能加到第 90 节，但一排课就撞 `CHECK constraint failed`
//   （被 `constraintMessage` 翻译成"字段取值不在允许范围内"，看不出真因）。
//
//   ★ 教训：横向扫描要 **grep 所有含该字段的表**（`PRAGMA table_info` 全库扫），
//     不能只凭印象改"我记得的那几张"。本文件即该教训的产物。
//
// 为什么必须是新迁移而不是改 v24：
//   v24 已在真库执行完毕，迁移执行器按 `user_version` 跳过已执行版本 —— 改它不会重跑。
//
// 口径与 v24 一致：`period >= 1`（只保底、不封顶）；`day_of_week` 仍为 1–7（星期是固定的）。
// ★ 声明 disableForeignKeys：schedule_adjustments 引用 schedules，重建期间需关闭外键。
module.exports = {
  version: 25,
  name: "补漏：schedules / schedule_adjustments 的节次约束放开（承接 v24）",
  disableForeignKeys: true,
  up(db) {
    // ── 1) 重建 schedules ────────────────────────────────────────────
    const scBefore = db.prepare("SELECT COUNT(*) AS c FROM schedules").get().c;
    db.exec(`
CREATE TABLE schedules_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period      INTEGER NOT NULL CHECK (period >= 1),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  room_id     INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  UNIQUE (class_id, course_id, day_of_week, period)
);
INSERT INTO schedules_new (id, class_id, course_id, day_of_week, period, created_at, room_id)
  SELECT id, class_id, course_id, day_of_week, period, created_at, room_id FROM schedules;
`);
    const scAfter = db.prepare("SELECT COUNT(*) AS c FROM schedules_new").get().c;
    if (Number(scBefore) !== Number(scAfter)) {
      throw new Error(`schedules 重建行数比对失败：重建前 ${scBefore} ≠ 重建后 ${scAfter}`);
    }
    db.exec(`
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
DELETE FROM sqlite_sequence WHERE name = 'schedules';
INSERT INTO sqlite_sequence (name, seq) SELECT 'schedules', COALESCE(MAX(id),0) FROM schedules;
CREATE INDEX idx_schedules_class_day ON schedules (class_id, day_of_week);
`);

    // ── 2) 重建 schedule_adjustments（源/目标节次都要放开）──────────────
    const adjBefore = db.prepare("SELECT COUNT(*) AS c FROM schedule_adjustments").get().c;
    db.exec(`
CREATE TABLE schedule_adjustments_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id      INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  course_id        INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  from_day_of_week INTEGER NOT NULL CHECK (from_day_of_week BETWEEN 1 AND 7),
  from_period      INTEGER NOT NULL CHECK (from_period >= 1),
  to_day_of_week   INTEGER NOT NULL CHECK (to_day_of_week BETWEEN 1 AND 7),
  to_period        INTEGER NOT NULL CHECK (to_period >= 1),
  reason           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT '待审批' CHECK (status IN ('待审批', '通过', '驳回')),
  apply_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approve_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  apply_time       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  approve_time     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
INSERT INTO schedule_adjustments_new (id, schedule_id, class_id, course_id, from_day_of_week,
       from_period, to_day_of_week, to_period, reason, status, apply_user_id, approve_user_id,
       apply_time, approve_time, created_at)
  SELECT id, schedule_id, class_id, course_id, from_day_of_week,
         from_period, to_day_of_week, to_period, reason, status, apply_user_id, approve_user_id,
         apply_time, approve_time, created_at FROM schedule_adjustments;
`);
    const adjAfter = db.prepare("SELECT COUNT(*) AS c FROM schedule_adjustments_new").get().c;
    if (Number(adjBefore) !== Number(adjAfter)) {
      throw new Error(`schedule_adjustments 重建行数比对失败：重建前 ${adjBefore} ≠ 重建后 ${adjAfter}`);
    }
    db.exec(`
DROP TABLE schedule_adjustments;
ALTER TABLE schedule_adjustments_new RENAME TO schedule_adjustments;
DELETE FROM sqlite_sequence WHERE name = 'schedule_adjustments';
INSERT INTO sqlite_sequence (name, seq) SELECT 'schedule_adjustments', COALESCE(MAX(id),0) FROM schedule_adjustments;
CREATE INDEX idx_adj_status   ON schedule_adjustments (status);
CREATE INDEX idx_adj_class    ON schedule_adjustments (class_id);
CREATE INDEX idx_adj_schedule ON schedule_adjustments (schedule_id);
`);

    // ── 3) 全库断言：不允许再有任何表残留「period BETWEEN 1 AND 8」────────
    const leftovers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%BETWEEN 1 AND 8%'")
      .all()
      .filter(r => /period\s+BETWEEN\s+1\s+AND\s+8|period\s+INTEGER[^,)]*BETWEEN\s+1\s+AND\s+8/i.test(
        db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(r.name).sql || ""
      ));
    if (leftovers.length > 0) {
      throw new Error(`仍有表锁着节次 1–8：${leftovers.map(r => r.name).join(", ")}`);
    }

    // ── 4) 外键完整性校验 ────────────────────────────────────────────
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
