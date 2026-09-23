# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。覆写时间：2026-09-23 11:30

## 主线位置

**白屏已修复 + Docker 统一单端口 + LLM 归「AI 配置中心」，已推送 gitee；老三端口资产已废弃。下一步：服务器原地升级实测。**

| 项 | 状态 |
|---|---|
| 白屏修复 / Docker 统一 / LLM 移出 `.env` | ✅ 已推送 gitee |
| 老三端口资产废弃 | ✅ 已删（`ai-workbench/{Dockerfile,nginx.conf}`） |
| ★ `git rm` 误删 `ai-workbench/` 事故 | ✅ 已完全恢复（见 `logs/2026-09-23.md#11:20`） |
| 服务器原地升级实测 | ⏸ **待用户** |
| 生产 Docker 重建（K-020） | ⏸ 待用户许可 |

## 原则（用户拍板，K-027）
本地 = 服务器（同一份统一入口编排、端口 18080）｜老三端口彻底废弃｜只推 gitee

## ⚠ 本机硬红线（K-028，务必遵守）
- **绝不用 `git rm`** —— 本机会连带清空整个目录。删文件用
  `git update-index --force-remove`（纯索引）+ 工作区 `os.remove`；恢复用 `git checkout <commit> -- <path>`
- 命令被中断 → 先查/杀**孤儿 git 进程**，再删 `.git/index.lock`，否则后续 git 操作静默失败
- 清理临时文件**勿用 `_` 前缀匹配**（曾误删 `memory/knowledge/_index.md`）

## 下一步
服务器原地升级：`bash server/scripts/backup-db.sh` → `git pull`（同目录，勿开新目录）→
`docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench 2>/dev/null || true` →
`docker compose up -d --build`（数据在 `server/data/` bind mount，不丢）
