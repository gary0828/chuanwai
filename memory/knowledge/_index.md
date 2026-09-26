# 知识索引（L1 · 一行一个**主题文件**）

> ★ **索引不是容器** —— 这里一行一个*主题文件*，**细节在文件里**。
> 想知道该读哪个 → `node memory/route.mjs <你改动的文件…>`（或 `--changed`）。
> 新增知识：**写进对应主题文件**，不要往本索引塞正文；确需新主题文件时才在下方加一行。
> 约定见 `process.md`（K-030）。本表只是"人看的目录"，机器路由以 `memory/route.mjs` 为唯一源。

| 主题文件 | 覆盖 | 条目 id | 触发（fileMatch） |
|---|---|---|---|
| `memory/knowledge/deploy.md` | 部署形态 / 端口 18080 / 数据保命 / 构建与脚本坑 / **容器未重建陷阱** / QA 断言前置过期 / **备份只有 VACUUM INTO** / **脚本自污染** | K-008 K-022 K-026 K-029 K-040 K-041 **K-046 K-047** | `docker-compose*.yml` · `deploy/**` · `Dockerfile*` · `server/scripts/*` · `.env*` |
| `memory/knowledge/frontend.md` | 两端差异 / 构建期 env / 样式坑 / 白屏排查口诀 / 登出语义 / **菜单渲染行为** | K-002 K-003 K-025 K-036 **K-048** | `src/**` · `ai-workbench/**` · `.env.*` · `vite.config.ts` |
| `memory/knowledge/backend-data.md` | node:sqlite / WAL / 迁移与评审 / 数据资产化 / AI 架构 / 上传与自助端点 / 枚举值改名 / **菜单双套结构** / **出勤率唯一口径** | K-005 K-006 K-015 K-017 K-033 K-034 K-043 **K-044 K-045** | `server/**` · `docs/04-API/**` |
| `memory/knowledge/process.md` | 测试与验证 / 记忆原则与边界 / 结构护栏 / 跑脚本的环境事实 / 内容清点方法 / 模板插值坑 | K-011 K-030 K-031 K-035 K-037 K-038 | **always** |
| `memory/knowledge/git-local.md` | 本机 git 红线（`git rm` / index.lock / ~~死代理~~**已删** / 推送凭据兜底） | K-013 K-024 K-028 K-039 K-042 | **always** |
| `memory/knowledge/preferences.md` | 用户偏好与拍板（门禁 / 版本策略 / 推进顺序 / 产品定案） | K-016 K-018 K-019 K-020 K-021 K-027 K-032 | **always** |

## 路由到文档（正文在文档里，此处只指路）

| 场景 | 权威文档 |
|---|---|
| 改页面 / 两端差异 | `docs/03-开发指南/前端两端差异.md` |
| 改后端 / 动 schema | `docs/03-开发指南/后端与数据.md` · `server/database.md` |
| 改接口契约 | `docs/04-API/API.md` · `docs/04-API/openapi.yaml` |
| 改权限 / 角色 | `docs/03-开发指南/权限模型.md` |
| 改 nginx / docker / 部署 | `docs/06-部署/运维约定.md` · `docs/06-部署/校区部署与升级.md` |
| 本地↔服务器同步（含数据） | `docs/06-部署/本地与服务器同步.md` |
| 写验证脚本 / 加断言 | `docs/03-开发指南/测试与验证.md` |
| 跑命令 / 环境诡异 | `docs/03-开发指南/环境坑与工具.md` |
| 判断该不该做 / 该放哪 | `docs/03-开发指南/产品边界与AI.md` |
| 设计新功能 / 为什么这么定 | `docs/07-架构与决策/ADR/` · `docs/07-架构与决策/ROADMAP.md` |
| 改文档 | `docs/01-文档规范.md` |
| 全量文档地图 | `docs/00-导航.md` |
