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
- **K-040 · `docker compose up -d --no-build` 不一定会重建容器**（2026-09-23 实测踩中）
  ★ 两步法建完新镜像后跑它，输出是 `Container xxx Running` 而**不是 `Recreate`** →
  **容器仍在跑旧镜像**。实测证据：容器 `image=b3510bcf…`（20:50 建的），而刚构建的镜像是 `8e659029…`。
  → **必须显式加 `--force-recreate`**：
  ```bash
  docker compose up -d --force-recreate --no-build
  ```
  取证命令（别凭"我刚 build 过"下结论）：
  ```bash
  docker images --format "{{.Repository}} {{.ID}}" | grep attendance-system
  docker inspect -f '{{.Name}} image={{.Image}} started={{.State.StartedAt}}' attendance-server attendance-unified
  ```
  → 两边 ID 前缀一致才算真的在跑最新版。

## QA 断言的前置条件会过期（K-041 · 2026-09-23）

> 迁移类验证脚本常写"正式库仍是旧版本 / 无新表"这类**前置快照断言**。
> 一旦迁移真的应用了，这些断言**必然失败** —— 但这恰恰是成功的结果，**不是缺陷**。

- 处置：前置条件不适用时**改为 SKIP 并写明原因**，而不是留红 FAIL
  （`server/scripts/verify-sessions.mjs` A1/A14/A15 已按此改造，新增 `sk()` + 汇总里**单独列出跳过项**
  并注明「不是失败」）。
- ★ 红 FAIL 只应代表**真缺陷**；否则下次排障会被虚假红灯带偏（与 K-011「断言打印实际值」同源）。
- 判断口诀：**这条断言失败，说明功能坏了，还是说明环境状态变了？** 后者 → SKIP。
- **中文目录**：`docker compose up --build` 必失败（Docker Desktop gRPC 不支持非 ASCII 路径）→ 两步法：
  ```bash
  docker build -t attendance-system-server  -f server/Dockerfile .
  docker build -t attendance-system-unified -f deploy/Dockerfile.unified .
  docker compose up -d --no-build
  ```
  根治办法：项目放纯 ASCII 路径。

## K-043 · 生产库升级：先构建后切换 + 先查 `git remote`（2026-09-24 写手册时固化）

> 给「老师正在用」的服务器升级时，这两条能把风险压到最低。完整照抄步骤见
> `docs/06-部署/服务器升级-小白操作手册.md`。

### ① 低停机：拆成两步，别让构建时间算进停机窗口

- ❌ 原写法 `docker compose up -d --build --force-recreate`：**构建 3–8 分钟全在服务不可用状态**
- ✅ 正确：
  ```bash
  docker compose build                              # 旧容器照常服务，用户完全无感
  docker compose up -d --no-build --force-recreate  # 停机仅 10–30 秒
  ```
- 原理：镜像建好前旧容器一直在跑；`--force-recreate` 才真正换容器（K-040，缺了它不换）。

### ② ★ `git pull` 前必看 `git remote -v`

- 项目**只推 gitee**（K-027），**github 那份是几个月前的旧代码**。
- 服务器若 `origin` = github → `git pull` **会成功但拉到旧版**，表现为"升级完成"而版本没变，**极难察觉**。
- 处置：
  ```bash
  git remote -v
  git pull https://gitee.com/gary0828/chuanwai.git main
  git remote set-url origin https://gitee.com/gary0828/chuanwai.git   # 顺手改回来
  ```
- 升级后**必须核对** `git log --oneline -1` 是否等于预期 commit，别只看命令没报错。

### ③ 回滚优先级（给非工程师时尤其重要）

1. **PVE 虚拟机快照回滚** —— 一键、连数据一起回，最可靠
2. 命令行：`stop` → `restore-db.sh` 还原数据 → `git checkout` 退回旧代码 → 重建
   ⚠️ **迁移单向**：只回程序或只回数据**都会起不来**，两个必须一起回

## 验收

```bash
bash server/scripts/docker-verify.sh     # 9 项：健康/前端/SPA fallback/反代/登录/数据/持久化
```
