// v30：① 课次支持「一节课 = 多课时」 ② 学员档案支持软删除
//
// ── 一、为什么加 class_sessions.hours ─────────────────────────────────────
//   此前「一节课扣几个课时」是**硬编码 1**，写死在 6 处 SQL 里
//   （attendance:184/188、leaves:153、makeups:124/127/179、hours-reconcile:151）。
//   现实里有「两节连上算 2 课时」「晚自习算 0.5 课时」这类排课，
//   一旦有人按节次×2 卖给家长，账就对不上。
//
//   取值层次（用户 2026-10-18 拍板）：**按课次设**。
//   · 课次是"实际发生的这一节课"，课时数理应挂在课次上；
//   · 课程 / 排课模板只提供默认值（生成时写 1），不做继承覆写链 —— 少一层继承少一类歧义。
//   · 历史课次一律默认 1，**行为与 v29 完全一致**（这是本迁移不改变任何既有数字的前提）。
//
//   课时包口径不变：orders.total_hours 仍是「可上多少课时」，
//   一节课扣 `class_sessions.hours`。买 40 课时、上 20 次两课时课，刚好用完。
//
// ── 二、为什么加 students.deleted_at ──────────────────────────────────────
//   此前删学员是**硬删**，会按外键 CASCADE 连带清空考勤、请假、补课、课时流水、
//   通知、考试成绩、课堂评价、知识点测评、成长档案 —— 教务数据通常需要留档，
//   硬删之后「这个孩子以前上过什么课」永久查不到，且无法撤销。
//
//   软删口径（用户 2026-10-18 拍板）：
//   · 列表默认隐藏，可用「已删除」筛选查看，管理员可恢复；
//   · **历史数据全部保留** —— 财务、考勤、课消统计照常包含已删学员，
//     已发生的教学服务不能因为"档案删了"就从报表里消失。
//
//   因此本迁移 **只加标记字段，不加任何 CASCADE / 级联影响**。
//   `deleted_at` 为 NULL = 在看；非 NULL = 已删（存删除时间，便于追溯）。
//
// ── 三、为什么用 ADD COLUMN 而不是重建表 ─────────────────────────────────
//   两处都只是"多一个带默认值的列"，不涉及 CHECK 约束变更 → ADD COLUMN 是纯元数据操作，
//   对既有行零拷贝、零风险（与 v27 / v29 的选择一致）。
module.exports = {
  version: 30,
  name: "课次课时数（class_sessions.hours）+ 学员软删（students.deleted_at）",
  up(db) {
    // ── 1. 课次课时数 ───────────────────────────────────────────────────
    db.exec(`
      ALTER TABLE class_sessions ADD COLUMN hours REAL NOT NULL DEFAULT 1;
    `);

    // 防御：不允许出现 0 或负数课时（0 会让"上过课却不扣课时"变成静默漏洞）
    const badHours = db
      .prepare("SELECT COUNT(*) AS c FROM class_sessions WHERE hours <= 0")
      .get().c;
    if (badHours > 0) {
      throw new Error(`迁移 v30 失败：有 ${badHours} 条课次 hours <= 0`);
    }

    // ── 2. 学员软删标记 ─────────────────────────────────────────────────
    db.exec(`
      ALTER TABLE students ADD COLUMN deleted_at TEXT DEFAULT NULL;
    `);

    // ★ 索引必要性：学员列表 / 下拉的默认条件是 `deleted_at IS NULL`，
    //   这两个接口是最高频查询，且 students 表会随校区运营持续增长。
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_students_deleted ON students(deleted_at);`
    );

    // ── 3. 一致性自检 ───────────────────────────────────────────────────
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
