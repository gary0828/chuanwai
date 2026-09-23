---
inclusion: fileMatch
fileMatchPattern:
  ["docker-compose*.yml", "deploy/**", "Dockerfile*", "server/scripts/*.sh", ".env", ".env.*", ".dockerignore"]
---

# 部署与运维（L2 · 主题）

> 深读：`docs/06-部署/运维约定.md`（nginx 事故）、`docs/06-部署/校区部署与升级.md`（升级/回滚）、
> `docs/06-部署/本地与服务器同步.md`（含数据同步）。

## 形态与端口（K-022）

- **只有一份编排** `docker-compose.yml` = 统一入口单端口：教务 `/` ＋ 工作台 `/ai/` ＋ 后端 `/api`
- 对外端口取 `.env` 的 `WEB_PORT`（本机与现网均为 **18080**）；**后端 3000 不对外暴露**
- 本地 dev：前端 `8848`、后端 `3000`（后端要**本地起** `npm run dev`，别指望容器给 3000）
- 老三端口（8080 / 8082 / 3000 三个容器）**已彻底废弃**，相关镜像 / nginx / e2e 均已删除
- 默认账号 `admin/admin123456`、`teacher/teacher123456`（**上线必改**）

## 数据保命（K-026）

- 数据在宿主机 `<项目目录>/server/data/`（compose 的 `- ./server/data:/app/data` bind mount）
- **同目录 `git pull` + 重建**才原地保留；**另开新目录 clone** 会灌种子演示数据
- 升级前先 `bash server/scripts/backup-db.sh`（`VACUUM INTO` 热快照）
  —— ★ **不要裸拷 `attendance.db`**：WAL 模式下会拷出损坏文件
- 资产在 `server/data/assets/`，同步数据时一起带走
- `.env`（含 `JWT_SECRET`）也要带；换了密钥 → 全员强制重新登录

## 踩过的坑

- **K-008 · nginx `/assets/` 前缀**：工作台自托管时代，把反代写成 `location ^~ /assets/` 会**整页白屏**，
  必须收窄到 `/assets/site/`。那份 nginx 已删除，但**原理仍然适用**：
  正则 location 优先级高于普通前缀 location → `/ai/assets/*` 会被顶层 `\.(js|css)$` 抢走再 404。
- **K-029 · 非登录 shell 缺 coreutils**：`bash xxx.sh` 不加载 `/etc/profile`，Windows 下
  `/usr/bin` 可能不在 PATH → `grep/sed/wc/cut/tr/tail` 全部 `command not found`
  → **断言无法求值，接口明明返回 200 却误报 FAIL**（实测 9 项里 6 项假失败）。
  本项目 `docker-verify.sh` / `backup-db.sh` / `restore-db.sh` 已自愈，**新写脚本照抄**：
  ```bash
  PATH="/usr/bin:/bin:$PATH"
  ```
- **中文目录**：`docker compose up --build` 必失败（Docker Desktop gRPC 不支持非 ASCII 路径）→ 两步法：
  ```bash
  docker build -t attendance-system-server  -f server/Dockerfile .
  docker build -t attendance-system-unified -f deploy/Dockerfile.unified .
  docker compose up -d --no-build
  ```
  根治办法：项目放纯 ASCII 路径。

## 验收

```bash
bash server/scripts/docker-verify.sh     # 9 项：健康/前端/SPA fallback/反代/登录/数据/持久化
```
