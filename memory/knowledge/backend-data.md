---
inclusion: fileMatch
fileMatchPattern: ["server/**", "docs/04-API/**"]
---

# 后端与数据（L2 · 主题）

> 深读：`docs/03-开发指南/后端与数据.md`、`server/database.md`（schema 权威）、
> `docs/04-API/API.md`（契约权威）。

## 技术底座

- Express 4 + **`node:sqlite`**（Node 内置，零原生编译）+ JWT 双 Token + bcryptjs
- 数据库版本 **v19**；迁移是**单向**的（新代码可能依赖新列 → 降级必须同时还原程序与数据）
- 迁移文件 `server/src/migrations/0NN-*.js`，**版本号连续递增，跳号会导致启动终止**
- ★ 新增迁移必须先做**数据模型评审**（`.trae/skills/data-model-review`），
  产出 `server/docs/<版本号>-<功能名>-model-review.md` 且含「结论：通过」——
  否则 **pre-commit 钩子会拦住提交**
  （★ 注意：钩子只查**本次新加**的迁移文件是否配套评审；`015`–`019` 在 `server/docs/` 下**没有**对应评审文档，
  属历史欠账，**别拿它们当"不用写"的先例**。）

## 踩过的坑

- **K-005 · `node:sqlite` 裸封装没有 `.transaction()`**：照 better-sqlite3 的习惯写会报
  `is not a function`。本项目用的是自己封的 helper，别混用两套 API。
- **K-006 · WAL 与「删数据不落盘」**：删完不做 `wal_checkpoint` → **重启后数据复活**。
  改数据的脚本收尾要 checkpoint。

## 数据资产化（K-015 · ADR-008，用户拍板 D15）

> **系统是唯一数据源，也是唯一仓库** —— AI 产出的 PDF / PPT / 试卷等**文件不入库**，
> 只在库里放**索引**，文件落盘到 `server/data/assets/<kind>/`。
> ⇒ 备份与同步**必须整个 `server/data/` 目录**，只备 db 会把文件全丢掉；
> ⇒ nginx 新增 `kind` 时要同步加一条 `/assets/<kind>/` 反代。

## AI 能力架构（K-017 · ADR-007）

> **独立 AI 工作台 + 只读网关 + 最小权限凭证**，模型密钥**服务端代持**（不下发前端）。
> 网关前缀 `/api/agent/*`；大模型 Key 只在「AI 配置中心」页面（`/#/ai-admin`）配置，存库 `settings` 表，
> **不经 `.env` / compose 注入**（工程末位兜底的 `config.js` 环境变量仅作默认）。
> 出网前做二次脱敏。

## 图片上传：唯一判型实现（K-033 · 2026-09-23）

> ★ **`server/src/utils/image.js` 是项目里唯一的上传判型/落盘实现**，提供
> `sniffImage(buf)`（文件头魔数，忽略客户端声明的扩展名/MIME）、
> `saveImage({dir, prefix, buf, cleanup})`、`removeImage(dir, filename)`、`MAX_UPLOAD_BYTES`（2MB）。

- 现状使用者：站点 Logo / favicon（`routes/site-info.js`）、员工头像（`routes/auth.js`）。
  **新增任何上传一律复用它**，不要再写第二份魔数逻辑。
- 为什么抽出来：与 **413 事故同源** —— "同一件事写在多处，改的时候只改一处"。
  判型规则（允许哪些格式、多大、怎么命名、清旧文件）必须**一处定义**。
- 落盘约定：`express.raw()` 直收二进制（**不引 multer**）、文件名 `{prefix}-{时间戳}-{rand8}{ext}`、
  **不保留原名**（防路径穿越 / 中文兼容），写入后清理**同 prefix** 的旧文件。

## 员工自助能力（K-034 · v20，2026-09-23）

> ★ **自助端点一律挂在 `/api/auth/*` 下、只取 `req.user.id`** —— 不放在 `/api/users/*`。
> 原因：`/api/users` 整条路由被 `requireRole("admin")` 守着（员工管理），
> 把"改自己"混进去要么放不开权限、要么得给每个 handler 单独开口子；
> 分开放后**"自助"与"管理员代管"两条线天然隔离**，teacher 也能用。

| 端点 | 口径 |
|---|---|
| `PUT /api/auth/password` | 校验 `old_password` + 新密码 ≥8 位 + 新旧不得相同 → 更新后 **`revokeTokens(自己)` 强制重登**（与 H2 一致）；`users.js` 的 admin 重置他人密码**并存不变** |
| `PUT /api/auth/profile` | 只允许 `name` / `phone`；**`username` 与 `role` 一律忽略**（前者登录标识、后者权限边界）→ 已验证传 `role:"admin"` 提权无效 |
| `POST /api/auth/avatar` | 落盘 `data/assets/avatars/`，`users.avatar` **只存相对路径**（ADR-008）；文件名前缀 `avatar-{用户id}` → 清旧文件时**只删本人的** |

- **两处硬编码容易漏**：`avatar` 在 `auth.js` 的 `buildLoginData`（登录返回）与 `GET /info`（刷新后拉取）**各写一次**，
  只改一处会表现为「登录后头像生效、刷新后失效」。改这类"身份字段"必须 `grep` 全量写入点。
- **上传逻辑统一走 `image.js`**（见上方 K-033），不要再写第二份魔数。
- **文件 + DB 不是跨事务**：采用「先落盘、后写库」，失败最多留 1 个孤儿文件（不指向、下次同前缀上传必被清），
  见 `server/docs/020-员工头像-model-review.md` 工件 3。

## 改持久化的自检

- [ ] 是否需要新迁移（版本连续、配套 model-review 文档）
- [ ] 是否触及权限边界（见 `docs/03-开发指南/权限模型.md`）
- [ ] 收入的唯一口径有没有被破坏（见 `docs/04-API/API.md`）
- [ ] 是否需要 `wal_checkpoint`
