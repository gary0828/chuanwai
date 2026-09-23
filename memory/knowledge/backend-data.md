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

## 改持久化的自检

- [ ] 是否需要新迁移（版本连续、配套 model-review 文档）
- [ ] 是否触及权限边界（见 `docs/03-开发指南/权限模型.md`）
- [ ] 收入的唯一口径有没有被破坏（见 `docs/04-API/API.md`）
- [ ] 是否需要 `wal_checkpoint`
