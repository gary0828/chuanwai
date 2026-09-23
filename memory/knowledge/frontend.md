---
inclusion: fileMatch
fileMatchPattern: ["src/**", "ai-workbench/**", ".env.*", "vite.config.ts", "build/**"]
---

# 前端（L2 · 主题）

> 深读：`docs/03-开发指南/前端两端差异.md`（**两端差异**，改页面必读）、
> `docs/03-开发指南/前端视觉规范.md`（配色/组件）。
> 条目：K-002 · K-003 · K-025 · **K-036（凭证已吊销后必须静默登出）**

## 凭证已被服务端吊销后：必须静默登出（K-036 · 2026-09-23）

> ★ 凡是「**服务端已经把凭证吊销掉了**」之后再想登出的场景，**不要**调 `useUserStoreHook().logOut()`。

- `logOut()` 会先发 `POST /api/auth/logout`（带上当前 token）→ 而 token 已被吊销 → **必然 401**
  → 撞上 `src/utils/http/index.ts` 的全局 401 处理 `handleAuthFailure()` → 弹**红色「登录状态已失效」**。
  表现为：用户刚做完一件成功的事（如改密成功），却看到报错。
- 正确做法：用 `resetLoginState()`（store 已提供）—— **只清本地登录态 + 回登录页，不通知服务端**。
- 当前唯一使用者：自助改密码成功之后（服务端在改密时已 `revokeTokens`）。
  将来任何"服务端先吊销"的流程照此办理。
- 判断口诀：**这次登出是我主动发起的吗？** 是 → `logOut()`；凭证已被别人吊销 → `resetLoginState()`。

## 两端差异（本项目的核心认知）

| 端 | 产物位置 | 谁在用 |
|---|---|---|
| 教务端 `src/` | `/static/js/index-*.js` | admin / teacher 办公用 |
| AI 工作台 `ai-workbench/src/` | **`/assets/` 顶层**（`/assets/index-*.js`） | 一线老师教学用 |

- 工作台挂 `/ai/`（统一入口），构建产物路径与教务端**不同** → 改 nginx 的 `/assets` 反代要格外小心（见 `deploy.md` K-008）
- 两端**共用一套视觉语言**，但工作台有自己的构建与 base

## 踩过的坑

- **K-002 · CSS 变量名**：工作台变量是 `--c-*`，写成 `--brand` / `--line` 会**静默失效**（不报错，整页无样式）
- **K-003 · 照抄同类页面**：新增页面没照抄同类页面的控件与间距，用了原生控件 → 被质疑"像白板"、返工。
  **新增页面前先找同类页面抄结构**。
- **K-025 · 构建期 env 必须入库**（白屏事故，2026-09-23）：
  `.env.production` 曾被 `.gitignore` 的 `.env.*` 一并忽略 → `git clone` 部署时
  `VITE_ROUTER_HISTORY` 被内联为 `undefined` → `getHistoryMode()` 里 `undefined.split(",")`
  → **应用启动瞬间崩溃、整页白屏**。
  已修：① `.gitignore` 只忽略真密钥（`.env` / `*.local`），放行 `.env.development` / `.env.production` / `.env.staging`
  ② `getHistoryMode` 加默认参数 `"hash"` + 非法值兜底。
  ★ 教训：**构建期 env 是代码的一部分，不是密钥**，必须入库。

## 诊断口诀

- **`/` 返回 200 但页面空白** = 静态资源（JS/CSS）404，**不是**后端问题 → 单独验入口 JS 的 URL
- 控制台出现 `Cannot read properties of undefined (reading 'split')` → 十有八九是 `VITE_ROUTER_HISTORY` 丢了（K-025）
- 冷启动直达动态路由白屏 → 守卫必须先 `ensureAsyncRoutes()`（见 `docs/03-开发指南/前端两端差异.md`）

## 本地验证

- `bash server/scripts/docker-verify.sh`（含 SPA fallback 深链接）
- 全页面冷启动巡检 `_verify_test/verify-all-pages.py`（改路由 / 菜单后必跑）
