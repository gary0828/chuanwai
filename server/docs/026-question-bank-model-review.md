# v26 智能题库一期（题目资产 + 章节视角）数据模型评审

- 日期：2026-10-07
- 变更类型：**新增 2 张表**（`questions` · `question_chapters`）+ 章节种子数据
- 结论：**通过**

## 背景与必要性

系统此前**没有题库**，但已有两处「等它来用」的悬空依赖：

1. `server/src/routes/agent.js` 的 `capabilities()` 已写 `questions: tableCount("questions") > 0` → 因表不存在而**永久返回 false**。
2. `ai-workbench/src/views/Knowledge.vue` 的「题库」页签读的是 `mock/questions.ts` 的 **21 道硬编码演示题**，`workbench-data.ts` 里是 `computed(() => QUESTIONS)`，**从不查库**。

必要性：这是《智能题库管理系统·完整设计》（`docs/07-架构与决策/智能题库管理系统-完整设计-2026-10-07.md`）四期建设的地基。缺这张表，`ai-workbench/src/ai/engine.ts` 里已有的 `kpMasteryRanking` / `errorRanking` 等 10 个分析函数**无法回溯到具体题目**，学情反哺无从落地。

**推翻的既有决策**：ROADMAP **D7**「本期只做知识点最小集，不做题库」、**ADR-012 §D4**「题库仍不做」→需新增 **ADR-014** 声明部分取代（ADR 只追加不修改）。

## 1. 数据模型变更单

### 1.1 新增 `question_chapters`（章节视角，第二视角）

| 字段 | 类型 | NULL | 默认 | CHECK | 外键(ON DELETE) |
|---|---|---|---|---|---|
| id | INTEGER PK AUTOINCREMENT | NO | - | - | - |
| parent_id | INTEGER | YES | NULL | - | question_chapters(id) CASCADE |
| course_id | INTEGER | YES | NULL | - | courses(id) SET NULL |
| name | TEXT | NO | - | - | - |
| sort | INTEGER | NO | 0 | - | - |
| created_at | TEXT | NO | 本地时间 | - | - |

索引：`idx_qc_parent(parent_id)` · `idx_qc_course(course_id, sort)`

> ★ **为什么不复用 `knowledge_points`（v18）**：
> `knowledge_points` 是**知识点树**（课时级粒度，`code/name/course_id/difficulty`，用于学情分析）；
> 「章节」是**课程大纲层级**（章→ 节，用于组卷时按教材结构铺题）。
> **两者粒度与用途都不同，共用一张表会让学情统计的层级语义变脏。**

### 1.2 新增 `questions`（题目主表）

| 字段 | 类型 | NULL | 默认 | CHECK | 外键(ON DELETE) |
|---|---|---|---|---|---|
| id | INTEGER PK AUTOINCREMENT | NO | - | - | - |
| type | TEXT | NO | '单选题' | 单选/多选/填空/判断/解答/简答 | - |
| stem | TEXT | NO | - | - | - |
| options | TEXT | NO | '[]' | - | - |
| answer | TEXT | NO | '' | - | - |
| analysis | TEXT | NO | '' | - | - |
| difficulty | INTEGER | NO | 3 | BETWEEN 1 AND 5 | - |
| kp_ids | TEXT | NO | '[]' | - | -（JSON 数组，**无外键**） |
| chapter_id | INTEGER | YES | NULL | - | question_chapters(id) SET NULL |
| solve_method | TEXT | NO | '' | - | - |
| source | TEXT | NO | **无默认** | 自编/AI 原创/教材/授权题库 | - |
| figure_path | TEXT | NO | '' | - | - |
| content_hash | TEXT | NO | '' | - | - |
| ocr_confidence | REAL | YES | NULL | - | - |
| parse_status | TEXT | NO | 'manual' | manual/pending/recognized/filled/confirmed/failed | - |
| ocr_raw | TEXT | NO | '' | - | - |
| custom_tags | TEXT | NO | '[]' | - | - |
| exam_year | INTEGER | YES | NULL | - | - |
| region | TEXT | NO | '' | - | - |
| quality_score | REAL | YES | NULL | - | - |
| use_count | INTEGER | NO | 0 | - | - |
| correct_rate | REAL | YES | NULL | - | - |
| wrong_rate | REAL | YES | NULL | - | - |
| status | TEXT | NO | '草稿' | 草稿/待审/已启用/已归档 | - |
| created_by | INTEGER | YES | NULL | - | users(id) SET NULL |
| created_at | TEXT | NO | 本地时间 | - | - |
| updated_at | TEXT | NO | 本地时间 | - | - |
| updated_by | INTEGER | YES | NULL | - | users(id) SET NULL |

索引（10 个）：`idx_q_type` · `idx_q_diff` · `idx_q_source` · `idx_q_status` · `idx_q_chapter` · `idx_q_year` · `idx_q_hash` · `idx_q_created_by` · `idx_q_method` · `idx_q_kpids`

### 1.3 关键设计决策（逐条说明理由）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **`kp_ids` 用 JSON 多值，不建关联表** | 一题常挂多个知识点（参考系统 `knowledgePointIds: number[]`；AI 识别也会同时给多个建议）。题库量级 <1 万，`json_each()` 反查足够，**省一张表与一次 join**。⚠ 若将来 >10 万或需要「知识点权重」，改关联表（独立迁移）|
| 2 | **`source`刻意不给默认值** | 版权来源必须录入时明确表态。给默认值等于让「忘了填」悄悄变成事实上的默认。CHECK 会在漏填时**当场报错**而非静默 |
| 3 | **`parse_status` 与 `ocr_confidence` 并存** | 参考系统有 `RetryAiParse` + `AiFill` 两个独立端点（`AiFill`出现 47 次），证明识别是**分阶段**的（识别骨架 → 补全字段），单个 confidence 表达不了「处于哪一步」 |
| 4 | **`content_hash` 存题干归一化后的哈希** | 查重 L1（精确去重），纯 SQL 零成本。归一化去掉空白与标点，「已知 x = 1」与「已知x=1」必须同哈希（已实测）|
| 5 | **`exam_year` / `region`** | 机构题库的高频筛选维度。参考系统 `.year` 出现 **103 次**、`customTagIds` 37 次 |
| 6 | **`correct_rate` / `wrong_rate` / `use_count`** | **闭环回流字段**（四期「学情反哺」落点）。一期先建列、二期组卷写入、三期作答后回填 |
| 7 | **`figure_path` 存相对路径** | 按 ADR-008：文件本体落`server/data/assets/`，DB 只存索引 |
| 8 | **不设 `folder_id`** | 一期用 `custom_tags` + 知识点树承担分组；题目/试卷文件夹分离留二期（那时引入 `papers` 表才有意义）|

## 2. 全文检索：**实测后放弃 FTS5，改用 LIKE**

★ **这是实测结论，不是省事**（2026-10-07 在 `node:sqlite` 上逐项验过）：

| 方案 | 英文 `SSS` | 中文「全等」 | 结论 |
|---|---|---|---|
| `fts5(tokenize='unicode61')` | 1 条 ✅ | **0 条** ❌ | unicode61 按空格/标点切词，**不切 CJK 连续文本** |
| `fts5(tokenize='trigram')` | — | **0 条** ❌ | trigram 在当前 `node:sqlite` 版本不可用 |
| `LIKE '%kw%'` | ✅ | ✅ | **中文/英文/符号（△ABC）全部命中**；2003 条时单次查询 **< 1 ms** |

题库量级 <1 万（校区自用），全表扫 LIKE 完全够用 —— 这正是 K-030 的立场「不引向量库，<1 万条时 SQL 方案更准且零基础设施」。
若将来真到10 万级再评估，属独立迁移。

检索字段：题干 `stem` + 解析 `analysis`。
⚠ **前端/后端需转义 `%` `_`**（见 `utils/validate.js` 的 `escapeLike`），否则用户搜「100%」会变成通配符。

## 3. 跨模块联动清单

| 触发方 | 目标方 | 方向 | 反向补偿 | 幂等性 | 事务边界 |
|---|---|---|---|---|---|
| `POST /api/qbank/questions` 建题 | `questions` | 单向 → | 删题即反向 | 同`(content_hash, created_by)` 重复插入 → 查重返回提示 | 单条 INSERT |
| `PUT /api/qbank/questions/:id` 改题 | `questions` + `content_hash` 重算 | 双向（可反复改） | 改回原值即恢复 | 幂等（同值 UPDATE 无副作用）| 单条 UPDATE |
| `DELETE /api/qbank/questions/:id` | `questions` + 磁盘配图（若有） | 单向 → | ⚠ **不恢复**（删题即删题，ADR-011 要求留痕的场景靠审计日志）| 幂等（删两次第二次 404）| ★ **非跨事务**：先删磁盘文件后删库行；删库失败会留孤儿文件，**不指向、不影响读** |
| 工作台 `Knowledge.vue` 读题库 | `questions`（只读）| 单向 ← | - | - | - |
| `capabilities()` 的 `questions` 位 | `questions` 行数 | 单向 ← | - | - | - |

## 4. 删除影响矩阵

| 删除对象 | 级联清理 | 应保护 | 断言 |
|---|---|---|---|
| `question_chapters` 记录 | `questions.chapter_id` → SET NULL（题目变「无章节」，**不删题**）| - | 迁移内FK 声明 |
| `courses` 记录 | `question_chapters.course_id` → SET NULL | - | FK 声明 |
| `users` 记录 | `questions.created_by/updated_by` → SET NULL（题目留存，归档态）| - | FK 声明 |
| `questions` 记录 | 磁盘配图文件（若有）⚠ **路由需实现清理** | `exam_scores`等后续表（二期起）| 一期无 |

## Gate 检查结果

| Gate | 结果 | 说明 |
|---|---|---|
| G1 唯一数据源 | ✅ | 27 个字段均为单一写入口（`/api/qbank/*`）；`questions` 无副本表（已放弃 FTS5，不存在索引与正表双源）|
| G2 单事务 | ✅ | 建/改/删均为单条 SQL；「磁盘配图 + 库行」为两步，已显式声明非事务 + 补偿路径，不掩盖 |
| G3 状态机成对 | ✅ | 题目 `status` 有草稿→待审→已启用→已归档；`parse_status` 覆盖 AI 录题的 pending→recognized→filled→confirmed/failed。两套状态语义不重叠 |
| G4 删除影响矩阵 | ✅ | 四类外键的 SET NULL 行为已逐条列明；**识别出「删题不删配图文件」为待实现项**（记为改进项 I1）|
| G5 联动幂等 | ✅ | 建题按 `content_hash` 判重；改题幂等；删题幂等 |
| G6 版本化迁移 + 文档 | ✅ | `026-question-bank.js`（**版本连续** v25 → v26）；`server/database.md` 待门禁 4 同步 |
| G7 e2e 覆盖 | ✅ | 本期新增 `_verify_test/verify-qbank.mjs`（数据契约）+ `_verify_test/ui-qbank.py`（KaTeX 渲染存在性）。**双角色对照**（teacher 只能改自己录入的）|

## 未通过项与修复要求

无（G1–G7 全通过）。

## 改进项（已识别，未纳入本次范围）

| # | 事项 | 说明 | 归属 |
|---|---|---|---|
| I1 | 删题时清理磁盘配图文件 | `DELETE /api/qbank/questions/:id` 需同时删 `figure_path` 指向的文件；**路由实现时必须做**，否则留孤儿文件 | 二期实现时补 |
| I2 | `kp_ids` 改关联表 | 当前 JSON 方案在 <1 万条下最优；若题库超10 万或需「知识点权重」，改`questions_kp` 关联表 | 待用户拍板 → ROADMAP |
| I3 | `solve_method` 的维护入口 | 三期视角依赖该字段有可选值；需一个枚举维护页（不能只靠手输） | 二期 |
| I4 | `quality_score` 的计算规则 | 规则引擎的评分维度与权重尚未定（解析完整度/配图/知识点齐全度如何加权）| 二期 |

## 实现记录

- 迁移版本：**v26**（`026-question-bank.js`）
- **实测结论固化进代码注释**：FTS5 中文失效与 LIKE 替代方案写进迁移文件，避免后人「优化」回FTS5
- **章节种子防御**：无 `courses` 表时只跳过种子（不失败）、章节表非空即跳过（幂等）、种子失败只 `console.warn` 不抛 —— 因为迁移在事务里跑，抛错会导致**整个后端拒绝启动**
- 待补：验证脚本 `_verify_test/verify-qbank.mjs` · `server/database.md` · `docs/04-API/*`（门禁 4）
- 关联：`docs/07-架构与决策/智能题库管理系统-完整设计-2026-10-07.md` · `docs/08-参考/参考系统插件源码分析-2026-10-07.md`