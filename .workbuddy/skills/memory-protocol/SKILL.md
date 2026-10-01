---
name: memory-protocol
description: 项目记忆系统的读写协议。当会话开始需要接续进度、会话结束需要归档、要新增决策/约定/偏好/任务、或 memory/ 文件体积偏大时加载。不调用不占上下文。
agent_created: true
---

# 记忆协议（memory-protocol）

> 本 skill 是 `memory/PROTOCOL.md` 的**执行入口**（v3 · 2026-09-23）。协议细节全在那份文件里，这里只给动作清单。
> 触发词：会话开始 / 收尾归档 / 记一条决策 / 不知道现在做到哪。

## 会话开始（四步）

1. 读 `memory/INDEX.md` —— 唯一入口，硬必读
2. 读 `memory/CURSOR.md` —— 当前进度，硬必读
3. **跑路由**：`node memory/route.mjs --changed`（还没改动就带上你打算改的文件）→ **只读它列出的**
4. `memory/logs/今天.md` + `昨天.md`（存在才读）；要"上次怎么做的"才翻

预算：L0 + 必读 ≈ **5 KB**。**没命中路由就别读**（省 token 靠这一步）。
禁止启动时整读 README / PROGRESS / WORKBUDDY 全文。

## 会话结束（五条，缺一项 = 本次未归档）

1. 追加 `memory/logs/今天.md`（做了什么 / 决策 / 踩坑 / 下一步）
2. **覆写** `memory/CURSOR.md`（整体刷新；只留「主线 + 阻塞 + 下一步」）
3. 高信号 **Promote** 到 `memory/knowledge/<主题>.md` —— **不要往 `_index.md` 塞正文**；
   只有新建主题文件时才在 `_index.md` 加一行
4. 任务状态变化 → 改 `memory/tasks/*.md`
5. 跑 `node memory/check.mjs` —— **结构性 ERROR 当场修**；体积 WARN 可接受

## 两条铁律（v3 新增）

1. **用前先验证** —— 记忆是提示不是真相；引用"某文件/某端口存在"前先 `grep`/`ls`。
   **代码的当前状态永远赢过记忆。**
2. **不写清单** —— 能靠 `grep` / `git log` / 读代码拿到的都不进记忆（代码结构、git 历史、
   中间调试过程）。**只存结论 + 为什么。**

## 写入硬规则

- **日志只追加**，不改昨天；要修正追加一条 `Correction:`
- **INDEX / CURSOR 只覆写**，不追加
- **主会话是唯一写入者**，子 agent 只回报
- 每条记录必带：**时间戳 + 来源 + 变更原因**
- **一处真相**：同一事实只写一处，其它地方放指针（`见 deploy.md K-008`）

## 冲突消解（按顺序裁决）

1. 时间戳新的胜出
2. 用户明确纠正过的胜出（加 ★，**不可被自动覆盖**）
3. 被代码事实推翻的标 `deprecated`，不删除

## 体积（v3：**软上限，只提示不阻塞**）

> ★ 用户拍板（K-030）：**有用优先，体积可超**。考核"是否真帮上开发 + 省 token"，不是文件大小。

| 文件 | 参考上限（软） |
|---|---|
| INDEX.md | 90 行 / 5 KB |
| CURSOR.md | 45 行 / 2.5 KB |
| logs/日 | 6 KB |
| knowledge/_index.md | 120 行 / 6 KB |
| knowledge/<主题>.md | 10 KB |
| tasks/active.md | 45 行 |

30 天日志 → `memory/archive/YYYY-MM.md`；完成任务 → `memory/tasks/done/YYYY-MM.md`。

## 结构性护栏（`check.mjs` 会拦，这些才是 ERROR）

必备文件缺失 / **记忆文件在 git 中消失** / 目录列的文件不存在 / 死链 /
**未登记的 K-id（孤儿知识）** / 索引登记了但文件里找不到 / 敏感数据混入 / 部署配置引用 memory/

## 常见错误

- 把正文写进 `_index.md` → 索引是目录，正文写主题文件
- 待决策写进 PROGRESS → 事故：铃铛 09-14 被记进 PROGRESS，失踪 7 天
- 写完不跑 `check.mjs` → 结构性问题不会自己消失
- **用 `git rm` 删记忆文件** → 本机会连带清空整个目录（见 `knowledge/git-local.md` K-028）
- 清理临时文件时用 `_` 前缀匹配 → 会误删 `knowledge/_index.md`

---

## 运行中发现的约定（2026-10-01 补，均来自实测）

### ① 一件事只写一处（避免三处重复维护）

现状是同一件事会被写三遍：平台注入的 `.workbuddy/memory/YYYY-MM-DD.md`、
项目 `memory/logs/YYYY-MM-DD.md`、以及 `CURSOR.md` 的摘要 —— 双倍维护且可能不一致。

**约定**：
- **细节只写 `memory/logs/`**（append-only，最完整）
- `CURSOR.md` 只写「现在在哪 / 卡在哪 / 下一步」的**指针**，不重复细节
- 跨项目/跨工具的事实才写平台记忆 `.workbuddy/memory/`，**不写项目内的东西**
- 已晋升为长期知识的（K 条目 / ADR）→ 日志里只留**指针**，不复制正文

### ② 日志体积现在是「硬门禁」（不再只是提醒）

2026-10-01 之前的实测：软上限（6 KB）**从未被执行过** —— 6 个日志全部超标，
最大一个到 **59 KB**，每次只 WARN 就过去了，日志退化成流水账。

**现在的口径**（`check.mjs`）：
| 体积 | 行为 |
|---|---|
| ≤ 6 KB | 正常 |
| 6–12 KB | WARN（提醒，不阻塞） |
| **> 12 KB** | **ERROR —— 必须处理**：把高信号 Promote 到 `memory/knowledge/*.md`，再精简或移入 `memory/archive/` |

> 配套动作：`memory/archive/` 存归档日志（内容不丢，仍可检索；`check.mjs` 不扫该目录）。

### ③ 项目 skill 已链接到用户级（改项目目录即生效）

四个项目 skill 原先放在 `.workbuddy/skills/`，而 Skill 工具只扫 `~/.workbuddy/skills/`
→ **全都加载不到**，只能靠「记得直接 Read」撑着，新会话一断就失效。

**现已用 Windows junction 链接**（一份内容、两处可见，无需管理员权限）：
`~/.workbuddy/skills/<name>` → `<项目>/.workbuddy/skills/<name>`

所以：**改项目里的 SKILL.md 就等于改了用户级那份**，两处永远是同一份内容。
若在新机器/clone 后发现 skill 加载不到，重跑一次链接即可（见本文末命令）。

### ④ 两个检查脚本的分工（别混）

| 脚本 | 管什么 | 何时跑 |
|---|---|---|
| `node memory/check.mjs` | **记忆结构**：必备文件 / 死链 / 孤儿 K-id / 日志体积 / 敏感数据 | 每次归档收尾 |
| `node _verify_test/preflight.mjs` | **代码与文档的一致性**：过时表述 / 迁移连续性 / SQL 注入 / 调试残留 / 行尾提示 | 每次提交前 |

> ★ `preflight.mjs` **内部用 node 读文件，不调用任何外部 grep** ——
> 因为本环境的 shell `grep -r` 会**静默漏返回**（2026-10-01 因此漏改 7 处内容）。

### ⑤ 「只读记忆能否接上」要定期复验

2026-09-23 做过一次「零上下文新会话盲测」（6/6 全对，自评能接手），
但那之后记忆规模翻倍、库迁到 v25、菜单重构 3 次 —— **通道存在 ≠ 每次都被走**。

**复验清单**（开新会话，只允许读 `memory/`，回答）：
1. 项目是什么 / 给谁用
2. 部署形态与端口 / 容器名
3. 最近的事故与硬红线（本机 git 红线、容器数据红线）
4. 当前进度、卡在哪、下一步
5. 最近一次「用户拍板」是什么（含被推翻的）
6. 要改后端某模块，该读哪几份

任一条答不上来 → 说明对应内容没被写进记忆，或没被路由到。

### 重建设 skill 链接（新机器 / 重新 clone 后）

```bash
node -e "
const fs=require('fs'),p=require('path');
const P=p.join(process.cwd(),'.workbuddy','skills');
const U=p.join(require('os').homedir(),'.workbuddy','skills');
fs.mkdirSync(U,{recursive:true});
for(const n of fs.readdirSync(P)){
  const t=p.join(P,n), l=p.join(U,n);
  if(fs.existsSync(l)) continue;
  fs.symlinkSync(t,l,'junction'); console.log('链接:',n);
}"
```
