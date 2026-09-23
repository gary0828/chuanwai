# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。只留「主线 + 阻塞 + 下一步」，细节去 `logs/` 与 `knowledge/`。
> 覆写时间：2026-09-23 11:50

## 主线位置

**白屏已修 + Docker 统一单端口 + LLM 归配置中心（已推送 gitee）；本地统一入口跑通（18080，9/9）；记忆系统已升级到 v3。下一步：等你给服务器 SSH → 原地升级。**

| 项 | 状态 |
|---|---|
| 白屏修复 / Docker 统一 / LLM 移出 `.env` | ✅ 已推送 gitee |
| 本地统一入口 | ✅ 9/9 PASS，教务 `/` 与工作台 `/ai/` 浏览器零报错 |
| 老三端口（本地 + 服务器） | ✅ 已废弃 |
| 同步流程文档 | ✅ `docs/06-部署/本地与服务器同步.md` |
| **记忆系统 v3 升级** | ✅ 已落地（路由化 / 软上限 / 结构护栏） |
| 服务器原地升级 | ⏸ **等你给 SSH 地址** |

## 原则（用户拍板）
- **K-027**：本地 = 服务器（同一份统一入口编排、18080）｜老三端口彻底废弃｜只推 gitee
- **K-030**：记忆系统**有用优先、体积可超**，考核"命中率 + 省 token"

## ⚠ 本机硬红线（详见 `knowledge/git-local.md`）
- **禁用 `git rm`**（K-028，会清空整个目录）→ 用 `git update-index --force-remove` + `os.remove`
- 命令被中断 → 先杀孤儿 git 进程 + 删 `.git/index.lock`，否则后续 git 静默失败
- 非登录 shell 调脚本缺 coreutils（K-029）→ 三脚本已自愈 `PATH="/usr/bin:/bin:$PATH"`
- 中文目录 → `docker compose --build` 必失败，走两步法 + `up -d --no-build`
- 推送必须 `-c http.proxy=` + 清 `HTTP(S)_PROXY`

## 下一步
1. **等你给服务器 SSH 地址** → 登录 → 原地升级：
   `backup-db.sh` → `git pull`（**同目录**）→ `docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench || true` → `docker compose up -d --build`
2. 之后日常同步（含数据）按 `docs/06-部署/本地与服务器同步.md`
