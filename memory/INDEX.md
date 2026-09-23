# INDEX · 记忆系统入口（L0）

> ★ 本文件是**唯一**的会话启动入口。任何模型、任何工具、新开或旧对话，第一步都读它。
> 读完按 §3 **按需**读；**未命中就停手，不要顺手读别的**（省 token 靠的就是这一步）。
> 最后更新：2026-09-23

---

## 1. 这个项目是什么（一屏）

培训机构**纯员工端 CRM**（admin / teacher 两角色；学员与家长**无账号、不登录**），单校区自用，学员 200–500 / 员工 5–15。

- 栈：Vue 3.5 + TS + Vite 7 + Element Plus（pure-admin-thin）｜ Express 4 + `node:sqlite` + JWT 双 Token + bcryptjs
- 默认账号 `admin/admin123456`、`teacher/teacher123456`（**上线必改**，后端启动会告警）
- 数据库版本：**v19** ｜ 仓库：`gitee.com/gary0828/chuanwai`（**唯一推送目标**）
- 给人看的说明书：`README.md` ｜文档总索引：`docs/00-导航.md`

## 2. 当前进度

→ 必读 **`memory/CURSOR.md`**（在做什么 / 卡在哪 / 下一步）

## 3. 该读什么（★ 用路由脚本，不要凭感觉）

```bash
node memory/route.mjs --changed            # 按本次 git 改动自动算
node memory/route.mjs src/views/Home.vue   # 按指定文件算
node memory/route.mjs --list               # 看完整路由表
node memory/route.mjs --changed --quiet    # 只输出路径清单（给脚本用）
```

路由的**机器唯一源**是 `memory/route.mjs`（改路由＝改它）。人看的目录在 `memory/knowledge/_index.md`。

**每会话必读**（已在脚本里硬编码，约 5 KB）：
`CURSOR.md` · `knowledge/process.md` · `knowledge/git-local.md` · `knowledge/preferences.md`

## 4. 五条硬规则（违反即退化）

1. **单一入口**：只从这里进。启动时**禁止**读 `README.md` / `docs/08-参考/PROGRESS.md` / `WORKBUDDY.md` 全文。
2. **按需加载**：`route.mjs` 说读什么就读什么，**没命中不要顺手读**。省 token 的杠杆在这里，不在把文件压小。
3. **一处真相**：同一事实只写一处，其它地方只放指针。文档地图的权威是 `docs/00-导航.md`，记忆不重复维护它。
4. **索引不是容器**：`knowledge/_index.md` 一行一个*主题文件*；**正文写进主题文件**。
5. **纯文本 + git 追踪**：可 diff、可 blame、可 grep。**不引数据库、不引向量库**。

> ★ 记忆系统总原则（用户 2026-09-23 拍板，K-030）：**有用优先，体积可超**。
> 考核「是否真帮上开发 + 省 token」，**不考核文件大小**；体积上限是**软上限**（超了只提示）。
> 护栏查的是**结构性**问题（文件消失 / 死链 / 敏感数据 / 多源真相）—— 见 `knowledge/process.md`。

## 5. 会话收尾（必做）

按 `PROTOCOL.md` §2 归档，然后 `node memory/check.mjs`。
**没归档 = 这次对话在下一轮里不存在。**

---
维护：本文件只允许「指针 / 状态 / 日期」三类内容。出现正文、解释或示例 → 当场移出去。
