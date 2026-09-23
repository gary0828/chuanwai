# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。覆写时间：2026-09-23 10:30

## 主线位置

**生产白屏已修复（开发+本地验证完成）；Docker 已统一单端口；LLM 归「AI 配置中心」。卡在：等用户实测 → 推送 gitee → 生产重建。**

| 项 | 状态 |
|---|---|
| 白屏（`.env.production` 被 gitignore 吞） | ✅ 已修 + 本地验证（0 pageerror） |
| Docker 统一单端口 / LLM 移出 `.env` | ✅ 已改 |
| 用户实测 → 推送 → 生产重建 | ⏸ 待用户 |

## 进行中 / 阻塞

- ⏸ 本批改动未提交（清单见 `logs/2026-09-23.md`）
- ⚠ 遗留待拍板：① 本地验证脚本端口（`_verify_test/` 已改 21 个；4 个含 `:8082` 语义断言的文件需人工判断）② 根 `Dockerfile`/`nginx.conf` 已删；`ai-workbench/{Dockerfile,nginx.conf}` 保留（供工作台单独部署）
- ⚠ git 死代理仍在（127.0.0.1:7890）：推送须加 `-c http.proxy=`

## 下一步

1. 用户实测：同目录 `git pull`（**不要新目录 clone**）→ `docker compose up -d --build`，数据在 `server/data/` bind mount 不丢
2. 通过后推送：`git -c http.proxy= -c https.proxy= push gitee main`
3. 生产重建（K-020 单独问）：先 `docker rm -f attendance-server attendance-unified attendance-web attendance-ai-workbench 2>/dev/null || true` 再 up
