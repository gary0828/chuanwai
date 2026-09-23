# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。覆写时间：2026-09-23 10:40

## 主线位置

**白屏已修复并推送 gitee（`0e7002e`）；Docker 已统一单端口；LLM 归「AI 配置中心」。下一步：服务器原地升级实测 →（如需）生产重建。**

| 项 | 状态 |
|---|---|
| 白屏修复 + Docker 统一 + LLM 移出 `.env` | ✅ 已提交 `0e7002e` 并推送 gitee |
| 服务器原地升级实测 | ⏸ **待用户** |
| 生产 Docker 重建（K-020） | ⏸ 待用户许可 |

## 进行中 / 阻塞

- ⚠ 遗留待拍板：`_verify_test/ui-docker-e2e.py` 是**老「三端口」专用测试，已过时**，需决定重写还是废弃；另 3 个含 `:8082` 语义断言的脚本同样待人工判断
- ⚠ git 死代理仍在（127.0.0.1:7890）：推送须加 `-c http.proxy=`；`origin`(github) 备份未推

## 下一步

1. 服务器原地升级：`bash server/scripts/backup-db.sh` → `git pull`（**同目录，不要新目录 clone**）→ `docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench 2>/dev/null || true` → `docker compose up -d --build`（数据在 `server/data/` bind mount，不丢）
2. 如需 github 备份：`git -c http.proxy= -c https.proxy= push -u origin main`
3. 生产重建待用户许可（K-020）
