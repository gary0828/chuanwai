# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。覆写时间：2026-09-23 11:00

## 主线位置

**白屏已修 + Docker 统一单端口 + LLM 归「AI 配置中心」，已推送 gitee；老三端口相关资产按用户拍板全部废弃。下一步：服务器原地升级实测。**

| 项 | 状态 |
|---|---|
| 白屏 / Docker 统一 / LLM 移出 `.env` | ✅ 已推送（`0e7002e`、`011d4be`） |
| 老三端口资产废弃 | ✅ 已删：`ai-workbench/{Dockerfile,nginx.conf}`、`_verify_test/ui-docker-e2e.py` |
| 服务器原地升级实测 | ⏸ **待用户** |
| 生产 Docker 重建（K-020） | ⏸ 待用户许可 |

## 原则（用户 2026-09-23 拍板，K-027）

- **本地 = 服务器**：同一份统一入口编排，端口 **18080**
- **老三端口彻底废弃**（服务器与本地都不再用，相关资产一并删）
- **GitHub 不做**，只推 gitee

## 进行中 / 阻塞

- ⚠ 待用户决定：`_verify_test/ui-provider-degrade.py`、`verify-workbench-origin.mjs` 测的是**代码行为**（降级链路 / 跳转推导），**未废弃**，但需重写以适配统一入口
- ⚠ git 死代理仍在（127.0.0.1:7890）：推送须加 `-c http.proxy=`

## 下一步

服务器原地升级：`bash server/scripts/backup-db.sh` → `git pull`（同目录）→
`docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench 2>/dev/null || true` →
`docker compose up -d --build`（数据在 `server/data/` bind mount，不丢）
