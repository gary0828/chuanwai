# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。覆写时间：2026-09-23 11:15

## 主线位置

**白屏已修 + Docker 统一单端口 + LLM 归配置中心（已推送 gitee）；本地也跑通了统一入口（18080，9/9）。下一步：等你给服务器 SSH 地址 → 登录后做原地升级。**

| 项 | 状态 |
|---|---|
| 白屏修复 / Docker 统一 / LLM 移出 `.env` | ✅ 已推送 gitee（`d7fde7f` 等） |
| **本地统一入口** | ✅ 已起栈：9/9 PASS，教务 `/` 与工作台 `/ai/` 浏览器零报错 |
| 老三端口（本地 + 服务器） | ✅ 已废弃（容器已拆、资产已删） |
| 同步流程文档 | ✅ `docs/06-部署/本地与服务器同步.md` |
| 服务器原地升级 | ⏸ 等 SSH 地址/凭据 |

## 原则（用户拍板，K-027）
本地 = 服务器（同一份统一入口编排、端口 18080）｜老三端口彻底废弃｜只推 gitee 不推 GitHub

## ⚠ 本机硬红线
- **禁用 `git rm`**（K-028）：本机会清空整个目录。改用 `git update-index --force-remove` + `os.remove`
- 非登录 shell 调脚本会缺 `grep/sed/wc`（K-029）：三个脚本已自愈 `PATH="/usr/bin:/bin:$PATH"`
- 中文目录：`docker compose --build` 必失败 → 两步法 `docker build` + `up -d --no-build`

## 下一步
1. 拿到服务器 SSH 地址 → 登录 → **原地升级**：`backup-db.sh` → `git pull`（同目录）→
   `docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench || true` →
   `docker compose up -d --build`
2. 之后日常同步（含数据）按 `docs/06-部署/本地与服务器同步.md` 执行
