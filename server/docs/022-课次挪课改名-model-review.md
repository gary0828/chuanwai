# 课次「调课」改称「挪课」数据模型评审（v22）

- 日期：2026-09-24
- 变更类型：改约束（CHECK 枚举值改名）+ 存量数据改写；无新增表/字段
- 结论：通过

> 关联工件：迁移 `server/src/migrations/022-session-reschedule-rename.js`（`version: 22`，`disableForeignKeys: true`）
> 上游：产品拍板「两套课表 / 两套调课」术语收敛（课次维度改称「挪课」，`数据管理 → 调课审批` 保持原名）
> 评审依据：`.trae/skills/data-model-review/SKILL.md`（4 工件 + 7 Gate）

---

## 0. 评审前置：代码核对结论与偏差说明

评审前已逐一通读以下代码（**不以需求描述为准，以代码为准**）：

| 核对对象 | 位置 | 核对结论 |
|---|---|---|
| v22 迁移 | `server/src/migrations/022-session-reschedule-rename.js` 全文 | 与描述一致：CASE 映射 → 行数比对 → DROP+RENAME → 重建 `sqlite_sequence` → 重建索引 → 残留断言 → `PRAGMA foreign_key_check` |
| v21 原始 DDL | `server/src/migrations/021-sessions-assignments.js:65-93` | v22 新表 DDL 与 v21 **逐字一致，仅两处 CHECK 字面量不同**（v21:79/81 vs v22:52/54） |
| 挪课逻辑 | `server/src/routes/sessions.js:415-479` | 与描述一致：`BEGIN` → INSERT 新课次（origin=`'挪课'`）→ 原课次 `status='已挪课'` → 双向 `related_session_id` → `COMMIT/ROLLBACK` |
| 常量表 | `server/src/routes/sessions.js:20-21` | `STATUSES` 已含「已挪课」、`ORIGINS` 已含「挪课」，与 v22 CHECK 完全一致（无新旧并存） |
| 迁移执行器 | `server/src/migrations/index.js:43-58` | `disableForeignKeys` 在**事务外**关/开 FK，迁移本体在 `BEGIN/COMMIT` 内，失败 `ROLLBACK` 并终止启动 |
| 前端消费方 | `WeekGrid.vue:58/68/148`、`SessionDetailDrawer.vue:68/227/488` | 已全部使用「已挪课 / 挪课」，无旧字面量残留 |

### 0.1 与需求描述不一致 / 需精确化之处（以代码与实测为准）

| # | 项目 | 描述说法 | 实际核对结果 | 处置 |
|---|---|---|---|---|
| D1 | 存量数据规模 | 114 条课次；2 条 `status='已调课'`、2 条 `origin='调课'`；`sqlite_sequence`=426；`attendances.session_id` 非空 4 条 | 只读复查 `server/data/attendance.db`（`readOnly:true`）当前为：**124 条**；`status='已挪课'` **4** 条、`origin='挪课'` **4** 条；`sqlite_sequence`=**852**；`attendances.session_id` 非空 **8** 条 | **不构成问题**：描述中的数字是 QA 复核**时点快照**，其后 `verify-sessions.mjs` 的 C7 挪课用例又新建了课次（挪课会 INSERT 新课次），数字自然增长。**不变式全部仍成立**：`user_version=22`、旧值残留 `=0`、`PRAGMA foreign_key_check` 为空、双向关联 4 对（101↔849、102↔636、103↔423、104↔210）完好。文档内一律标注为「时点值」 |
| D2 | 索引数量 | 「重建 5 个索引 + UNIQUE」 | 实测 `sqlite_master`：`idx_cs_date`/`idx_cs_class_date`/`idx_cs_teacher_date`/`idx_cs_sub_teacher`/`idx_cs_term` 共 **5 个命名索引**，UNIQUE 以**表级约束** `UNIQUE (class_id, session_date, period)` 声明，由 SQLite 自动建 `sqlite_autoindex_class_sessions_1`，**不能再、也不需要**单独 `CREATE UNIQUE INDEX` | 精确化表述见 §1.3；结论不变（唯一键与 v21 等价） |
| D3 | `database.md` 版本清单 | 隐含「文档已同步」 | 字段级已同步（database.md:809/810/811/818 已是「已挪课 / 挪课」），但**版本清单仍止于 v21**（第 39 行为 v21 行、第 41 行「当前最新版本：v21」），**缺 v22 行** | 列为**待补项 P1**（非 Gate 阻断，因本次无新表/新字段；建议提交前一并补记） |
| D4 | 历史文档旧词残留 | — | `docs/07-架构与决策/ROADMAP.md:536`、`docs/07-架构与决策/ADR/ADR-009-课次实体与课消归属.md:60` 仍写「已调课」；`memory/logs/2026-09-24.md` 为当日工作日志（保留原样） | 列为**待补项 P2**：ADR/ROADMAP 属决策史料，建议加一行「v22 起改称挪课」的注记而非改写原文 |
| D5 | 代码中仍存在的「调课」字样 | — | 仅两处，均**符合本次决策**：①`021` 迁移（已发布迁移，禁止修改）；②`server/src/index.js:127` 审计日志命名 `{ re: /^\/api\/schedule-adjustments/, name: "调课" }` = **调课审批**模块，本次明确不动 | 无需处理，特此留痕以免后续误改 |

---

## 1. 工件 1：数据模型变更单

### 1.1 涉及范围（一句话）

**仅 `class_sessions` 一张表，仅两处 CHECK 枚举字面量变化 + 对应存量值改写。无新增表、无新增/删除列、无类型变化、无外键变化。**

### 1.2 变更字段明细

| 表 | 字段 | 类型 | NULL | 默认值 | CHECK（v21 → v22） | 外键(ON DELETE) | 唯一索引 | 存量改写 |
|---|---|---|---|---|---|---|---|---|
| class_sessions | status | TEXT | NO | `'待上课'` | `IN ('待上课','已上课','已停课',`**`'已调课'`→`'已挪课'`**`,'已取消')` | - | - | `CASE status WHEN '已调课' THEN '已挪课' ELSE status END`（v22:67） |
| class_sessions | origin | TEXT | NO | `'模板生成'` | `IN ('模板生成',`**`'调课'`→`'挪课'`**`,'补课','手工')` | - | - | `CASE origin WHEN '调课' THEN '挪课' ELSE origin END`（v22:68） |

### 1.3 未变化清单（**重建只是手段，不是变更目的**）

`class_sessions` 的下列全部内容与 v21 **逐字一致**（v22:38-60 系照抄 v21:65-87）：

- **列集合（15 列全同）**：`id / term_id / schedule_id / class_id / course_id / teacher_id / substitute_teacher_id / room_id / session_date / period / start_time / end_time / status / origin / related_session_id / topic / created_at / updated_at`
- **主键**：`id INTEGER PRIMARY KEY AUTOINCREMENT`（含 `sqlite_sequence` 重建，seq 值沿用 `MAX(id)`，实测 852）
- **外键（6 条，全部 `ON DELETE SET NULL`，除两条 CASCADE）**：
  - `term_id → terms(id) ON DELETE SET NULL`
  - `schedule_id → schedules(id) ON DELETE SET NULL`
  - `class_id → classes(id) ON DELETE CASCADE`（NOT NULL）
  - `course_id → courses(id) ON DELETE CASCADE`（NOT NULL）
  - `teacher_id → users(id) ON DELETE SET NULL`
  - `substitute_teacher_id → users(id) ON DELETE SET NULL`
  - `related_session_id → class_sessions(id) ON DELETE SET NULL`（**自引用**）
- **CHECK**：`period BETWEEN 1 AND 8`（`PERIOD_MIN/MAX` 常量与 v21 同值）
- **唯一键**：表级 `UNIQUE (class_id, session_date, period)` → SQLite 自动索引 `sqlite_autoindex_class_sessions_1`，与 v21 等价（见 D2）
- **索引（5 个命名索引）**：`idx_cs_date`、`idx_cs_class_date`、`idx_cs_teacher_date`、`idx_cs_sub_teacher`、`idx_cs_term`
- **引用 `class_sessions` 的其它表（本次一列未动）**：`attendances.session_id`、`class_evaluations.session_id`、`hour_consumptions.session_id`、`makeup_classes.original_session_id`、`makeup_classes.makeup_session_id`、`session_migration_report.matched_session_id` —— 均为 `ON DELETE SET NULL`

> 结论：把本迁移理解为「大改」是误读。DDL 只有 2 个字面量变了；`DROP + RENAME` 是 SQLite 无法 `ALTER CHECK` 的**唯一实现路径**，所有结构元素都在新表中被原样重建。

---

## 2. 工件 2：数据源归属表

| 字段 | 唯一写入口（表 + 接口/函数） | 消费方（只读） | 是否冗余 | 冗余同步时机 |
|---|---|---|---|---|
| class_sessions.status | `class_sessions` ← `server/src/routes/sessions.js`：生成（引擎 `generateSessions` 按日期定 `待上课/已上课`）、`PUT /:id/stop`(397)、`PUT /:id/restore`(410)、`POST /:id/reschedule`(465)、手工新增 `POST /sessions`(319) | 周课表 `WeekGrid.vue`（tag 类型 + 卡片样式）、课次详情 `SessionDetailDrawer.vue`（状态标签 / 操作按钮显隐）、`GET /sessions` 列表（86 行 status 过滤）、`GET /sessions/week`、`server/scripts/verify-sessions.mjs` | 否（单一来源） | - |
| class_sessions.origin | `class_sessions` ← 同上：模板生成（`session-engine.js:134` 写 `'模板生成'`）、挪课（446 行写 `'挪课'`）、手工新增（284 行默认 `'手工'`，295 行**显式禁止**外部传入 `'模板生成'`/`'挪课'`） | `SessionDetailDrawer.vue:333` 展示、详情接口 `GET /sessions/:id`（`SESSION_SELECT` 53 行） | 否（单一来源） | - |
| class_sessions.related_session_id | `class_sessions` ← 仅 `POST /:id/reschedule`（465/468 两行成对写） | `SessionDetailDrawer.vue`「挪课记录」Tab、`SESSION_SELECT` 子查询回带 `related_date`（54 行）、`WeekGrid.vue:148` 关联角标 | 否（**双向冗余指针但由同一事务成对写入**，非双数据源：两行互为镜像，不存在第 3 个写入方） | 同事务内成对写，无异步同步窗口 |
| schedule_adjustments.*（调课审批） | `数据管理 → 调课审批` 自有接口 | 审批列表 / `schedules` 模板 | 否 | **与课次维度彻底无关**，本次不改名、不联动（语义：改长期模板，审批通过后以后每周都变） |

**G1 关键判断**：改名后**不存在新旧两套值并存**。
证据链：①应用层常量 `STATUSES`/`ORIGINS`（sessions.js:20-21）与 v22 CHECK **完全一致**；②迁移一次性改写存量 + 迁移内「旧值残留 = 0」硬断言（v22:89-95）；③全仓 grep 旧字面量仅剩已发布迁移 021 与 022 自身映射/断言（见 D5）。因此不构成「双数据源」违规。

---

## 3. 工件 3：跨模块联动清单

| 触发方（接口 + 动作） | 目标方（表 + 字段） | 方向 | 反向补偿 | 幂等性 | 事务边界 |
|---|---|---|---|---|---|
| `POST /sessions/:id/reschedule`（挪课） | `class_sessions`：INSERT 新课次（`origin='挪课'`、`related_session_id=NULL`）+ 原课次 `status='已挪课'` + 双向 `related_session_id` | 单向 →（原课次为终态） | **无反向（既有设计 Q4，非本次引入）**：挪课后原课次保留为留痕记录，不删除、不回退；新课次若需再调整，走「新课次自身挪课」或「停课/取消」。与「停课」不同：停课有 `PUT /:id/restore` 作对称反向（390-413），因为停课是**临时性**状态；挪课是**终态**标记，二者对反向补偿的要求本就不同 | ✅ 三重拦截：①非「待上课」→ 400（420）；②已挪（`related_session_id != null`）→ 400「不可重复挪课」（423）；③目标时段与原时段相同 → 400（432）。另 `UNIQUE(class_id, session_date, period)` 冲突 → 400「目标时段已存在课次」（474-476） | `db.exec("BEGIN")` … `COMMIT/ROLLBACK`（440-478） |
| `PUT /:id/stop`（停课） | `class_sessions.status = '已停课'` | 单向 → | ✅ `PUT /:id/restore` → 回填 `'待上课'`（对称反向） | ✅ 非「待上课」→ 400（393）；停课课次点名被拒（Q9，e2e C3） | 单表单语句（无跨表写，无需显式事务） |
| `PUT /:id/restore`（恢复） | `class_sessions.status = '待上课'` | 反向 ← | 正向为 stop，互为补偿对 | ✅ 非「已停课」→ 400（406） | 单表单语句 |
| `POST /:id/substitute`（代课） | `class_sessions.substitute_teacher_id` / `room_id` | 单向 → | 再次调用即覆盖（原 `teacher_id` 保持不变，e2e C13） | ✅ 覆盖式写，无累加副作用 | 单表单语句 |
| 迁移 v22 自身 | `class_sessions` 全表重建 | 一次性 | 失败即 `ROLLBACK`（执行器 index.js:51-55），DB 保持 v21 | ✅ 幂等：执行器按 `user_version` 跳过；即便手工重跑 `up()`，第二次 CASE 无旧值可映射，等价于无损重建 | 执行器 `BEGIN/COMMIT` 包裹整个 `up()` |

### 3.1 关于「挪课无反向补偿」的定性（重要，勿记为缺陷）

- **这是 v21 既有设计（Q4：仅「待上课」可挪，挪完即终态），本次改名未改变任何行为。**
- 设计合理性：挪课的语义是「这一节没上，改到别的时间上」。原课次被保留并标记「已挪课」，与新生成的课次双向互指，**既是留痕也是审计线索**；若提供「撤销挪课」，将不得不删除新课次或把原课次改回「待上课」，反而制造「课次消失了/时间穿越」的新问题。
- 与停课的对比必须写清：**停课 = 临时态（可恢复）**，**挪课 = 终态（留痕）**，二者对反向补偿的要求不同，不能用同一把尺子要求。
- 若业务日后要求「撤销挪课」，属于**新需求**，须另起一次评审（涉及删除逻辑 + 反向补偿设计），不在本次范围。

---

## 4. 工件 4：删除影响矩阵

### 4.1 本次是否引入删除逻辑

**否。** 本次变更**没有新增/修改任何业务删除接口**。唯一出现的 `DELETE` 是迁移内部的 `DELETE FROM sqlite_sequence WHERE name='class_sessions'`（v22:79），属自增计数维护，与业务数据无关。

### 4.2 重建期间的风险管控（`DROP TABLE` 的等价删除面）

`DROP TABLE class_sessions` 会形成**短暂的删除窗口**，其影响面必须显式管控：

| 删除对象（重建期间） | 引用方（表 · 列 · ON DELETE） | 若不关 FK 的后果 | 本次管控措施 |
|---|---|---|---|
| `class_sessions`（DROP + RENAME） | `attendances.session_id` · SET NULL | 子表 `session_id` 被**清空** → 考勤与课次的挂载关系丢失（QA 时点 4 条、当前 8 条） | ①迁移声明 `disableForeignKeys: true`，执行器在**事务外** `PRAGMA foreign_keys = OFF`（index.js:43）；②因 `id` 在重建中**原样保留**，不需要触发任何 SET NULL，引用天然保持有效；③重建后 `PRAGMA foreign_key_check` 非空即 throw（v22:98-101） |
| 同上 | `class_evaluations.session_id` · SET NULL | 课评挂课次关系丢失 | 同上 |
| 同上 | `hour_consumptions.session_id` · SET NULL | 课消精确对账链路断裂 | 同上 |
| 同上 | `makeup_classes.original_session_id` / `makeup_session_id` · SET NULL | 补课↔原课次关联丢失 | 同上 |
| 同上 | `session_migration_report.matched_session_id` · SET NULL | 回填报告匹配结果丢失 | 同上 |
| 同上 | **自引用** `class_sessions.related_session_id` · SET NULL | 挪课双向关联被清空（当前 4 对 / 8 行互指） | 同上；**这是必须关 FK 的首要原因**：自引用在 `DROP` 时会触发对自身的 SET NULL，直接抹掉挪课记录 |
| 同上 | `class_id` / `course_id`（`ON DELETE CASCADE`，NOT NULL） | 若外键开启，`DROP` 可能沿 CASCADE 误伤 `classes`/`courses` 关联行 | 同上（FK 关闭期间 CASCADE 不触发） |

**兜底断言（任一失败 → 事务回滚 → 启动终止）**：
1. 行数比对 `重建前 COUNT(*) == 重建后 COUNT(*)`（v22:36/72-75）
2. 改名彻底性 `status='已调课'` 与 `origin='调课'` 残留均为 0（v22:89-95）
3. `PRAGMA foreign_key_check` 返回空（v22:98-101）
4. 执行器统一 `ROLLBACK` + 抛错（index.js:51-55），FK 在 `finally` 中恢复 `ON`（index.js:56-58）

---

## 5. ★ 经验沉淀：为什么必须「COPY 时 CASE」而不能「先 UPDATE 再重建」

SQLite 的 `CHECK` 约束**对 `UPDATE` 同样生效**。旧表 `class_sessions` 的 CHECK 仍写着 `'已调课'`，直接执行

```sql
UPDATE class_sessions SET status='已挪课' WHERE status='已调课';  -- ❌ 被旧 CHECK 拒绝
```

会被旧约束判定非法，且因迁移整体在事务内，**整次迁移回滚、启动失败**。
正确做法是把映射放在「写新表」这一步：新表 CHECK 已是新字面量，`INSERT INTO class_sessions_new ... SELECT ... CASE ...` 时旧值经 CASE 转成新值写入，天然绕开旧表约束；建完再补一条「旧值残留 = 0」的断言兜底。

> 推广结论：**SQLite 中任何「枚举值改名 + 改 CHECK」的场景，都必须走「建新表（新约束）→ 拷贝时映射 → 换名」的顺序，禁止先 UPDATE 旧表。** 这一条是本次变更最有复用价值的经验。

---

## 6. Gate 检查结果

| Gate | 结果 | 说明 |
|---|---|---|
| G1 每个字段有唯一数据源，无双写 | ✅ | `status`/`origin`/`related_session_id` 写入口唯一（`server/src/routes/sessions.js`，另加 `session-engine.js` 生成分支）；应用层常量与 v22 CHECK 完全一致，改名后无新旧值并存，不构成双数据源（详见 §2） |
| G2 跨模块写操作单事务 | ✅ | 挪课在 `BEGIN … COMMIT/ROLLBACK` 内完成「建新课次 + 标原课次 + 双向关联」（sessions.js:440-478）；迁移本身亦由执行器事务包裹（index.js:44-55） |
| G3 状态机成对（正向必有反向补偿） | ✅ | 「停课 ↔ 恢复」成对；「挪课无反向」是 v21 既有 Q4 设计（仅待上课可挪、挪完终态、原课次留痕），**本次改名未改变行为**，已在 §3.1 定性说明，不记为新缺陷 |
| G4 删除有影响矩阵（保护/级联明确） | ✅ | 本次无新增业务删除逻辑；重建期 `DROP` 的等价删除面已列全 7 条引用（含自引用），并以「关 FK + 行数比对 + `foreign_key_check`」三重兜底（§4.2） |
| G5 联动幂等（重复触发无重复副作用） | ✅ | 挪课三重前置拦截（非待上课 / 已挪不可再挪 / 同时段无意义）+ UNIQUE 冲突兜底（sessions.js:420/423/432/474）；迁移按 `user_version` 只执行一次，重复执行幂等 |
| G6 有版本化迁移 + 更新 `server/database.md` | ✅（附 1 项待补） | 迁移 `022-session-reschedule-rename.js` 已登记进 `server/src/migrations/index.js:29`；`database.md` 字段级（809/810/811/818）已同步为「已挪课 / 挪课」。**待补**：版本清单仍止于「当前最新版本：v21」（第 39/41 行），缺 v22 行 —— 见待补项 P1 |
| G7 联动有 e2e 场景覆盖 | ✅ | 本次为纯改名，**无新增联动**；既有 `server/scripts/verify-sessions.mjs` 的 **C5–C11** 已完整覆盖挪课链路（C5 已上课不可挪 / C7 挪课成功 / C8 原课次=已挪课 / C9 双向关联互跳 / C10 新课次 origin=挪课 / C11 已挪课不可重复挪），且该脚本基线已随本次升到 v22（第 131 行注释），实测 **PASS**。关联回归（周历、课次详情、考勤、课消）随同一脚本执行 |

---

## 7. 未通过项与修复要求

**无阻断项（G1–G7 全部通过）。** 以下为**非阻断待补事项**，建议在本次提交前一并处理（均为文档性质，不涉及代码）：

| 编号 | 级别 | 事项 | 要求 |
|---|---|---|---|
| P1 | 文档同步 | `server/database.md` 版本清单缺 v22 行、仍写「当前最新版本：v21」（第 39/41 行） | 新增 v22 行：课次「调课」改称「挪课」（status/origin 枚举值 + CHECK，重建 `class_sessions`，无新表新字段），并把第 41 行改为 v22 |
| P2 | 文档注记 | `ROADMAP.md:536`、`ADR-009:60` 仍写「已调课」 | 在原文旁加注「v22 起改称「已挪课」」（**改写史料不如加注**，保持决策可追溯） |
| P3 | 代码卫生 | v22 迁移注释步骤编号为 1 → 2 → 4，缺 3（v22:34/88/97） | 顺手改为连续编号（不影响行为） |

---

## 8. 实现记录

- **迁移版本**：`v22`（`PRAGMA user_version = 22`），文件 `server/src/migrations/022-session-reschedule-rename.js`
- **执行路径**：`server/src/migrations/index.js`（FK 事务外切换 + 事务内执行 + 失败回滚）
- **e2e / 回归**：`server/scripts/verify-sessions.mjs`，挪课链路 **C5–C11**，实测 **PASS**；基线已升级至 v22（脚本第 131 行）
- **只读复查（`server/data/attendance.db`，`readOnly: true`，评审时点）**：

| 检查项 | 结果 |
|---|---|
| `PRAGMA user_version` | 22 ✅ |
| `class_sessions` 行数 | 124（迁移前后一致；QA 复核时点为 114，差异来自后续 e2e 挪课用例新建课次） |
| `status='已调课'` / `origin='调课'` 残留 | 0 / 0 ✅ |
| `status='已挪课'` / `origin='挪课'` | 4 / 4（成对，与 4 组双向关联吻合） |
| `related_session_id` 双向关联 | 4 对：101↔849、102↔636、103↔423、104↔210 ✅ |
| `attendances.session_id` 非空 | 8（QA 时点 4；重建未清空引用 ✅） |
| `sqlite_sequence`（class_sessions） | 852 ✅（= `MAX(id)`，自增未回退） |
| `PRAGMA foreign_key_check` | 空 ✅ |
| 索引 | 5 个命名索引 + `sqlite_autoindex_class_sessions_1`（UNIQUE 自动索引）✅ |
- **其它已验证路径**：重复执行幂等；全新库 v0 → v22 一次性升级通过
- **未改动**：`数据管理 → 调课审批`（`schedule_adjustments`）及其审计命名（server/src/index.js:127）
