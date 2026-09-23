# 教务管理系统

面向培训机构的**员工端教务 / 招生 / 财务 / 教学一体化系统**。前端基于 [pure-admin-thin](https://github.com/pure-admin/pure-admin-thin)，后端 Express + SQLite，可 Docker 一键部署或本地开发运行。

> **定位：纯员工端系统。** 只有机构员工（管理员 / 教师）登录；**学员与家长不注册、不登录、无账号**，家长信息只是学员档案里的字段。

---

## 核心特性

| 模块 | 能力 |
| --- | --- |
| 学员与班级 | 学员档案（含家长姓名 / 电话）、Excel 批量导入导出、班级管理与班主任绑定 |
| 考勤教务 | 考勤批量登记、记录查询与导出、出勤统计与趋势、缺勤预警、月度报表、请假审批 |
| 排课 | 周课表、冲突检测、调课申请与审批（通过后课表自动同步）、补课登记（联动课时扣减）、学期管理 |
| 教学结果 | 考试与成绩录入、成绩单（排名 + 等级）、学习报告、成长档案时间线 |
| 财务 | 报班订单与课时包、缴费登记、退费审批、营收 / 欠费 / 课消统计、低课时预警 |
| 招生 | 线索登记、跟进时间线、状态流转、一键转化（自动建档 + 报班）、渠道转化统计 |
| 经营报表（仅管理员） | 招生转化、营收走势、续班率、在读率，支持打印 |
| 家校留痕 | 缺勤 / 成绩 / 请假自动生成通知记录，**仅在系统内留痕，不出网** |
| 系统管理 | 员工账号、系统参数、通知公告、数据库备份恢复、审计日志 |
| AI 教学工作台（可选） | 独立站点，九个教学场景；不配大模型也可用（本地规则引擎） |

**权限模型**：`admin` 可见全部；`teacher` 仅见本班数据，财务金额一律脱敏。四层同时生效——菜单不下发、接口 403、字段脱敏、导出不含费用。详见 [账号与权限](docs/02-快速开始/账号与权限.md)。

---

## 技术栈

| 端 | 技术 |
| --- | --- |
| 前端 | Vue 3.5、TypeScript、Vite 7、Element Plus 2、Pinia、TailwindCSS 4、ECharts 6 |
| 后端 | Node.js ≥ 22.13（内置 `node:sqlite`，零原生依赖）、Express 4、JWT 双 Token、bcryptjs |
| 部署 | Docker Compose（统一入口单端口）：nginx 托管双前端 + node 后端 + SQLite 数据卷 |

---

## 快速开始

### Docker 部署（推荐）

```bash
# 1. 生成密钥（后端必需，缺失时拒绝启动）
export JWT_SECRET=$(openssl rand -hex 32)

# 2. 指定对外端口（无域名建议 18080，避开需备案的 80/443）
echo "WEB_PORT=18080" >> .env

# 3. 构建并启动（统一入口：一个端口同时提供教务 / 工作台 /api）
docker compose up -d --build
```

| 服务 | 地址 |
| --- | --- |
| 教务系统（唯一入口） | http://localhost:18080 |
| AI 工作台（子路径 `/ai/`） | http://localhost:18080/ai/ |
| 后端 API（经 nginx 反代） | http://localhost:18080/api |

> ⚠️ 上线前必做两件事：注入 `JWT_SECRET`（否则任何拿到源码的人都能自签管理员 Token）、修改默认口令。

### 本地开发

```bash
# 后端（端口 3000）
cd server && npm install && npm run dev

# 前端（端口 8848，已代理 /api 到 3000）
pnpm install && pnpm dev
```

> 完整安装步骤、环境变量、中文目录导致的构建规避方案 → [安装与启动](docs/02-快速开始/安装与启动.md)；生产部署与升级回滚 → [校区部署与升级](docs/06-部署/校区部署与升级.md)。

### 默认账号

初始密码规则：**用户名 + 123456**

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin123456` | 管理员 |
| `teacher` | `teacher123456` | 教师 |

---

## 项目结构

```text
├── src/                 # 前端（pure-admin-thin）
│   ├── api/             # 接口封装（集中在此，views 内禁止直连 axios）
│   ├── views/           # 页面：welcome / attendance / recruit / teaching / finance / system
│   └── style/           # 设计 token 与 Element 覆盖（引入顺序有硬性要求）
├── ai-workbench/        # AI 教学工作台（独立子项目）
├── server/              # 后端（Express + SQLite）
│   ├── src/migrations/  # 数据库迁移 0NN-*.js（只增不改）
│   ├── src/routes/      # 业务路由
│   ├── scripts/         # 回归与验证脚本
│   └── database.md      # 数据库 schema 权威清单
├── docs/                # 全部文档（入口：docs/00-导航.md）
├── deploy/              # 部署资产：统一入口 Dockerfile / nginx / Linux 一键脚本
└── docker-compose.yml   # 唯一编排 —— 统一入口单端口（教务 / ＋ 工作台 /ai/ ＋ 后端 /api）
```

---

## 测试

```bash
BASE=http://127.0.0.1:3000 node server/scripts/e2e-lifecycle.mjs       # e2e 生命周期 80 项
BASE=http://127.0.0.1:3000 node server/scripts/analytics-smoke.mjs     # analytics 冒烟 22 项
BASE=http://127.0.0.1:3000 node _verify_test/probe-business-chain.mjs  # 业务链闭环 49 项
bash server/scripts/docker-verify.sh                                   # 部署验证 9 项
```

浏览器侧还有全页面冷启动巡检（28 项）与 P0 验证（31 项），改路由 / 菜单后必跑。完整清单见 [测试与验证](docs/03-开发指南/测试与验证.md)。

---

## 文档

| 我想… | 去哪 |
| --- | --- |
| 找任何文档 | [docs/00-导航.md](docs/00-导航.md)（文档总索引） |
| 装起来 / 跑起来 | [安装与启动](docs/02-快速开始/安装与启动.md) |
| 知道谁能看什么 | [账号与权限](docs/02-快速开始/账号与权限.md) |
| 改代码 | [开发指南](docs/03-开发指南/README.md) |
| 调接口 | [API 文档](docs/04-API/API.md) · [openapi.yaml](docs/04-API/openapi.yaml) |
| 配环境变量 / 大模型 | [配置说明](docs/05-配置/环境变量.md) |
| 上生产 / 升级 / 回滚 | [校区部署与升级](docs/06-部署/校区部署与升级.md) |
| 看路线图与决策 | [ROADMAP](docs/07-架构与决策/ROADMAP.md) · [ADR](docs/07-架构与决策/ADR/) |

文档写作与术语规范见 [docs/01-文档规范.md](docs/01-文档规范.md)。

---

## 贡献

提交前请读 [CONTRIBUTING.md](CONTRIBUTING.md)，要点：

- 提交信息遵循 commitlint：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`
- 提交前跑 `pnpm lint` 与相关回归脚本
- 改接口 / 表结构 / 部署方式，**必须同步对应文档**

## 许可证

[MIT](./LICENSE)
