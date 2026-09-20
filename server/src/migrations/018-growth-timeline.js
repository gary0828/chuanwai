// v18：学生成长时间轴（AI 工作台「成长路径」的数据地基）
//
// 背景（2026-09-20 拍板）：
// 目标不是「一份当前状态报告」，而是「一条成长轨迹」——能看到每个学生从 0 到成功的每一步，
// 每一步都有多维数据支撑。现有模型撑不起这个目标：
// - attendances / exam_scores / hour_consumptions 虽有时间字段，但只覆盖「发生了没有」与「考了多少」；
// - 课堂表现（老师最主观、信息量最大的一维）与知识点掌握（学情分析的正统抓手）完全没有；
// - 工作台现有的 Student 契约里 `eval` 是单条对象、`kpMastery` 是单一快照，
//   第 2 次记录会覆盖第 1 次，**路径从根上存不下来**。
//
// 设计（四条铁律）：
// 1. **只增不改**：事件一旦写入不可 UPDATE。成长路径的价值在于不可篡改性——
//    「3 月 5 日这孩子还不会全等证明」不能因为 6 月补录数据而改变。
// 2. **新增不改旧**：出勤/成绩/课时三张业务表**一张都不动**，业务逻辑零回归风险。
//    需要时间轴时由后端把三表 UNION 进同一视图，与新增事件合并。
// 3. **一张表装所有维度**：event_type 区分维度，payload 存 JSON。
//    新增维度不用改表结构——这是「数据库不会越来越复杂」的关键。
// 4. **payload 不放敏感字段**：不放金额、不放家长电话（对齐 agent.js 既有约定）。
//
// 表清单：
// - student_timeline  成长时间轴（核心，只增不改）
// - knowledge_points  知识点体系（课时级粒度：一个课时 2-4 个知识点）
// - class_evaluations 课堂评价（每课一条，3 维：专注度 / 参与度 / 掌握度）
// - kp_assessments    知识点掌握评定（每课每生每个知识点一条，成长曲线的证据源）
module.exports = {
  version: 18,
  name: "学生成长时间轴",
  up(db) {
    // ── 1. 成长时间轴 ────────────────────────────────────────────────
    // event_type 取值（后端白名单校验，前端不可自由写入）：
    //   attendance      本课出勤情况（由考勤登记自动生成）
    //   exam_score      考试成绩（由录分自动生成）
    //   class_eval      课堂评价（老师课后 10 秒记录）
    //   kp_assessment   知识点掌握评定（老师课后 1 分钟打勾）
    //   hour_change     课时变动（由扣减/回补自动生成，仅记数量不记金额）
    //   milestone       里程碑（由指标引擎识别后写入，非老师手工填写）
    //   note            老师自由备注（预留）
    db.exec(`
      CREATE TABLE student_timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
        occurred_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT 'manual',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_timeline_student_time ON student_timeline(student_id, occurred_at);
      CREATE INDEX idx_timeline_class_time ON student_timeline(class_id, occurred_at);
      CREATE INDEX idx_timeline_type ON student_timeline(event_type);
    `);

    // ── 2. 知识点体系（课时级粒度）──────────────────────────────────
    // 粒度决策（2026-09-20）：章节级太粗看不出进步、知识点级太细老师会放弃，
    // 取中间值——一个课时 2-4 个知识点，老师 1 分钟能打完，也够画成长曲线。
    // parent_id 支持两层：一级=课时/章节，二级=具体知识点（叶子节点挂到考纲）。
    db.exec(`
      CREATE TABLE knowledge_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER REFERENCES knowledge_points(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
        grade TEXT NOT NULL DEFAULT '',
        term_no INTEGER NOT NULL DEFAULT 0,
        unit_no INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL DEFAULT 0,
        difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 5),
        description TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_kp_parent ON knowledge_points(parent_id);
      CREATE INDEX idx_kp_course ON knowledge_points(course_id, unit_no, seq);
    `);

    // ── 3. 课堂评价（每课一条，3 维）────────────────────────────────
    // 维度决策（2026-09-20）：砍掉 demo 里的「作业」维——作业应由作业模块独立记录，
    // 混在课堂评价里既不准也重复。保留老师一眼能判断的 3 个维度。
    // 1-5 分制（3 = 一般），比 0-100 更容易让老师快速判断。
    db.exec(`
      CREATE TABLE class_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        eval_date TEXT NOT NULL,
        session_no INTEGER NOT NULL DEFAULT 0,
        focus INTEGER NOT NULL DEFAULT 3 CHECK (focus BETWEEN 1 AND 5),
        participation INTEGER NOT NULL DEFAULT 3 CHECK (participation BETWEEN 1 AND 5),
        mastery INTEGER NOT NULL DEFAULT 3 CHECK (mastery BETWEEN 1 AND 5),
        teacher_note TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE (student_id, course_id, eval_date)
      );
      CREATE INDEX idx_ce_class_date ON class_evaluations(class_id, eval_date);
      CREATE INDEX idx_ce_student_date ON class_evaluations(student_id, eval_date);
    `);

    // ── 4. 知识点掌握评定（成长曲线的证据源）────────────────────────
    // level 三档（2026-09-20 决策）：未掌握 / 部分掌握 / 已掌握。
    // 不用 0-100 百分制——老师打不出「62 分」这种精度，强填只会产生假数据。
    // 三档足够画出「从 0 到成功」的阶梯，且 teacher 1 分钟能打完整个班。
    db.exec(`
      CREATE TABLE kp_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        kp_id INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
        assessed_at TEXT NOT NULL,
        session_no INTEGER NOT NULL DEFAULT 0,
        level TEXT NOT NULL DEFAULT '部分掌握'
          CHECK (level IN ('未掌握', '部分掌握', '已掌握')),
        evidence TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_kpa_student_kp ON kp_assessments(student_id, kp_id, assessed_at);
      CREATE INDEX idx_kpa_kp ON kp_assessments(kp_id);
      CREATE INDEX idx_kpa_class ON kp_assessments(class_id, assessed_at);
    `);

    // ── 5. 成长阈值配置（避免阈值硬编码，跑一周后可按真实分布调）─────
    // 背景：架构方案 R12 指出指标计算散落、口径分叉。
    // 成长路径的阈值（连续缺勤几次算预警、Z-score 多少算离群、掌握度变化多少算进步）
    // 必须在跑一周真实数据后可按实际分布调整，不能让老师改一次阈值就改代码重建镜像。
    db.exec(`
      CREATE TABLE growth_thresholds (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        updated_by INTEGER,
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);

    const defaults = [
      ["absent_streak_warn", "2", "连续缺勤预警", "连续缺勤达到该课次数即计入「需支持」学员"],
      ["score_trend_down", "-8", "成绩下滑阈值", "最近一次与首次检测得分率之差低于该值即标记成绩下滑"],
      ["score_trend_up", "8", "进步明显阈值", "最近一次与首次检测得分率之差高于该值即标记进步明显"],
      ["hours_low_warn", "12", "课时将尽预警", "剩余课时低于该值即计入「课时将尽」"],
      ["excellent_rate", "88", "可拓展阈值", "平均得分率达到该值即计入「可以拓展」"],
      ["outlier_z", "1.2", "离群检测阈值", "同班 Z-score 绝对值超过该值即视为离群"],
      ["kp_progress_step", "1", "掌握度进步步长", "知识点等级提升达到该档数即识别为一次成长里程碑"],
      ["attention_score", "6", "需关注加权阈值", "加权分值达到该值即计入「需要支持」名单"]
    ];
    const ins = db.prepare(
      "INSERT INTO growth_thresholds (key, value, label, description) VALUES (?, ?, ?, ?)"
    );
    for (const [k, v, label, desc] of defaults) ins.run(k, v, label, desc);

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`外键校验失败：${JSON.stringify(violations)}`);
    }
  }
};
