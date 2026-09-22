# AGENTS.md

> 本项目的**会话启动入口**是 `memory/INDEX.md`。**先读它，再动手。**
> 这是模型无关 / 工具无关的约定文件——不论你是什么模型、什么编辑器、新开还是旧对话，都从这一个文件进。

## 三步启动

1. 读 `memory/INDEX.md`（唯一入口，含项目一屏介绍与指针表）
2. 读 `memory/CURSOR.md`（当前进度：在做什么 / 卡在哪 / 下一步）
3. 按 INDEX §3 的指针**按需**读详情——**未命中就停手，不要顺手读别的**

## 收尾

干完活按 `memory/PROTOCOL.md` §2 的五条清单归档（写日志 + 覆写 CURSOR + 增量知识/任务 + 跑 `node memory/check.mjs`）。
**没归档 = 这次对话在下一轮里不存在。**

## 禁止

- 启动时整读 `docs/08-参考/PROGRESS.md`（97KB）/ `WORKBUDDY.md` 全文（`README.md` 已是 7KB 入口页，可读）
- 往 `memory/INDEX.md` 里堆正文（只允许指针 / 状态 / 日期）
- 改昨天的日志（要修正就追加 `Correction:`）
