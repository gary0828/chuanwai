# 贡献指南

本仓库是培训机构自用系统的源码库。**动手前先读本文**，可省掉绝大多数返工。

---

## 1. 开始之前

| 步骤 | 内容 |
| --- | --- |
| 1 | 读根目录 [README.md](README.md)，知道系统是什么、怎么跑起来 |
| 2 | 读 `WORKBUDDY.md`（AI 开发的硬约束）与 [docs/03-开发指南/README.md](docs/03-开发指南/README.md) |
| 3 | 按 [docs/03-开发指南/项目地图.md](docs/03-开发指南/项目地图.md) 定位要改的文件 |
| 4 | 起后端并跑一次 `BASE=http://127.0.0.1:3000 node server/scripts/e2e-lifecycle.mjs`，确认基线 80/80 全绿 |

环境：Node.js ≥ 22.13、pnpm、Docker（部署验证）、Python 3.14（浏览器验证脚本）。

---

## 2. 开发流程

1. **一次只做一件事**，小步提交。
2. 前端改动前确认符合 pure-admin 官方规范（见 `WORKBUDDY.md` §〇）。
3. 提交前跑 `pnpm lint`（ESLint + 自动修复）。
4. 提交信息遵循 commitlint：

   ```text
   feat(scope): 简短描述      fix / docs / style / refactor / test / chore
   ```

5. **禁止**绕过 lint 或测试提交。

### 分支与提交

- 直接在 `main` 上小步推进，或按功能开短分支后合回。
- 提交前自查：仓库是**公开**的，推送前必须扫一遍敏感数据（真实学员数据 / 密钥 / 内网地址）。
- 推送大包前先配：`git config http.postBuffer 524288000` + `git config http.version HTTP/1.1`。

---

## 3. 改了什么，就必须同步什么

| 你的改动 | 必须同步 |
| --- | --- |
| 新增 / 修改接口 | `docs/04-API/API.md` + `docs/04-API/openapi.yaml` |
| 改表结构 | 新增迁移脚本 `server/src/migrations/0NN-*.js` + 更新 `server/database.md` |
| 改环境变量 / 部署方式 | `docs/05-配置/`、`docs/06-部署/`、`server/.env.example` |
| 改权限或可见范围 | `docs/03-开发指南/权限模型.md` + `docs/02-快速开始/账号与权限.md` |
| 改路由 / 菜单 | 跑全页面冷启动巡检（见第 4 节） |
| 新增约定或踩坑 | `docs/03-开发指南/` 对应文件 |
| 发版 / 阶段完成 | `CHANGELOG.md` |
| 三个月后会被质疑的决定 | `docs/07-架构与决策/ADR/ADR-NNN-*.md`（只追加不修改） |

文档规范与术语表见 [docs/01-文档规范.md](docs/01-文档规范.md)。

---

## 4. 验证门禁

**不能只跑 API 测试就认为功能可用**，涉及界面的改动必须在浏览器里走一遍。

```bash
# 后端改动
BASE=http://127.0.0.1:3000 node server/scripts/e2e-lifecycle.mjs       # e2e 80 项
BASE=http://127.0.0.1:3000 node server/scripts/analytics-smoke.mjs     # analytics 22 项
BASE=http://127.0.0.1:3000 node _verify_test/probe-business-chain.mjs  # 业务链闭环 49 项

# 前端改动
pnpm lint && node ./node_modules/vite/bin/vite.js build
python _verify_test/verify-all-pages.py http://localhost:8080 http://127.0.0.1:3000   # 冷启动 28 项
python server/scripts/ui-p0-verify.py  http://localhost:8080 http://127.0.0.1:3000    # P0 31 项

# 部署改动
bash server/scripts/docker-verify.sh                                   # 9 项
```

- **改路由 / 菜单后必跑**全页面冷启动巡检（本项目曾长期存在「直达动态路由白屏」缺陷）。
- **向用户交付前**必须用 Docker 完整跑一遍。
- 浏览器验证用**生产构建产物**，不要用 vite dev server。

---

## 5. 禁区

- ❌ 修改历史迁移脚本（只新增，版本号连续递增，跳级会终止启动）。
- ❌ 改动框架核心：`src/router/index.ts`、`src/store/modules/user.ts`、`src/utils/http/`、`src/components/ReDialog/`。
- ❌ 在 `src/views/**` 里直接用 axios / `$route` / `$router` / `localStorage`；接口一律集中在 `src/api/`。
- ❌ 页面内硬编码色值，颜色 / 间距 / 圆角一律引用 `src/style/tokens.scss`。
- ❌ 破坏「纯员工端」定位：学员与家长无账号、不登录、不出网触达。
- ❌ 任何密钥出现在前端（localStorage、打包产物、URL 都不行）。
- ❌ 把 AI 产出留在 Dify：产出必须落回本系统（索引入库 + 文件落盘 `server/data/assets/`）。

---

## 6. 提问与决策

- 与 pure-admin 相关的写法不确定时：先查 https://pure-admin.cn/ ，再查官方仓库示例，**不要凭记忆发明**。
- 产品边界拿不准（该不该做、该放哪）：先读 `docs/03-开发指南/产品边界与AI.md`，Non-goals 里的项要启用必须先改 ROADMAP 决策并重新排期。
