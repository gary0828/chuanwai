# PROTOCOL · 记忆读写协议（L0.5）

> 需要写记忆、或不熟悉本项目记忆约定时才读。平时不要预读。
> 版本 v2 ｜ 2026-09-21

---

## §1 会话启动（四步）

| 步 | 动作 | 可跳过？ |
|---|---|---|
| 1 | 读 `memory/INDEX.md` | ✗ 硬必读 |
| 2 | 读 `memory/CURSOR.md` | ✗ 硬必读 |
| 3 | 读 `logs/今天.md` + `logs/昨天.md`（存在才读） | 存在即读 |
| 4 | 按 INDEX §3 指针**按需**读 L1/L2 | 未命中就停在第 3 步 |

**预算**：L0 ≤ 6 KB（约 1.5k token）；常规任务累计 ≤ 15 KB。

## §2 会话结束（五条，缺一项 = 本次未归档）

1. 追加 `logs/今天.md`（做了什么 / 决策 / 踩坑 / 下一步）
2. **覆写** `CURSOR.md`（整体刷新，不是追加）
3. 新增决策 / 约定 / 偏好 → 写详情 + 在 `knowledge/_index.md` 加一行
4. 任务状态变化 → 改 `tasks/*.md`
5. 体检：`node memory/check.mjs`，超限当场裁剪

## §3 字段规范（可追溯三要素：时间戳 + 来源 + 变更原因，缺一不可）

### 日志条目（append-only）

```markdown
## 14:20 | Decision | 待办双端共用一张表，按 owner_id 过滤

- 来源: 会话（用户重申「我确实要两端」）
- 影响: server/src/migrations/019*.js, src/views/todo/*
- 关联: ADR-待办双端 / T-012
- 原因: 曾误做成两套表，权限边界对不上，返工
```

### 类型枚举（决定条目最终落在哪）

| 类型 | 含义 | 归宿 |
|---|---|---|
| `Decision` | 做了个选择，三个月后会被重新质疑 | `docs/07-架构与决策/ADR/ADR-NNN-*.md` |
| `Convention` | 写代码 / 改配置必须遵守的约定 | `docs/03-开发指南/*.md` |
| `Pitfall` | 踩过的坑、环境诡异 | `docs/03-开发指南/*.md` |
| `Preference` | 用户偏好（沟通方式、流程门禁） | `knowledge/preferences.md` |
| `Task` | 待办 / 进行中 / 已完成 | `tasks/*.md` |
| `Fact` | 稳定客观事实（版本、端口、账号） | `INDEX.md` 或对应详情 |

### 知识索引条目（`knowledge/_index.md`，一行一条）

```
K-017 | Pitfall | 前端·工作台 | CSS 变量是 --c-*，写成 --brand 静默失效 | docs/03-开发指南/前端两端差异.md#工作台 | active | 2026-09-21 | 事故：整页无样式
```

字段：`id | 类型 | 主题 | 一句话结论 | 详情文件#锚点 | 状态 | 更新于 | 来源`

### 任务条目

```
T-012 | doing | 待办·自动（L3 归属矩阵） | 依赖 T-008 | 阻塞：等用户确认老师可见范围 | 2026-09-21
```

## §4 谁可以写（单一写入者）

- **主会话是唯一写入者**。子 agent 只回报，不落盘。
- `logs/` **只追加、不改昨天**。要修正就追加一条 `Correction:`。
- `INDEX.md` / `CURSOR.md` **只覆写、不追加**。

## §5 读写触发表

| 触发 | 读 | 写 |
|---|---|---|
| 会话开始 | INDEX + CURSOR + 近两天日志 | — |
| 会话结束 | — | 日志 + CURSOR（+ 知识 / 任务） |
| 新增前端页面 | `conventions/01` | 日志 |
| 改后端 / 动 schema | `conventions/02` + `server/database.md` | 迁移脚本 + 日志 |
| 改 nginx / docker | `conventions/03` | 日志 |
| 涉及「谁能看到什么」 | `conventions/04` | 日志 |
| 用户纠正（"不对，应该…"） | `knowledge/preferences.md` | preferences **加 ★** + 日志 |
| 会被质疑的决定 | — | 新增 ADR + `_index` 回链 |
| 文件超上限 | 该文件 | 压缩 / 降级 / 归档 |

## §6 自生长闭环（Capture → Promote → Prune → Compress）

- **Capture（随时）**：日志 append-only，宁滥勿缺。
- **Promote（会话末）**：从日志挑 2–5 条高信号 → 进 `knowledge/_index.md` 或 `tasks/`。
- **Prune（每周）**：去重（同主题只留一行）/ 冲突消解 / 30 天日志移 `archive/`。
- **Compress（超限）**：见 §7。

**冲突消解三规则（按顺序裁决）**
1. **时间戳新的胜出**（默认）。
2. **用户明确纠正过的胜出** —— 加 ★，★ 条目**不可被自动覆盖**，只能用户本人改。
3. **被代码事实推翻的立即标 `deprecated`** —— 不删除，保留原文 + 一行「已废弃，因为 XXX」。

## §7 体积上限与超限处理

| 文件 | 上限 | 超限动作 |
|---|---|---|
| `INDEX.md` | 80 行 / 4 KB | 正文降级为指针 |
| `CURSOR.md` | 40 行 / 2 KB | 完成项移 done，只留当前 |
| `logs/YYYY-MM-DD.md` | 6 KB | Promote 高信号，日志不清空 |
| `knowledge/_index.md` | 6 KB | 同主题合并，详情外移 |
| `tasks/active.md` | 20 条 | 完成 → `done/YYYY-MM.md` |
| `tasks/backlog.md` | 60 条 | 90 天未动 → 删条目留一行「已放弃 + 原因」 |
| L2 详情单文件 | 8 KB | 拆文件 |

## §8 归档

- 日志满 30 天 → `archive/YYYY-MM.md`（原文不动，只移位置）
- 完成任务 → `tasks/done/YYYY-MM.md`
- **归档 ≠ 删除**：任何「当初为什么这么做」都要能在 archive 里 grep 到
