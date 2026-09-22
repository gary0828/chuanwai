# INDEX · 记忆系统入口（L0）

> ★ 本文件是**唯一**的会话启动入口。任何模型、任何工具、新开或旧对话，第一步都读它。
> 读完仍不够动手 → 按 §3 指针**按需**深读；**未命中就停手，不要顺手读别的**。
> 最后更新：2026-09-21

---

## 1. 这个项目是什么（一屏）

培训机构**纯员工端 CRM**（admin / teacher 两角色；学生与家长**无账号、不登录**），单校区自用，学员 200–500 / 员工 5–15。

- 栈：Vue 3.5 + TS + Vite 7 + Element Plus（pure-admin-thin）｜ Express 4 + `node:sqlite` + JWT 双 Token + bcryptjs
- 默认账号 `admin/admin123456`、`teacher/teacher123456`（**上线必改**）
- 数据库版本：**v19** ｜ 仓库：`gitee.com/gary0828/chuanwai`（主）+ `github.com/gary0828/chuanwai`（备）
- 给人看的说明书：`README.md`（7KB 入口页）｜文档总索引：`docs/00-导航.md`

## 2. 当前进度

→ 必读 **`memory/CURSOR.md`**（40 行内：在做什么 / 卡在哪 / 下一步）

## 3. 指针表（按需读，不要预读）

| 我要… | 读 | 层 |
|---|---|---|
| 知道现在做到哪 | `memory/CURSOR.md` | L0 |
| 记忆怎么写 / 何时写 | `memory/PROTOCOL.md` | L0.5 |
| 今天 / 昨天发生了什么 | `memory/logs/YYYY-MM-DD.md` | L1 |
| 找一条约定或踩坑 | `memory/knowledge/_index.md`（一行一条） | L1 |
| 现在有哪些活 | `memory/tasks/active.md` | L1 |
| 近期要做什么 | `memory/tasks/backlog.md` | L1 |
| 代码在哪（目录 + 功能定位） | `docs/03-开发指南/项目地图.md` | L1 |
| 文档体系全貌 / ADR 索引 | `docs/00-导航.md` | L1 |
| 某个决策为什么这么定 | `docs/07-架构与决策/ADR/ADR-NNN-*.md` | L2 |
| 某条约定的完整细节 | `docs/03-开发指南/*.md` | L2 |
| 产品路线图 / 排期 | `docs/07-架构与决策/ROADMAP.md` | L2 |
| 已完成的事实档案 | `docs/08-参考/PROGRESS.md`（97KB） | L2 **按章节 grep，禁止整读** |
| 接口契约 | `docs/04-API/API.md` / `docs/04-API/openapi.yaml` | L2 |
| 数据库 schema | `server/database.md` | L2 |
| 部署 / 升级 | `docs/06-部署/校区部署与升级.md` | L2 |

## 4. 五条硬规则（违反即退化）

1. **单一入口**：只从这里进。启动时禁止读 `README.md` / `PROGRESS.md` / `WORKBUDDY.md` 全文。
2. **三级渐进**：L0 必读 → L1 命中才读 → L2 按需深读。判断依据只有一条：**这条指针的一句话够不够我动手**。
3. **一处真相**：同一事实只写在一处，其它地方只放指针。
4. **只增不删，但会降级**：详情不清空，靠压缩 / 归档 / 降级为指针控体积。
5. **纯文本 + git 追踪**：可 diff、可 blame、可 grep。不引数据库、不引向量库。

> `WORKBUDDY.md` 现只保留「不可违反的开发约束」；启动流程已交还给本文件。

## 5. 会话收尾（必做）

干完活之后按 `PROTOCOL.md` §2 的五条清单归档。**没归档 = 这次对话在下一轮里不存在。**

---

维护：本文件只允许「指针 / 状态 / 日期」三类内容。出现正文、解释或示例 → 当场移出去。
