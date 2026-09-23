# PROTOCOL · 记忆读写协议（L0.5）

> 需要写记忆、或不熟悉本项目记忆约定时才读。平时不要预读。
> 版本 **v3** ｜ 2026-09-23（升级：路由化 / 软上限 / 结构护栏）

---

## §0 两条铁律（v3 新增，违反会真出事）

1. **用前先验证** —— 记忆是**提示**不是**真相**。引用"某文件 / 某端口 / 某函数存在"前，
   先 `grep` / `ls` 确认。**代码的当前状态永远赢过记忆。**
2. **不写清单** —— 凡是能靠 `grep` / `git log` / 读代码拿到的，**都不进记忆**：
   代码结构、git 历史、中间调试过程、失败尝试。**只存结论 + 为什么不这么做。**
   （记忆是"提炼"，不是"事件流水账"。）

## §1 会话启动（四步）

| 步 | 动作 | 可跳过？ |
|---|---|---|
| 1 | 读 `memory/INDEX.md`（L0，含五条硬规则） | ✗ 硬必读 |
| 2 | 读 `memory/CURSOR.md` | ✗ 硬必读 |
| 3 | **跑路由**：`node memory/route.mjs --changed`（或带上你要改的文件名）→ 按输出读 | ✗ 硬必读 |
| 4 | 需要"上次怎么做的"时才翻 `logs/` | 命中才读 |

**预算**：L0 + 必读 ≈ 5 KB；命中路由后累计建议 ≤ 15 KB。**没命中就别读**（省 token 靠这一步）。

## §2 会话结束（五条，缺一项 = 本次未归档）

1. 追加 `memory/logs/今天.md`（做了什么 / 决策 / 踩坑 / 下一步）
2. **覆写** `memory/CURSOR.md`（整体刷新，只留「主线 + 阻塞 + 下一步」）
3. 高信号条目 **Promote**：写进对应 `knowledge/<主题>.md`（**不要往 `_index.md` 塞正文**）；
   新主题文件才在 `_index.md` 加一行
4. 任务状态变化 → 改 `memory/tasks/*.md`
5. 体检：`node memory/check.mjs` —— **结构性 ERROR 必须当场修**；体积 WARN 可接受

## §3 字段规范（可追溯三要素：时间戳 + 来源 + 变更原因）

### 日志条目（append-only）

```markdown
## 14:20 | Decision | 待办双端共用一张表，按 owner_id 过滤

- 来源: 会话（用户重申「我确实要两端」）
- 影响: server/src/migrations/019*.js, src/views/todo/*
- 关联: ADR-待办双端 / T-012
```

### 知识：写在**主题文件**里（v3 变化）

- 位置：`memory/knowledge/<主题>.md`（部署 / 前端 / 后端数据 / 过程 / 本机 git / 偏好）
- 每个知识点带 **`K-NNN`** 编号；**编号只在 `_index.md` 登记一次**（谁归属哪个文件）
- 文件头 front-matter 声明触发模式（供 `route.mjs` 与文档对照）：
  ```yaml
  ---
  inclusion: fileMatch          # 或 always
  fileMatchPattern: ["docker-compose*.yml", "deploy/**"]
  ---
  ```
- **同一事实只写一处**；其它地方只放指针（`见 deploy.md K-008`）

### 任务条目

```
T-012 | doing | 待办·自动（L3 归属矩阵） | 依赖 T-008 | 阻塞：等用户确认老师可见范围 | 2026-09-21
```

## §4 谁可以写

- **主会话是唯一写入者**。子 agent 只回报，不落盘。
- `logs/` **只追加、不改昨天**；要修正就追加一条 `Correction:`。
- `INDEX.md` / `CURSOR.md` **只覆写、不追加**。

## §5 读写触发（v3 改为「文件模式」驱动）

| 触发（改了什么） | 读 | 写 |
|---|---|---|
| 会话开始 | INDEX + CURSOR + `route.mjs --changed` | — |
| `src/**` · `ai-workbench/**` | `knowledge/frontend.md` + 前端差异 | 日志 |
| `server/**` · 动 schema | `knowledge/backend-data.md` + `server/database.md` | 迁移 + model-review + 日志 |
| `docker-compose*.yml` · `deploy/**` · `server/scripts/*.sh` | `knowledge/deploy.md` + 运维约定 | 日志 |
| 涉及"谁能看到什么" | `docs/03-开发指南/权限模型.md` | 日志 |
| 用户纠正（"不对，应该…"） | `knowledge/preferences.md` | preferences **加 ★** + 日志 |
| 会被质疑的决定 | — | 新增 ADR + `_index.md` 回链 |
| 上下文将满 / 要换人 | — | 写 `HANDOFF.md` 再开新会话 |

## §6 自生长闭环（Capture → Promote → Prune → Compress）

- **Capture（随时）**：日志 append-only，宁滥勿缺。
- **Promote（会话末）**：挑 2–5 条高信号 → 进对应 `knowledge/<主题>.md`。
- **Prune（每周）**：去重 / 冲突消解 / 30 天日志移 `archive/`。
- **Compress（超限）**：软上限到了就压缩或拆文件（**不是删内容**）。

**冲突消解三规则（按顺序裁决）**
1. **时间戳新的胜出**。
2. **用户明确纠正过的胜出** —— 加 ★，★ 条目**不可被自动覆盖**，只能用户本人改。
3. **被代码事实推翻的立即标 `deprecated`** —— 不删原文，加一行「已废弃，因为 XXX」。

## §7 体积上限（v3：**全部为软上限，只提示不阻塞**）

> ★ 用户 2026-09-23 拍板（K-030）：**有用优先，体积可超**。
> 考核的是「是否真帮上开发 + 省 token」，**不是文件大小**。

| 文件 | 参考上限（软） | 超了怎么办 |
|---|---|---|
| `INDEX.md` | 90 行 / 5 KB | 正文降级为指针 |
| `CURSOR.md` | 45 行 / 2.5 KB | 完成项移 done，只留当前 |
| `logs/YYYY-MM-DD.md` | 6 KB | Promote 高信号（**不清空日志**） |
| `knowledge/_index.md` | 120 行 / 6 KB | 拆主题文件 |
| `knowledge/<主题>.md` | 10 KB | 拆文件 |
| `tasks/active.md` | 45 行 | 完成 → `done/YYYY-MM.md` |

## §8 归档

- 日志满 30 天 → `archive/YYYY-MM.md`（原文不动，只移位置）
- 完成任务 → `tasks/done/YYYY-MM.md`
- **归档 ≠ 删除**：任何「当初为什么这么做」都要能在 archive 里 grep 到
