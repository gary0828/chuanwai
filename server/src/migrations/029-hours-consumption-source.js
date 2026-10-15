// v29：课时流水加「来源」与「考勤关联」—— 为「对账式扣课」提供数据基础
//
// 背景（2026-10-12 真实事故）：
//   用户反馈「学生耗课后，报班管理里的课时剩余没有变化」。实查数据库 + 审计日志还原出：
//     · 学员从「线索转化」建单 → 订单 total_hours/remain_hours 均为 0（转化不带课时包）
//     · 随后点名考勤「正常」→ 扣减匹配条件是「在读 + 同课程 + total_hours > 0」
//       → 匹配不到 → **静默跳过，无任何提示**
//     · 用户事后手工把剩余课时 0 → 16 补上，但**已点名的考勤不会补扣**（错过即永久漏扣）
//   根因不是某一处代码写错，而是**扣减的触发模型**：扣课只在「考勤状态发生变化的那一瞬间」
//   发生（事件式），而不是「该次考勤是否已经扣过课时」（状态式）。
//   凡是事件丢失的场景（先点名后报班、事后补课时包、订单退班后又改回在读……）都会永久漏扣。
//
//   要改成对账式，就必须能回答一个问题：**「这条流水，是哪条考勤产生的？」**
//   而原表的字段只有 (student_id, course_id, date) —— 与补课流水完全同形，无法区分来源。
//   故本迁移补上两个字段：
//
//     1. `source`       —— 流水来源（考勤 / 补课 / 请假 / 手工调整 / 对账修正）
//     2. `attendance_id` —— 考勤扣减对应的考勤记录 id（精确 1:1，老数据为 NULL）
//
// 为什么用 ADD COLUMN 而不是重建表：
//   `type` 的 CHECK 约束仍是 ('扣减','回补') —— 对账修正复用这两个值、靠 `source` 区分来源，
//   因此**不需要改任何约束**，ADD COLUMN 是纯元数据操作，对既有行零风险、零拷贝
//   （与 v27 的选择一致；重建表只在必须改 CHECK 时才必要，见 v24）。
//
// ★ 历史流水的 source 回填是**近似**的：
//   老数据没记来源，只能按「(学员,课程,日期) 能否对上补课单 / 请假单」反推，
//   对不上的统一记为「考勤」。对账函数据此采用**宽松匹配**（老流水靠日期判定已扣），
//   宁可"少补"也不"重复扣" —— 详见 utils/hours-reconcile.js 的注释。
module.exports = {
  version: 29,
  name: "课时流水加来源（source）与考勤关联（attendance_id），支撑对账式扣课",
  up(db) {
    // ── 1. 加列 ─────────────────────────────────────────────────────────
    db.exec(`
      ALTER TABLE hour_consumptions ADD COLUMN source TEXT NOT NULL DEFAULT '';
      ALTER TABLE hour_consumptions ADD COLUMN attendance_id INTEGER;
    `);

    // ★ 索引必要性：对账要按考勤反查流水（每条出勤考勤都要问一次"扣过没"），
    //   没有索引时是 O(考勤数 × 流水数)。
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_hour_cons_att ON hour_consumptions(attendance_id);`
    );

    // ── 2. 回填历史流水的来源 ───────────────────────────────────────────
    // 顺序很关键：先"补课"后"请假"，最后兜底"考勤"（越具体越先判）。
    // 全部用 SQL 完成，不引入逐行循环（本项目流水已 680+ 条，且今后会持续增长）。

    // 2.1 能对上补课单的 → 补课
    db.exec(`
      UPDATE hour_consumptions
      SET source = '补课'
      WHERE source = ''
        AND EXISTS (
          SELECT 1 FROM makeup_classes mk
          WHERE mk.student_id = hour_consumptions.student_id
            AND mk.course_id = hour_consumptions.course_id
            AND mk.makeup_date = hour_consumptions.date
        );
    `);

    // 2.2 「回补」且日期落在某条已通过的请假单范围内 → 请假
    db.exec(`
      UPDATE hour_consumptions
      SET source = '请假'
      WHERE source = ''
        AND type = '回补'
        AND EXISTS (
          SELECT 1 FROM leaves l
          WHERE l.student_id = hour_consumptions.student_id
            AND l.status = '通过'
            AND hour_consumptions.date >= l.start_date
            AND hour_consumptions.date <= l.end_date
        );
    `);

    // 2.3 其余一律兜底为「考勤」
    //     ★ 局限（已记录在案）：手工调整订单课时产生的流水会被误标为「考勤」。
    //       影响可控 —— 手工调整的 date 是"调整当天"，而当天通常没有该课程的出勤考勤，
    //       宽松匹配按 (学员,课程,日期) 判定，撞上的概率极低；一旦撞上只会**少补**，不会重复扣。
    db.exec(`
      UPDATE hour_consumptions SET source = '考勤' WHERE source = '';
    `);

    // ── 3. 一致性自检：不允许存在 source 为空的流水 ─────────────────────
    const left = db
      .prepare("SELECT COUNT(*) AS c FROM hour_consumptions WHERE source = ''")
      .get().c;
    if (left > 0) {
      throw new Error(`迁移 v29 回填不完整：仍有 ${left} 条流水 source 为空`);
    }

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
