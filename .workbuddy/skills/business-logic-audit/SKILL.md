---
name: business-logic-audit
description: 本项目的「业务逻辑关联性」深度审查流程（只读审计，不改代码）。当用户要求"审查业务逻辑""查业务关联性""全仓业务审计""梳理业务流程""找出跨模块不一致""业务逻辑有没有漏洞"时使用。产出：业务域地图 → 跨模块关联矩阵 → 断链/薄弱/冲突清单（每条带文件:行号证据 + 影响面 + 建议）。
description_zh: 全仓业务逻辑关联性审查（只读）：业务域地图 → 关联矩阵 → 断链与冲突清单，结论必须带函数行号与调用证据。
agent_created: true
---

# 业务逻辑关联性深度审查

## 何时用

- 用户说"审查业务逻辑""业务关联性""全仓业务审计""梳理这条业务流的全链路"
- 新接手 / 大版本前 / 怀疑"某处改了、另一处没跟上"
- **不适用**：单文件改动前的常规 review（走 `code-review-and-quality`）；只找冗余代码（走 `ponytail-audit`）

## 铁律（违反即报告作废）

1. **只读**。不写业务代码、不改 schema、不跑 migration。产物只落 `docs/` 或报告文件。
2. **每条结论必须有证据**：`文件:行号` + 关键代码片段（≤3 行）。**不许出现"可能""也许"开头的结论**——不确定就标注"待验证"并说明验证方法。
3. **不许以"设计如此"跳过**。设计如此 ≠ 关联正确；要回答"改 A 会不会影响 B"。
4. **静默即缺陷（K-050）**：审查中发现"某路径无提示地失败/被吞掉"，等级一律不低于 P1。
5. **数据口径以 `migrations/` 为准**，不以注释、不以文档为准。文档与代码冲突 → 记为"文档漂移"并给出代码真实行为。

## 第一步：建地图（不读代码正文，先拿骨架）

本项目骨架（2026-10 现状，变更需重新核对）：

| 层       | 位置                                                                                         | 规模                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 后端路由 | `server/src/routes/*.js`                                                                     | 35 个，挂在 `server/src/index.js:180-218`                                                 |
| 共性工具 | `server/src/utils/*.js`                                                                      | 22 个（含 `scope.js` 数据范围、`delete-guard.js` 级联保护、`session-engine.js` 课次引擎） |
| 中间件   | `server/src/middleware/auth.js`                                                              | JWT + 角色                                                                                |
| 表结构   | `server/src/migrations/001-030`                                                              | 46 张表（含 `*_new` 迁移中间表）                                                          |
| 前端页面 | `src/views/{attendance,finance,teaching,system,family,recruit,ai-admin,guide,login,welcome}` | 10 个业务域                                                                               |
| 前端 API | `src/api/*.ts` + 各页面内直接 `request`                                                      | 双轨，**是重点怀疑对象**                                                                  |

**抽取命令（先跑，别手抄）**

```bash
# 路由 → 表 的读写关系
node -e "const fs=require('fs');const d='server/src/routes';for(const f of fs.readdirSync(d)){const s=fs.readFileSync(d+'/'+f,'utf8');const t=[...new Set([...s.matchAll(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/gi)].map(m=>m[1]))];console.log(f.padEnd(28),t.join(','))}"

# 前端调用了哪些后端路径（含页面内直调）
grep -rnoE "(request|http)\.(get|post|put|delete|patch)\(['\"\`]/[^'\"\`]+" src --include=*.vue --include=*.ts | sed -E "s/.*\(['\"\`]//"

# 后端定义了哪些路径
grep -rnoE "router\.(get|post|put|delete|patch)\(\"[^\"]+\"" server/src/routes | sed -E 's/:[0-9]+:router\.[a-z]+\("//;s/"$//'
```

前端调用集 − 后端定义集 = **断链**（调了不存在的接口）；后端定义集 − 前端调用集 = **孤儿接口**（可能是给 `agent`/`qbank` 独立站用的，需人工判定，别直接判死）。

## 第二步：按业务域切，不按文件切

本项目 10 个域，逐个走完整链路（缺一域 = 报告不完整）：

1. 认证与权限（`auth` `users` `middleware/auth` `scope.js`）
2. 学员档案（`students` `parent_children` `user-student-link`）
3. 排课与课次（`courses` `schedules` `period-times` `rooms` `terms` `session-engine` `adjustments`）
4. 考勤与扣课（`attendance` `leaves` `makeups` `attendance-rules` `hours-reconcile` `hour_consumptions`）
5. 财务（`finance` → `orders` `payments` `refunds` `money.js`）
6. 教务与教学（`teaching-assignments` `exams` `reports` `grade.js`）
7. 增长与招生（`growth` `leads` `timeline.js` `growth_thresholds`）
8. 系统与治理（`settings` `backups` `audit-logs` `notices` `todos` `notifications` `todo-generator`）
9. AI 与题库（`ai` `agent` `qbank*` `aiSettings` `prompts` `llm`）
10. 反馈与评价（`feedback` `class_evaluations`）

## 第三步：五个维度逐域审

| 维度                 | 问什么                                                | 典型缺陷                                                          |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| **A 链路完整性**     | 前端 → API → 路由 → utils → 表 → 返回，哪一环断了     | 前端算了一遍、后端又算一遍且口径不同                              |
| **B 状态一致性**     | 同一事实是否存在多处写入源                            | 课时余额：`hour_consumptions` 累计 vs `orders` 字段 vs 前端实时算 |
| **C 权限与数据范围** | 每个路由是否真的套了 `auth` / `requireRole` / `scope` | 列表接口过滤了、详情/导出接口漏了                                 |
| **D 级联与删除**     | 删主表时子表怎么办                                    | `delete-guard.js` 是否覆盖全部外键；软删/硬删混用                 |
| **E 幂等与并发**     | 重复提交、双击、定时任务重跑                          | 生成课次/扣课/批量考勤无唯一约束                                  |

**跨域交叉点必须单独查**（这里最易出事）：
课次生成 ↔ 考勤登记 ↔ 扣课 ↔ 财务订单 ↔ 学员余额 ↔ 报表统计 ↔ 增长时间线。
同一学员的"应上课时/已消课时/剩余课时"在 4 个以上模块里各算一次 → 逐一比对公式。

## 第四步：定级

- **P0** 数据错/丢/越权：余额算错、跨角色能读别人班、删除留下孤儿数据
- **P1** 静默失败、口径不一致、级联缺失、无幂等
- **P2** 重复实现、文档漂移、命名歧义
- **P3** 可读性 / 注释过期

## 输出规范

报告写到 `docs/08-参考/业务逻辑关联性审查-<日期>.md`（与「功能做精审计」「功能重复扫描」等同类报告同目录），结构固定：

1. **一页结论**：域数 / 检查点数 / P0-P3 计数 / 最该先修的 3 件事
2. **业务域地图**：一张表（域 → 路由 → 表 → 页面 → 关键 utils）
3. **关联矩阵**：域 × 域 的依赖方向与共享表（标出"多写入源"）
4. **问题清单**：按 P0→P3，每条 `编号 | 域 | 位置 文件:行 | 现象 | 证据 | 影响面 | 建议`
5. **已验证为正确的关键边界**（写清楚"查过了没问题"，避免下轮重复审）
6. **待用户拍板的判断点**（不擅自定方案）

正文用中文。结论先给，证据在后。**不要贴大段代码**，只贴定位所需的最小片段。

## 收尾

- 报告落盘后按 `memory/PROTOCOL.md` §2 归档（日志 + CURSOR）
- `node memory/check.mjs` 必须通过
