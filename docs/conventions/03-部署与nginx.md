# 部署与 nginx

> 目的：改任何部署 / nginx 配置前必读。**这里每条都对应一次真实事故。**

---

## ★★ 三份 nginx 必须同步

| 文件 | 形态 |
|---|---|
| `nginx.conf` | 教务端 8080 |
| `ai-workbench/nginx.conf` | 工作台 8082 |
| `deploy/nginx-unified.conf` | **统一入口**（推荐的生产形态，1 个端口） |

**漏一份 = 该形态下坏掉。** 已坏两次（① `client_max_body_size` → 上传 413；② `/assets/` 反代 → 图片 404）。

## ★★ `/assets/` 前缀陷阱（2026-09-21，症状极具迷惑性）

工作台 nginx 里反代后端资产的 location **必须收窄到 `/assets/site/`**，绝不能写 `/assets/`：

```nginx
location ^~ /assets/site/ { proxy_pass http://server:3000; }   # ✅
location ^~ /assets/      { proxy_pass http://server:3000; }   # ❌ 工作台整页白屏
```

原因：**两端产物路径不一样** ——

| 端 | 构建产物位置 |
|---|---|
| 教务端 | `/static/js/index-*.js` ← 写 `/assets/` 没事 |
| **工作台** | **`/assets/` 顶层**（`/assets/index-*.js`）← 写 `/assets/` 会**死** |

- ★★ **症状诊断口诀：`/` 返回 200 但页面空白 = 静态资源（JS/CSS）404。**
  **"根路径 200"不能证明前端正常**，必须单独验入口 JS。
- 后端资产目录约定 `server/data/assets/<kind>/`（ADR-008）；
  **新增 kind 时要在这里补一条**。
- `deploy/nginx-unified.conf` **不受影响**（工作台挂 `/ai/assets/`，且正则嵌在 `/ai/` 内部）。
- `^~` 是必需的：否则会被下面 `\.(js|css|png|...)$` 正则抢走（**正则 location 优先级高于普通前缀 location**），
  去本地 docroot 找 → 404。

## ★ `client_max_body_size` 忘了配 = 上传 413

nginx 默认仅 **1MB**，超了在 nginx 层就被拒，**请求到不了后端**。

- **判据（最快的定位法）**：同一文件经 nginx **413**、直连 `:3000` 却 **200** → **100% 是 nginx 层**
- **nginx 层的失败不进后端日志** —— 别一头扎进后端代码
- 体积三层上限必须对齐：**前端 2MB → nginx 20m → 后端 2MB**（以后端为准），超限返回 **413**（不是 400）+ 中文提示

## 形态与端口

| 形态 | 说明 |
|---|---|
| **统一入口**（推荐） | 一个 nginx 托管教务 `/` + 工作台 `/ai/` + 反代 `/api`，**对外只开 1 个端口** → `docker-compose.unified.yml` |
| 三端口 | 8080 教务 / 8082 工作台 / 3000 API，留给分离部署与本机演示 → `docker-compose.yml` |

- 8081 已被 Dify 占用；**对外无域名请用 18080**；**5180 属 Windows 保留端口段**
- **两种形态后端容器名都是 `attendance-server`**

## ★ 跳转要"跟随访问者"

`AI_WORKBENCH_URL` 配**回环地址**时，后端 `resolveWorkbenchUrl()` 会换成访问者的地址
—— 这是「AI 工作台点击进不去」的根治方案。

**跟随粒度取决于形态 —— 换的只是 hostname，不是整个 origin：**

| 形态 | 配置 | 规则 |
|---|---|---|
| A 独立端口 | `URL=...:8082`、`AI_WORKBENCH_BASE_PATH` **空** | 只换 hostname，**保留配置的端口与协议** |
| B 统一入口 | `URL=http://localhost`、`BASE_PATH=/ai` | 跟随**完整 origin**，再补 `/ai` |

判据：**`AI_WORKBENCH_BASE_PATH` 非空即同源部署。** 形态 A 误用完整 origin → 得到 `访问者:8080`（教务系统，无 `/sso`）→ **404**。

## ★ 重建 server 后必须 reload 教务端 nginx

`docker restart attendance-server` 之后，要 `docker exec attendance-web nginx -s reload`
—— 否则 nginx 里缓存的旧 upstream 解析会导致 502。

---

## 相关

- 完整部署流程：`docs/校区部署与升级指南.md`
- 合规（非标准高位端口可绕开 ICP 备案）：同上文
- 两端产物路径差异：`01-前端两端差异.md`
