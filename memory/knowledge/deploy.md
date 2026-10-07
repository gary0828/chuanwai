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

## ★ K-047 · 验证脚本会**自污染**，最终把自己搞崩（K-041 的升级版，2026-09-26）

> K-041 讲的是"断言的**前置条件会过期**"。**更狠的一种**：脚本**自己改掉了它依赖的前置条件**，
> 且**没有清理机制** → 跑若干次后必然崩。**"跑越多越红"就是它的指纹。**

**真实事故**（`server/scripts/verify-sessions.mjs`）：

| 症状 | 根因 |
|---|---|
| 第 5 次跑时 `C6` 之后**直接 TypeError 崩溃**（`freeSlot[0]` on null），**后半个脚本一条都没跑** | 挪课测试**硬编码 4 个候选时段**（11-30/12-01/12-02/12-03 第 8 节），而它**每跑一次就占用一个** → 跑满 4 次候选耗尽。实测这 4 条课次 `origin='挪课'`，创建于 09-23、09-24（正是历次运行时间） |
| `C7 挪课成功` 假红：报"该课次已挪课不可重复挪课"，但 `C8` 又显示 `status=待上课` | `target = futureSessions[0]` 可能选到历次测试留下的"脏"课次（`related_session_id` 非空、状态却被恢复成待上课）→ 服务端**正确地**拒绝，红得没有意义 |

**处置（三条，可复用）**：

1. **硬编码候选 → 动态搜索**（本次改为"未来 60 天逐日找空闲时段"）
2. **取目标时排除"脏"数据**（如 `related_session_id == null` 才算干净），**别用「取第一个」**
3. **找不到就 `sk()` 如实跳过**，**绝不让脚本崩** —— 崩溃会让**后面的断言全部没跑**，
   比多一条红灯危险得多（容易被误判成"整个功能坏了"）

**判断口诀**：某脚本跑多次越来越红？先查它**有没有改数据**、**改完有没有清理**。

## ★ K-046 · 数据库备份**只有一种安全实现**：`VACUUM INTO`（2026-09-26 统一）

> 项目里备份有**两条入口**（都保留，用途不同），但**技术实现必须一致**。

| 入口 | 面向谁 | 产物 |
|---|---|---|
| 应用内「系统管理 → 数据备份」 | 校区管理员，**零依赖、可自助恢复** | `server/data/backups/backup-*.db` |
| `server/scripts/backup-db.sh` | 运维，停机外的灾难恢复通道 | `server/data/attendance-*.db` |

- ★ **两条都必须用 `VACUUM INTO`**，**不要**用 `wal_checkpoint` + `copyFileSync`：
  后者会漏掉 `-wal` 里未落页的数据，**拷出来可能是损坏库**（`backup-db.sh` 的注释早就写明这点，
  但应用内那套曾长期用 copy —— 2026-09-26 已统一）。
- 实现：`server/src/utils/backup.js` 的 `createBackup()`（`db.exec("VACUUM INTO '...'")`），
  与运维脚本同一原理；顺带去掉了原来的 `wal_checkpoint(TRUNCATE)`（`VACUUM INTO` 本身读一致视图）。
- 加固点：目标同名文件先清理；失败时**清掉半成品**（否则半成品会被 `listBackups` 当成可用备份，恢复它＝恢复损坏库）。
- **验证备份真的可用**（别只看文件存在）：
  ```bash
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('server/data/backups/backup-xxx.db');
  console.log(d.prepare('PRAGMA integrity_check').get(), d.prepare('PRAGMA foreign_key_check').all().length)"
  ```
  期望：`integrity_check = ok`、外键违规数 0、学员数/考勤数与主库一致。

## ★★ K-053 · 本机（Docker Desktop for Windows）的两条数据红线（2026-09-26 实测踩过）

> 这两条都**只影响本机**；生产（Linux 服务器）不受影响。但本机踩一次代价很大（我踩出过数据库损坏）。

### ① 宿主机进程**读不到**容器写入的数据（bind mount 一致性）

- 现象：API（容器内）看到 31 名学员，宿主机 `node` 直连 `server/data/attendance.db` 只看到 29 名。
- 后果：任何"从宿主机直接读/写库"的脚本都会**静默失效**（删不到、查不到最新数据）——
  包括 e2e 里的 SQL 兜底清理。
- **判据**：两边 size/md5 可能相同，但内容视图不同 —— 别用"文件大小一致"来判断同步。

### ② 不要在容器运行时用宿主机进程**写**数据库 → 会损坏

- 我曾在后端运行期间用宿主机 `node` 直接 `DELETE` 数据，
  随后服务端报 **`database disk image is malformed`**（数据库损坏），只能从备份恢复。
- 与 K-026「不要裸拷 attendance.db」是同一类：SQLite 在 WAL 模式下**不接受两个不同视图的写者**。
- **想操作库，就在容器内做**：
  ```bash
  cat script.js | docker exec -i attendance-server node -        # CJS 走 stdin（可用）
  # 注意：ESM（--input-type=module）走 stdin 在本机有异常；容器内绝对路径也可能因
  #       Git Bash 路径转换被改坏 → 用 sh -c '...' 或 stdin 方式，别用 docker exec node -e "/app/..."
  ```

### ③ `backup-db.sh` 在本机的失效与恢复

- `backup-db.sh` 用 `docker exec` 起**新进程**读库。后端运行一段时间后，新进程会
  报 `unable to open database file`（WAL 读视图建立不了）。
- **恢复办法：`docker restart attendance-server`**（重启后 WAL 落盘，新进程即可读；实测重启后备份成功）。
- **本机备份优先用应用内备份**：「系统管理 → 数据备份」按钮（走后端**同进程**，不受影响）。
  生产 Linux 不受此限制，运维脚本照常用。

## 验收

```bash
bash server/scripts/docker-verify.sh     # 9 项：健康/前端/SPA fallback/反代/登录/数据/持久化
```


## ★★ K-067 · 新增后端依赖必须写进 `server/package.json`（2026-10-07 容器起不来）

**症状**：本地 `node src/index.js` 一切正常，**容器里启动即崩**：
```
Error: Cannot find module 'xlsx'
Require stack: /app/src/routes/qbank.js
```

**根因**：`server/src` 的 `require` 分**两处**安装：
| 位置 | 谁用 | 装到哪 |
|---|---|---|
| 根 `package.json` | 前端 + 题库前端 | `pnpm install`（根node_modules） |
| **`server/package.json`** | 后端 | 镜像内 `npm ci --omit=dev`（**只有 server 自己的 node_modules**） |

★ **本地会向上查找 root 的 node_modules** → 掩盖了「server 没声明这个包」，
所以**本地全绿、容器必崩**。这是「本地自测通≠ 部署通」的典型。

**判据**：往 `server/src` 加 `require('xxx')` 时，先问「`server/package.json` 里有吗」。
**横向扫描命令**（一次查全）：
```bash
for p in xlsx bcryptjs cors express jsonwebtoken helmet express-rate-limit; do
  C=$(grep -rl "require('$p')" server/src 2>/dev/null | wc -l)
  D=$(grep -c "\"$p\"" server/package.json 2>/dev/null || echo 0)
  echo "$p: 用到 $C 处 / 声明 $D 处"
done
```

**正确加法**（写 lockfile，本地先验再重建镜像）：
```bash
cd server && npm install --package-lock-only --registry=https://registry.npmmirror.com <pkg>@<ver>
npm ci --omit=dev && node -e "require('<pkg>')"   # 本地先验
```

## ★★ K-068 · 开发后端与容器**争同一个库**会让备份报 `database disk image is malformed`

**症状**：跑 `server/scripts/backup-db.sh` 或任何 `VACUUM INTO` → 报 `database disk image is malformed`，
但 `docker exec ... node -e "PRAGMA integrity_check"` 若**换 Node 版本或换进程**读又是 `ok`。

**根因**：为跑验证脚本在宿主机起了 `node src/index.js`（bind mount 同一个 `server/data/attendance.db`），
它与容器内服务**同时写 WAL**。SQLite 多连接并发下 `VACUUM INTO` 快照会失败。
**这是 K-053 红线（「不要用宿主机进程在容器运行时写库」）的当场复发。**

**正确顺序**：
```bash
# ★ 任何备份/迁移/重建之前：先停开发进程
netstat -ano | grep ":3000" | grep LISTENING        # 找 PID
taskkill //F //PID <pid>
# 再确认容器服务本身健康（这才是数据好坏的判据）
docker exec attendance-server wget -qO- http://127.0.0.1:3000/api/health
```

★ **推论**：验证脚本里**不要把 API 基址硬编码成开发端口**。
`ui-qbank.py` 原写死 `127.0.0.1:3000`，重建 Docker 后该端口无监听 → 502 误报成「题库坏了」。
已改为**从页面基址推导**（同源部署下 `/api` 同 origin）。

## ★★ K-075 · 本机直连 SQLite 会读到**陈旧快照**，并让容器报 `disk I/O error`

**症状**（2026-10-07，给题库做数据卫生检查时踩到）：
- 本机 `node -e "new DatabaseSync('server/data/attendance.db')"` 读出 **33 道题**
- 同一个文件，通过**容器 API** 查只有 **2 道**
- `docker exec ... require('node:sqlite')` 直读报 **`disk I/O error`**

**根因**：`server/data` 是 bind mount，本机进程与容器内的 server **同时打开同一个 SQLite 文件**。
SQLite 的 WAL 允许多读者，但**跨容器/宿主边界**时（不同 mount namespace 的锁语义）
会出现读陈旧快照、甚至 I/O 错误。
**这是 K-068 的延伸** —— 当时只知道"备份会失败"，现在知道**读也会读到错的数据**。

**铁律**：**容器在跑时，查数据一律走 API，不要本机直连数据库文件。**
```bash
# ✗ 不要（会读到不一致快照）
node -e "...new DatabaseSync('server/data/attendance.db')..."
# ✓ 要（走服务，看到的就是真实状态）
curl -s -H "Authorization: Bearer $T" http://127.0.0.1:18080/api/qbank/overview
```

**处置**：`docker compose restart server` 可恢复（重建连接与 WAL）。
**★ 误判风险**：我曾据此以为"清理没生效"，实际是**读到了删除前的快照**，
白折腾了好几轮。**看到"数据对不上"时，先怀疑读取路径，再怀疑业务逻辑。**

## ★★ K-076 · 测试数据清理必须**循环**（软删后数据在两处之间移动）

**症状**：回收站上线后，测试数据越跑越多，最多堆了 28 道。

**根因有两层**：
1. `batch-delete` 变成软删后**不再真删**，只调它 = 数据全进回收站（第一层，容易想到）；
2. **单轮清理会漏**：数据在「正常列表」与「回收站」两处，
   一轮里「先查列表→软删，再查回收站→彻底删」，
   但**刚软删的那批在这一轮的回收站查询里可能还看不到**（下一轮才可见）。
   ⇒ 实测：单轮清了 5 道，剩 20 道留在列表里。

**正解**（`purge_by_keyword`，三个 UI 脚本共用同一份）：
**循环**「列表→软删，回收站→彻底删」，直到某一轮什么都没清掉为止（上限 5 轮）。
```python
for _ in range(max_rounds):
    n = 0
    ...清列表...; ...清回收站...
    if n == 0: break
```
**并断言最终两处都为 0**（只断言列表为 0 会漏掉回收站的堆积）。
