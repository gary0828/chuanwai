# 课次多课时 + 学员软删数据模型评审（v30）

- 日期：2026-10-21（**补录**，见下方说明）
- 变更类型：纯增量 —— 2 个 ADD COLUMN（带默认值）+ 1 个索引；无 CHECK 变更、无表重建、无外键变更、无存量改写
- 结论：通过

> 关联工件：迁移 `server/src/migrations/030-session-hours-soft-delete.js`（`version: 30`）
> 上游：用户 2026-10-18 拍板 —— ①「一节课 = 多课时」按课次设（`class_sessions.hours`）；② 学员档案改软删（`students.deleted_at`），历史数据全部保留
> 评审依据：`.trae/skills/data-model-review/SKILL.md`（4 工件 + 7 Gate）

---

## 0. 评审前置：补录说明与代码核对结论

**为什么是补录**：v30 的迁移与业务代码已于 2026-10-18 / 10-19 开发完毕，并通过当轮全部回归
（Lead 回归 29/29 · `api-full-suite` 89 PASS / 0 FAIL / 1 WARN · `vue-tsc` 0 错 · `eslint` 0 错 ·
`run-gates` 6/6 · UI 回归 A–E 全 PASS），生产库已迁移至 v30
（备份 `server/data/attendance-before-v30-20261018132603.db`）。但当时**未按 data-model-review
产出本文档**；2026-10-21 提交前，pre-commit 的迁移门禁（新迁移必须配套含「结论：通过」的
model-review 文档）将其拦下，故补做本次评审。**评审以代码核对为准，不以当时的实现记忆为准。**

评审前已逐一通读以下代码：

| 核对对象     | 位置                                                                                                                                                             | 核对结论                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| v30 迁移     | `server/src/migrations/030-session-hours-soft-delete.js` 全文                                                                                                    | 与描述一致：两处 `ADD COLUMN` + 1 个索引 + 2 条断言（`hours <= 0` 计数、`foreign_key_check`）；无重建、无存量改写                          |
| hours 写入口 | `server/src/routes/sessions.js`（`req.body.hours`，PUT `/:id/hours`）+ 生成引擎默认 1                                                                            | 写入口唯一；接口层校验 `> 0 且 ≤ 20`，已产生课时流水（`hour_consumptions.session_id` 非空）的课次返回 400                                  |
| hours 消费点 | `server/src/utils/hours-reconcile.js`（`sessionHours()` / `COALESCE(cs.hours, 1)`）、attendance / leaves / makeups 扣减                                          | 全部经 `sessionHours()` 取值，无写死 1 的残留（迁移注释所列 6 处硬编码已改）                                                               |
| 软删写入口   | `server/src/routes/students.js:695`（DELETE `/:id` → `deleted_at = datetime('now','localtime')`）、`:713`（POST `/:id/restore` → `deleted_at = NULL`，仅 admin） | 写入口唯一且成对；删除前 `buildRelatedImpact` 预检，有报班/缴费/退费记录返回 400                                                           |
| 软删读取扩散 | agent / analytics / attendance / classes / dashboard / exams / finance / growth / scope / timeline / todo-generator 共 11 处                                     | 列表、下拉、点名、计数、teacher scope 全部带 `deleted_at IS NULL`；`deleted=1` 看已删除、`deleted=all` 看全部（students.js:59-64/107-110） |
| 索引         | 迁移内 `CREATE INDEX IF NOT EXISTS idx_students_deleted`                                                                                                         | 默认查询条件即 `deleted_at IS NULL`，索引必要且与查询形态匹配                                                                              |
| 迁移执行器   | `server/src/migrations/index.js`                                                                                                                                 | 按 `user_version` 顺序执行、失败回滚并终止启动，与既有迁移同路径                                                                           |

### 0.1 与需求描述不一致 / 需精确化之处

| #   | 项目                                                | 描述说法                           | 实际核对结果                                                                                                                                                                                   | 处置                                                                     |
| --- | --------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| D1  | 报表是否包含已删学员                                | 「历史数据全部保留，报表照常包含」 | 财务/考勤/课消统计的 SQL 以流水表（`hour_consumptions` 等）为数据源，**不 join students 做存在性过滤** → 已删学员的历史流水天然仍在报表内；而「在读人数」等实时计数类均带 `deleted_at IS NULL` | 与设计一致：**时点计数排除已删、历史流水保留**，两类口径都已落实，无偏差 |
| D2  | `students.deleted_at` 与题库 `questions.deleted_at` | —                                  | `qbank-taxonomy.js` / `qbank-ocr.js` 中的 `deleted_at` 属**题库模块自己的字段**（早于 v30 存在），与学员软删无关                                                                               | 特此留痕，避免后续误以为是同一套机制                                     |

---

## 1. 工件 1：数据模型变更单

### 1.1 涉及范围（一句话）

**`class_sessions` 加 1 列、`students` 加 1 列 + 1 个索引。无新增表、无删除列、无类型变化、无 CHECK 变化、无外键变化、无存量数据改写。**

### 1.2 变更字段明细

| 表             | 字段                         | 类型 | NULL | 默认值 | 说明                                                             | 存量影响              |
| -------------- | ---------------------------- | ---- | ---- | ------ | ---------------------------------------------------------------- | --------------------- |
| class_sessions | hours                        | REAL | NO   | `1`    | 一节课扣几个课时；历史行一律为 1，**行为与 v29 完全一致**        | 无（默认值即旧行为）  |
| students       | deleted_at                   | TEXT | YES  | `NULL` | 软删标记；NULL = 在看，非 NULL = 已删（存本地删除时间）          | 无（全表初始为 NULL） |
| students       | （索引）idx_students_deleted | —    | —    | —      | `CREATE INDEX IF NOT EXISTS`，服务 `deleted_at IS NULL` 高频查询 | 无                    |

### 1.3 未变化清单

- `orders.total_hours` 口径不变：仍是「可上多少课时」，一节课扣 `class_sessions.hours`（买 40 课时、上 20 次两课时课，刚好用完）
- 课时的**取值层次**：按课次设；课程 / 排课模板只提供生成时默认值 1，不做继承覆写链（少一层继承少一类歧义）
- 无任何 CASCADE / 级联影响：软删是标记位，不是物理删除
- `hour_consumptions` 流水结构不变；`session_id` 关联不变

---

## 2. 工件 2：数据源归属表

| 字段                 | 唯一写入口（表 + 接口/函数）                                                                                                                         | 消费方（只读）                                                                                                                                                  | 是否冗余       | 冗余同步时机 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ |
| class_sessions.hours | `class_sessions` ← `server/src/routes/sessions.js`：生成引擎（默认 1）、手工新增、`PUT /sessions/:id/hours`（仅 admin，1–20，有流水的课次 400 拒绝） | 考勤扣减（attendance.js）、请假（leaves.js）、补课（makeups.js）、对账（hours-reconcile.js `sessionHours()`）                                                   | 否（单一来源） | -            |
| students.deleted_at  | `students` ← `server/src/routes/students.js`：DELETE `/:id`（695 行置位）、POST `/:id/restore`（713 行清空，仅 admin）                               | 11 处查询入口（agent/analytics/attendance/classes/dashboard/exams/finance/growth/scope/timeline/todo-generator）+ 学员列表三种筛选（students.js:59-64/107-110） | 否（单一来源） | -            |

**G1 关键判断**：两个字段都只有唯一写入口，且全部消费方均从字段本身取值（`hours` 经 `sessionHours()` 统一封装），不存在第二数据源或双写。

---

## 3. 工件 3：跨模块联动清单

| 触发方（接口 + 动作）            | 目标方（表 + 字段）                             | 方向             | 反向补偿                                                                               | 幂等性                                                              | 事务边界                       |
| -------------------------------- | ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| 考勤点名（attendance.js）        | `hour_consumptions` 扣减 `class_sessions.hours` | 单向 →           | 撤销考勤回补（既有机制）                                                               | 既有护栏不变                                                        | 既有事务                       |
| 请假（leaves.js）                | 同上                                            | 单向 →           | 销假回补                                                                               | 既有                                                                | 既有                           |
| 补课（makeups.js）               | 同上                                            | 单向 →           | 取消补课回补                                                                           | 既有                                                                | 既有                           |
| `PUT /sessions/:id/hours`        | `class_sessions.hours`                          | 单向 →（覆盖式） | 无专门反向；**已产生流水的课次拒绝修改**（400）—— 否则流水记旧值、账面按新值，账实不符 | ✅ 重复提交同值无害；非 admin 403；hours ≤ 0 或 > 20 → 400          | 单表单语句                     |
| DELETE `/api/students/:id`       | `students.deleted_at` 置位                      | 单向 →           | ✅ `POST /:id/restore` 清空（成对）                                                    | ✅ 已删除再删 → 400（`alreadyDeleted`）；有报班/缴费/退费记录 → 400 | 单表单语句（标记位，无跨表写） |
| POST `/api/students/:id/restore` | `students.deleted_at` 清空                      | 反向 ←           | 正向为 delete，互为补偿对                                                              | ✅ 未删除的学员恢复 → 400                                           | 单表单语句                     |

---

## 4. 工件 4：删除影响矩阵

### 4.1 本次是否引入物理删除逻辑

**否，且是本次迁移的核心目的 —— 把原来的硬删改成软删。** v29 及以前 DELETE 学员按外键 CASCADE
连带清空考勤 / 请假 / 补课 / 课时流水 / 通知 / 成绩 / 课评 / 知识点测评 / 成长档案；
v30 起 DELETE 只置 `deleted_at`，**上述表一行不动**。

### 4.2 删除接口的影响面（软删口径）

| 删除对象                  | 引用方（表 · 列 · ON DELETE）                                                                                                                             | v29 及以前（硬删）                                 | v30 起（软删）                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| students（DELETE `/:id`） | attendances / leaves / makeups / hour_consumptions / notifications / exams / class_evaluations / kp_assessments / growth_records · `student_id` · CASCADE | 全部连带清空，「这个孩子以前上过什么课」永久查不到 | **全部保留**；财务、考勤、课消统计照常包含已删学员（口径 D1） |
| students（DELETE `/:id`） | orders / payments / refunds · `student_id`                                                                                                                | 有记录时按业务规则拒绝                             | 有记录时仍返回 400（履约中订单需先处理）—— 软删不放宽这一步   |

**兜底断言（任一失败 → 事务回滚 → 启动终止）**：

1. `class_sessions` 中 `hours <= 0` 的行数必须为 0（迁移 43-48 行）
2. `PRAGMA foreign_key_check` 必须为空（迁移 62-65 行）
3. 执行器统一 `ROLLBACK` + 抛错（`server/src/migrations/index.js`）

---

## 5. Gate 检查结果

| Gate                                        | 结果 | 说明                                                                                                                                                                                                                              |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 每个字段有唯一数据源，无双写             | ✅   | `hours` / `deleted_at` 写入口均唯一（§2）；消费方全部从字段取值，无第二数据源                                                                                                                                                     |
| G2 跨模块写操作单事务                       | ✅   | 本次两个写入口均为单表单语句，无跨表写，无需显式事务；迁移本体由执行器 `BEGIN/COMMIT` 包裹                                                                                                                                        |
| G3 状态机成对（正向必有反向补偿）           | ✅   | 删除 ↔ 恢复成对（695 置位 / 713 清空），双向均有前置校验（已删再删 400 / 未删恢复 400）                                                                                                                                          |
| G4 删除有影响矩阵（保护/级联明确）          | ✅   | §4 已列全 9 类引用表；软删后无 CASCADE 触发面；`buildRelatedImpact` 在删除前预检并回传受影响记录清单                                                                                                                              |
| G5 联动幂等（重复触发无重复副作用）         | ✅   | 软删/恢复均为标记位覆盖式写；`PUT /:id/hours` 重复同值无害；迁移按 `user_version` 只执行一次                                                                                                                                      |
| G6 有版本化迁移 + 更新 `server/database.md` | ✅   | 迁移 `030-session-hours-soft-delete.js` 已登记进 `server/src/migrations/index.js`；`server/database.md` 已同步 v30（本次提交一并带上）                                                                                            |
| G7 联动有 e2e 场景覆盖                      | ✅   | 深测轮已覆盖：课次改课时数后点名扣 2、legacy 多课时、软删/恢复/有订单拦截、删有课次班级被拒、转班后历史课消归属（`_verify_test/_tmp/reports/bizlogic-deep-2026-10-18.md` + `fix-summary-2026-10-19.md`，P0 2/2、P1 10/10 已修复） |

---

## 6. 未通过项与修复要求

**无阻断项（G1–G7 全部通过）。** 遗留非阻断事项（均为已知未修项，不属本次迁移范围）：

- 员工停用（需迁移 + 产品决策）、refresh 轮换 —— 见 `memory/CURSOR.md` 未修项清单
- v30 历史 `session_id=NULL` 流水未回填 —— 对账脚本 `server/scripts/reconcile-hours-ledger.mjs` 默认 dry-run，按需执行

---

## 7. 实现记录

- **迁移版本**：`v30`（`PRAGMA user_version = 30`），文件 `server/src/migrations/030-session-hours-soft-delete.js`
- **执行路径**：`server/src/migrations/index.js`（顺序执行 + 失败回滚 + 启动终止）
- **生产库状态**：已迁移至 v30（2026-10-18），备份 `server/data/attendance-before-v30-20261018132603.db`
- **回归证据**（2026-10-18 / 10-19）：Lead 回归 29/29 · `api-full-suite` 89 PASS / 0 FAIL / 1 WARN · `vue-tsc` 0 错 · `eslint` 0 错 · `run-gates` 6/6 · UI 回归 A–E 全 PASS
- **配套资产**：对账修复工具 `server/scripts/reconcile-hours-ledger.mjs`（默认 dry-run，`--apply` 才写库，写入前 `VACUUM INTO` 快照备份 + 事务 + 幂等）
