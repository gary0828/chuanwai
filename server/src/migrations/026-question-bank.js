// v26：智能题库系统· 一期（题目资产 + 章节视角 + 全文检索）
//
// 背景（2026-10-07）：
//   系统此前**没有题库**：v1~v25 从未建立 questions 表，但 `routes/agent.js` 的
//   capabilities() 里已写 `questions: tableCount("questions") > 0` → 永久返回 false，
//   AI 工作台「知识库 → 题库」页签只能读 `mock/questions.ts` 的 21 道演示题。
//   本迁移补上这块地基，为四期建设（题库 → 组卷 → 作答 → 学情反哺）打基础。
//
// 推翻的既有决策（详见 docs/07-架构与决策/智能题库管理系统-完整设计-2026-10-07.md §8）：
//   · ROADMAP **D7**「本期只做知识点最小集，不做题库」→ 本期推翻
//   · **ADR-012 §D4**「题库仍不做，批改归 AI 工作台」→ 本期推翻
//   → 新增 ADR-014 声明部分取代（ADR 只追加不修改）
//
// 设计取舍（对齐《完整设计》与参考系统插件 API 分析）：
//   1. `kp_ids` 用 **JSON 多值**而非关联表 —— 一题常挂多个知识点；
//      题库量级 <1 万，`json_each()` 反查足够，省一张表与一次 join。
//   2. `parse_status` —— AI 识别是**分阶段**的（参考系统有 RetryAiParse + AiFill 两个
//      独立端点，说明「识别骨架」与「补全字段」是两步），单个 confidence 表达不了。
//   3. `exam_year` / `region` —— 机构题库的高频筛选维度（参考系统 .year 出现 103 次）。
//   4. `content_hash` —— 查重 L1（题干归一化后哈希），纯 SQL 零成本。
//   5. `custom_tags` / `solve_method` —— 多维筛选的基础；`solve_method` 是「按解题方法」
//      第三视角的落点。
//   6. 不设 `folder_id` —— 一期用 `custom_tags` + 知识点树承担分组；题目/试卷文件夹
//      分离留到二期（那时引入 papers 表才有意义）。
//
// ★ 建表顺序：先 question_chapters（被questions.chapter_id 外键引用），再 questions。
//   SQLite 在 CREATE TABLE 时不校验外键目标是否存在，但顺序对了更自洽、也便于阅读。
//
// 为什么必须是新迁移而不是改旧迁移：
//   迁移执行器按`user_version` 跳过已执行版本，改旧文件不会重跑。
module.exports = {
  version: 26,
  name: "智能题库一期：question_chapters 章节表 + questions 题目表（检索用 LIKE，见文件内实测说明）",
  up(db) {
    // ── 1. 章节表（第二视角：按章节浏览）───────────────────────────────
    // ⚠ 为什么与 knowledge_points 分开而不是复用：
    //   `knowledge_points`(v18) 是**知识点树**（课时级粒度，用于学情分析）；
    //   「章节」是**课程大纲层级**（章→ 节），用于组卷时按教材结构铺题。
    //   两者粒度与用途都不同，共用一张表会让学情统计的层级语义变脏。
    db.exec(`
      CREATE TABLE question_chapters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id  INTEGER REFERENCES question_chapters(id) ON DELETE CASCADE,
        course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
        name       TEXT NOT NULL,
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_qc_parent ON question_chapters(parent_id);
      CREATE INDEX idx_qc_course ON question_chapters(course_id, sort);
    `);

    // ── 2. 题目表 ────────────────────────────────────────────────────
    // `type` 覆盖参考系统的主力题型（简答/填空/单选/判断/多选）另加解答题；
    // 参考系统另有「计算题」，数学卷面里计算题即解答题的一种，不单列
    //（避免老师面对两个几乎一样的选项）。
    db.exec(`
      CREATE TABLE questions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        type           TEXT NOT NULL DEFAULT '单选题'
                         CHECK (type IN ('单选题','多选题','填空题','判断题','解答题','简答题')),
        stem           TEXT NOT NULL,
        options        TEXT NOT NULL DEFAULT '[]',
        answer         TEXT NOT NULL DEFAULT '',
        analysis       TEXT NOT NULL DEFAULT '',

        -- 难度 1–5，与 knowledge_points.difficulty 同口径（1 最易）。
        -- 允许 AI 预标定，后续由实测正确率校准（见下方 correct_rate）。
        difficulty     INTEGER NOT NULL DEFAULT 3
                         CHECK (difficulty BETWEEN 1 AND 5),

        -- 知识点**多值**：JSON 数组 [1,7,13]。空数组 = 通用题（不挂知识点）。
        kp_ids         TEXT NOT NULL DEFAULT '[]',
        chapter_id     INTEGER REFERENCES question_chapters(id) ON DELETE SET NULL,
        -- 「按解题方法」第三视角（参考系统截图里的第三个 tab）。
        solve_method   TEXT NOT NULL DEFAULT '',

        -- 版权来源：**必填且受限枚举**（自编 / AI 原创 / 教材 / 授权题库）。
        -- 刻意不给默认值 —— 逼录入时明确表态，避免「忘了填」变成事实上的默认。
        source         TEXT NOT NULL
                         CHECK (source IN ('自编','AI 原创','教材','授权题库')),

        -- 配图（题干插图）。按 ADR-008：文件本体落 server/data/assets/，DB 只存路径。
        figure_path    TEXT NOT NULL DEFAULT '',

        -- 题干归一化后的哈希，查重 L1（精确去重）。
        content_hash   TEXT NOT NULL DEFAULT '',

        -- AI 辅助录入留下的痕迹。ocr_raw 存模型原始输出，便于识别错了后对照排查。
        ocr_confidence REAL,
        parse_status   TEXT NOT NULL DEFAULT 'manual'
                         CHECK (parse_status IN ('manual','pending','recognized','filled','confirmed','failed')),
        ocr_raw        TEXT NOT NULL DEFAULT '',

        -- 多维筛选
        custom_tags    TEXT NOT NULL DEFAULT '[]',
        exam_year      INTEGER,
        region         TEXT NOT NULL DEFAULT '',

        -- 题库质量分（0–1）：解析完整度 / 配图 / 知识点齐全度，规则引擎算，零模型成本。
        quality_score  REAL,

        -- ── 闭环回流字段（四期「学情反哺」的落点）──
        use_count      INTEGER NOT NULL DEFAULT 0,   -- 被组卷引用次数
        correct_rate   REAL,                         -- 实测正确率（0–1）
        wrong_rate     REAL,

        status         TEXT NOT NULL DEFAULT '草稿'
                         CHECK (status IN ('草稿','待审','已启用','已归档')),
        created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_q_type       ON questions(type);
      CREATE INDEX idx_q_diff        ON questions(difficulty);
      CREATE INDEX idx_q_source      ON questions(source);
      CREATE INDEX idx_q_status      ON questions(status);
      CREATE INDEX idx_q_chapter     ON questions(chapter_id);
      CREATE INDEX idx_q_year        ON questions(exam_year);
      CREATE INDEX idx_q_hash        ON questions(content_hash);
      CREATE INDEX idx_q_created_by  ON questions(created_by);
      CREATE INDEX idx_q_method      ON questions(solve_method);
      -- kp_ids 存的是 JSON 数组文本，这里只能建普通索引做前缀/等值加速；
      -- 「按知识点反查题目」走 json_each(q.kp_ids)，量级 <1 万足够快。
      CREATE INDEX idx_q_kpids       ON questions(kp_ids);
    `);

    // ── 3. 全文检索：**刻意不建 FTS5**，用 LIKE 包含匹配────────────────
    //
    // ★ 这是实测后的决定，不是省事（2026-10-07在 node:sqlite 上逐项验过）：
    //   · `tokenize='unicode61'`：英文能搜（搜 SSS 命中），**中文搜不到**（搜「全等」0 条）
    //     —— unicode61 按空格/标点切词，不切 CJK 连续文本。
    //   · `tokenize='trigram'`：**在 node:sqlite 里同样搜不到中文**（trigram 依赖的
    //     字符集判断在当前版本不可用）。
    //   · LIKE '%kw%'：中文/英文/符号（△ABC）**全部命中**；2003 条时单次查询 < 1 ms。
    //
    // 题库量级 < 1 万（校区自用），全表扫 LIKE 完全够用 —— 这正是 K-030 的立场：
    // 「不引向量库，<1 万条时文件/SQL 方案更准且零基础设施」。
    // 若将来真到10 万级再评估 FTS5 或外部搜索，届时是独立迁移。
    //
    // 检索字段：题干 stem + 解析 analysis（老师搜题时真正会输入的内容）。
    // ⚠ 前端需对关键词做转义（% _ ），见 utils/validate.js 的 escapeLike。

    // ── 4. 章节种子（初高中数学人教A 版常见章，作为首次启动的可用默认值）──
    // ⚠ 三个防御，缺一个就会让**整个迁移回滚**（迁移在事务里跑，抛错即终止启动）：
    //   ① courses 表存在才取 id（表结构来自 v1/v11，不能假设已建）
    //   ② 章节表**非空就跳过**（重复启动不重复插）
    //   ③ 逐条 try/catch —— 种子是「锦上添花」，不该让核心建表失败
    const chapterSeed = [
      ["集合与常用逻辑用语", ["集合", "常用逻辑用语"]],
      ["一元二次函数、方程和不等式", ["一元二次不等式（组）", "基本不等式"]],
      ["函数的概念与性质", ["函数的概念", "函数的性质", "函数的表示"]],
      ["指数函数与对数函数", ["指数函数", "对数函数"]],
      ["三角函数", ["任意角和弧度制", "三角函数的概念", "同角三角函数基本关系", "诱导公式", "三角函数的图像与性质", "三角函数的应用"]],
      ["平面向量及其应用", ["平面向量的概念", "平面向量的运算", "平面向量基本定理及坐标表示", "平面向量的应用"]],
      ["复数", ["复数的概念", "复数的四则运算", "复数的三角表示"]],
      ["立体几何初步", ["空间几何体", "空间点、直线、平面之间的位置关系", "空间向量及其运算"]],
      ["统计", ["统计案例", "抽样方法", "统计图表"]],
      ["概率", ["随机事件与概率", "古典概型", "频率与概率", "随机变量"]]
    ];

    try {
      const already = db.prepare("SELECT COUNT(*) AS c FROM question_chapters").get().c;
      if (Number(already) > 0) return;

      // ① courses 表可能不存在（理论上不会，但迁移不该假设）
      let courseId = null;
      try {
        courseId = db.prepare("SELECT id FROM courses ORDER BY id LIMIT 1").get()?.id ?? null;
      } catch {
        courseId = null;
      }

      const insChapter = db.prepare(
        `INSERT INTO question_chapters (parent_id, course_id, name, sort)
         VALUES (?, ?, ?, ?)`
      );
      let order = 0;
      for (const [chapterName, sections] of chapterSeed) {
        order += 1;
        const chapterId = Number(
          insChapter.run(null, courseId, chapterName, order).lastInsertRowid
        );
        let sub = 0;
        for (const sectionName of sections) {
          sub += 1;
          insChapter.run(chapterId, courseId, sectionName, sub);
        }
      }
    } catch (err) {
      // ③ 种子失败只记不抛 —— 核心表已建好，不该因「没章节可用」而拒绝启动
      console.warn("[migration 026] 章节种子写入失败（不影响建表）:", err.message);
    }
  }
};