// v27：智能题库 · 回收站（软删）+ 质量分口径明确
//
// 背景（2026-10-07）：
//   一期上线后做缺口盘点，发现两处问题：
//     ① 删题是 `DELETE FROM questions` **硬删** —— 老师误删无法找回。
//        题库是长期积累的资产，一道好题可能是老师花 10 分钟录的，
//        硬删的代价远大于多存一行。
//     ② `quality_score` 字段存在但**永远是 NULL** —— 一期只建了字段没写逻辑。
//
// 本次改动：
//   1. `questions` 加 `deleted_at` / `deleted_by` —— 软删标记。
//      · `deleted_at IS NULL` = 正常题；非空 = 在回收站。
//      · ★ 配套要求：**所有既有查询都必须加 `deleted_at IS NULL`**，
//        否则已删的题会重新出现在列表/查重/导出/统计里。
//        横向扫过：`routes/qbank.js` 18 处 + `routes/qbank-ocr.js` 3 处，
//        共 21 处，已全部加过滤（漏一处就是数据泄漏）。
//   2. `quality_score` 口径定为**录入完整度**（0–1）：
//      「有解析 / 有知识点 / 有解题方法 / 有难度标注 / 来源非空」各计 0.2。
//      ★ 为什么不是"真实质量分"：真正的质量要看学生作答正确率，
//        那要等四期学情反哺。现在能算且有意义的只有"这道题填得全不全"，
//        它能帮老师发现待完善的题（填得越全，后续组卷越好用）。
//
// 为什么用 ADD COLUMN 而不是重建表：
//   questions 无 CHECK 约束涉及 deleted_at，ADD COLUMN 是纯元数据操作，
//   对既有行零风险、零拷贝。重建表只在「要改 CHECK 约束」时才必要（见 v24）。
//
// 为什么必须是新迁移而不是改 026：
//   迁移执行器按 `user_version` 跳过已执行版本，改旧文件不会重跑。
module.exports = {
  version: 27,
  name: "智能题库：questions 加软删标记（回收站）+ 质量分口径落地",
  up(db) {
    // ── 1. 软删标记 ──────────────────────────────────────────────────
    // SQLite 的 ADD COLUMN 默认值有限制（不能是表达式、不能 NOT NULL 无默认），
    // 这里两列都可空、默认 NULL，最简且语义清晰。
    db.exec(`
      ALTER TABLE questions ADD COLUMN deleted_at TEXT;
      ALTER TABLE questions ADD COLUMN deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);

    // ★ 索引必要性：列表/查重/导出**每一条查询**都带 `deleted_at IS NULL`，
    //   没有索引时这个条件要全表扫。单列索引让 SQLite 能直接把
    //   「未删的题」作为驱动集（配合其它条件时也更易选出好计划）。
    db.exec(`CREATE INDEX idx_q_deleted ON questions(deleted_at);`);

    // ── 2. 回填既有行的质量分 ────────────────────────────────────────
    // 存量题的质量分一次算清，避免"老题永远空着、只有新题有分"的不一致。
    //
    // ★★ 口径：**只算三个"可选"维度**，各占 1/3：
    //      有解析 / 有知识点 / 有解题方法
    //
    //   为什么**不**把"难度"和"来源"算进去（初版曾算，已纠正）：
    //   这两列是表约束保证的（`difficulty NOT NULL DEFAULT 3`、`source` 必填受限枚举），
    //   任何一行都满足 → 计入后**最低分变成 0.4**，老师看到"我什么都没填却有 40 分"会困惑，
    //   而且真实区分度只剩 0.4~1.0 三段。剔除它们后：0 = 三项全空、1 = 三项全填，一目了然。
    //
    //   ★ 配图**不计入**：只有几何/函数图像类题目需要图，它是"按需"而非"应填"，
    //     计入会惩罚那些本来不需要配图的题。
    //
    // ★ 与后端 `computeQualityScore()` 的口径必须**逐字一致**（改动时两处同步）。
    db.exec(`
      UPDATE questions
         SET quality_score =
               (CASE WHEN TRIM(analysis) != '' THEN 1.0 / 3 ELSE 0 END)
             + (CASE WHEN kp_ids != '[]' AND TRIM(kp_ids) != '' THEN 1.0 / 3 ELSE 0 END)
             + (CASE WHEN TRIM(solve_method) != '' THEN 1.0 / 3 ELSE 0 END)
       WHERE deleted_at IS NULL;
    `);
  }
};
