<h1 align="center">教务管理系统</h1>

基于 [pure-admin-thin](https://github.com/pure-admin/pure-admin-thin)（Vue3 + TypeScript + Element Plus + Vite）开发的**培训机构员工端教务 / 招生 / 财务 / 教学管理系统**，前端 + 后端（Express + SQLite）全栈 Docker 部署。涵盖考勤教务、课时管理、招生线索、财务管理（报班 / 缴费 / 退费 / 营收统计 / 课消统计）、教学结果（考试 / 成绩 / 学习报告 / 成长档案）、缺勤/成绩/请假通知留痕、经营报表（招生 / 营收 / 续班 / 在读）等机构核心业务。

> **定位：纯员工端 CRM**——本系统供机构内部员工（校长 / 教务 / 教师）使用。学生、家长**不注册、不登录、无账号**，只是系统内的业务数据（学生档案含家长姓名 / 电话）；账号体系仅保留员工（admin / teacher）。

## 功能特性

- **角色权限系统**：`admin`（管理员）/ `teacher`（教师）两种员工角色；所有账号由管理员创建（不支持注册）；管理员可创建 / 管理教师、管理员账号，重置密码、删除（不能删自己、系统至少保留一个管理员）；学生 / 家长无账号不登录
- **学生档案**：学生增删改查（管理员 + 教师，教师只能分配到本班），支持按班级 / 姓名 / 学号筛选分页；**Excel 批量导入导出**；档案含**家长姓名 / 家长电话**（家校通知对象，无独立账号）
- **缺勤通知**：考勤批量登记中标记为「缺勤」时，自动为学生档案中的家长生成通知（含学员 / 日期 / 课程，家长姓名快照留痕），状态改回非缺勤自动撤销当日通知（幂等防重）；「通知记录」页支持按学员 / 类型 / 日期 / 已读状态筛选、单条或全部标记已读，教师仅可见本班学员的通知
- **经营报表**（仅管理员）：招生统计（线索总量 / 转化率 / 各来源渠道转化）、营收统计（近 12 月按月 / 按课程实收）、续班率（近 6 月结业学员中续报比例）、在读率（在读学员 / 总学员占比）；总览卡片 + 明细表格，支持打印
- **登录与权限**：JWT 双 Token（accessToken + refreshToken）认证；后端按角色动态下发菜单路由（`/api/auth/async-routes`），页面级 + 接口级双重权限控制
- **班级管理**：班级增删改查（管理员 + 教师，教师创建的班级自动绑定自己为班主任）；管理员可指定班主任账号（数据权限绑定）；「名单」可查看班级详情与今日出勤概况（在读人数 / 实到 / 缺勤 / 请假）
- **课程管理**：课程增删改查（仅管理员），有考勤记录时禁止删除
- **课程表**：按班级设置「星期 × 节次」的课程安排（周课表视图，点击空格子添加 / 点击已排课程修改删除）；考勤登记时自动带出当天课表课程，一键选择登记；**冲突检测**（同班同时段 / 同教师跨班同时段，新增保存时自动检测并给出警告或拒绝）
- **调课审批**：调课申请（原时段 → 目标时段 + 原因，admin / teacher 可提交；同班目标时段被占用或同一课表重复提交自动拒绝）→ 管理员审批（通过 / 驳回 / 撤销）；**审批通过后课表自动同步变更**，撤销时回滚
- **补课管理**：补课登记（学员 / 班级 / 课程 / 原始日期 / 补课日期 / 备注）→ 标记完成时**自动扣减学员课时包 1 课时**（联动课时消耗流水），撤销完成自动回补；支持日期范围筛选
- **学期管理**：学期增删改查 + 当前学期标记（仅管理员），统计报表可按学期筛选（自动带入起止日期）
- **考勤登记**：选择日期 + 班级 + 课程 → 加载全班名单 → 逐人标记（正常 / 迟到 / 早退 / 缺勤 / 请假）+ 备注 → 批量提交（事务 + 冲突覆盖）
- **考勤记录**：按日期 / 课程 / 班级 / 状态筛选分页查询历史记录，支持修改与 **Excel 导出**（前 500 条）
- **考勤统计**：按学生 / 按班级两种维度，支持课程 / 班级 / 日期范围筛选，出勤率柱状图 + 汇总卡片；**出勤趋势**支持按日 / 按周 / 按月切换；**缺勤预警**按统计天数 / 出勤率阈值 / 连续缺勤天数展示低出勤率与连续缺勤学生名单
- **月度报表**：统计页新增「月度报表」页签，按「班级 × 月份」聚合出勤率矩阵，支持一键**打印 / 导出**（打印时仅输出报表区域）
- **请假管理**：请假申请提交（病假 / 事假 / 其他，支持多天）、待审批列表、通过 / 驳回审批（教师及以上）、自动展示请假时长
- **系统参数**：缺勤预警阈值（出勤率 / 连续缺勤天数 / 统计窗口）由管理员统一配置，统计页预警自动读取
- **通知公告**：管理员发布 / 下架 / 置顶公告，首页看板展示最新公告，点击查看详情
- **数据备份**：系统每 6 小时自动备份数据库（保留最近 20 份），支持手动备份 / 恢复 / 删除（仅管理员；恢复后服务自动重启加载备份数据）
- **审计日志**：自动记录登录用户的关键写操作（操作人 / 动作 / 接口 / IP / 时间），管理员可查看与筛选
- **首页看板**：今日应到 / 实到 / 缺勤 / 请假统计卡片、近 7 日出勤趋势折线图、考勤状态占比饼图、最新公告列表
- **数据级权限**：教师通过「班主任绑定」仅能查看与管理本班数据（班级 / 学生 / 考勤 / 请假 / 统计 / 看板全部过滤），管理员不受限
- **报班管理**：学员报班生成订单（关联班级 / 课程 / 报名日期 / 订单金额 / 报名老师），支持**课时包**（总课时 / 剩余课时，考勤登记联动扣减：正常 / 迟到 / 早退扣 1 课时，缺勤 / 请假不扣；修改考勤按新旧状态差异自动回补 / 扣减）；支持结业 / 退班状态流转，订单详情含缴费明细与退费记录；**低课时预警**（剩余课时 ≤ 阈值红色高亮 + 统计页预警列表）；存量学员迁移时自动补默认订单
- **缴费记录**：按订单登记实收（现金 / 转账 / 扫码），记录收款人与收费时间，支持按学员 / 支付方式 / 时间范围筛选并统计实收合计
- **退费管理**：退费申请（关联订单 / 原因）→ 管理员审批（通过 / 驳回），全程留痕
- **招生线索管理**：线索登记（姓名 / 电话 / 意向课程 / 来源渠道：转介绍 / 线上 / 地推 / 广告 / 其他），跟进记录时间线（逐条留痕），状态流转（新线索 / 跟进中 / 已转化 / 已流失）；**一键转化**自动创建学员档案（含家长姓名 / 电话随档案）+ 报班订单（事务）；**渠道统计**（各渠道线索数 / 转化数 / 转化率）；教师仅可见与跟进自己创建的线索，线索删除仅管理员
- **学员档案扩展**：学生档案补充家长姓名 / 家长电话 / 来源渠道 / 报名日期，线索转化时自动回填
- **财务统计**：营收统计（按天 / 按月聚合实收，可打印导出）+ 欠费统计（订单应缴 - 实缴差额清单与合计）
- **课消统计**（按老师 / 按课程 / 按学员三种维度）：课时包消耗 / 回补 / 净消耗聚合，收入确认金额（按课时消耗比例分摊订单实收，`amount × consumed ÷ total_hours`），支持日期范围筛选与打印；教师仅可见本班课消且**金额对教师不可见**，管理员可见金额
- **教学结果·成绩管理**：考试 CRUD（关联课程 / 班级 / 类型：单元测·期中·期末 / 满分），成绩录入（事务批量 upsert，一考一成绩冲突覆盖），**成绩单**（排名 + 等级：≥90% 优 / ≥80% 良 / ≥70% 中 / ≥60% 及格 + 平均分，支持打印）；成绩录入后自动向学生档案的家长推送「成绩发布」通知（家长姓名快照，仅新插入成绩时生成，修改成绩不重复，幂等防重）；教师仅可操作本班考试
- **教学结果·学习报告**：按姓名 / 学号搜索学员，汇总学员信息、近 30 天考勤概况（出勤率）、最近考试与成绩等级、课时包进度（总课时 / 剩余 / 消耗进度）、在读订单摘要（报名金额 / 已缴金额），支持打印导出
- **教学结果·成长档案**：按学员展示入学 / 报班 / 缴费 / 退费 / 考勤异常 / 成绩发布 / 结业的全生命周期时间线（el-timeline + 事件类型标签配色），支持打印
- **经营报表**（仅管理员）：近 12 月营收走势（按课程维度下钻）+ 渠道转化率 + 续班率 + 在读率，支持打印
- **菜单结构**：按「员工账号 / 考勤管理（登记·记录·请假·报表）/ 招生管理（线索）/ 教学结果（成绩管理·学习报告·成长档案）/ 财务管理（报班·缴费·退费·统计·经营报表·课消统计）/ 家校管理（通知记录）/ 数据管理（班级·学生·课程·课程表·学期·调课审批·补课管理）/ 系统管理（配置与运维）」清晰分组，功能直观不冗余
- **AI 分析接口（预留）**：`/api/analytics/*` 为后续 AI 经营分析与批量数据导出提供统一出口——指标定义字典（12 项，含计算公式与来源表）、全局经营概览（21 项指标 + 近 12 月营收趋势 + 渠道转化）、考勤 / 财务 / 线索 / 成绩四类数据一键导出（JSON 或带 BOM 的 CSV）；统一响应信封含 `meta.data_version`，**仅管理员可访问**
- **菜单结构**：按「员工账号 / 考勤管理（登记·记录·请假·报表）/ 招生管理（线索）/ 教学结果（成绩管理·学习报告·成长档案）/ 财务管理（报班·缴费·退费·统计·经营报表·课消统计）/ 家校管理（通知记录）/ 数据管理（班级·学生·课程·课程表·学期·调课审批·补课管理）/ 系统管理（配置与运维）」清晰分组

## 技术栈

| 端   | 技术                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 前端 | Vue 3.5、TypeScript、Vite 7、Element Plus 2、Pinia、TailwindCSS 4、ECharts 6（复用 `@pureadmin/utils` 的 `useECharts`） |
| 后端 | Node.js（内置 `node:sqlite`，零原生依赖）、Express 4、JWT（jsonwebtoken）、密码哈希（bcryptjs）                         |
| 部署 | Docker Compose：前端 nginx + 后端 node:24-alpine + SQLite 数据卷                                                        |

## 界面设计规范

全站视觉统一采用「教务台」方向：结构清晰、边界精确、数字成列对齐、没有一处多余装饰。主色为深靛蓝 `#1F5C99`（替代 Element 出厂的 `#409EFF`），语义色去糖果化，卡片用细边框而非阴影。

> 新页面或改样式前请先读 `docs/前端视觉规范-2026-09-18.md`（设计 token 规格、页面骨架用法、响应式策略、遗留清单）；设计意图见根目录 `.impeccable.md`。

四条硬性约束：

1. 颜色 / 间距 / 圆角 / 阴影 / 动效时长一律引用 `src/style/tokens.scss` 的变量，页面内禁止硬编码色值。
2. `src/style/element-plus-override.scss` 必须在 `element-plus/dist/index.css` **之后**引入（见 `src/main.ts`）—— 它靠"后加载"取胜，挪到前面会被官方规则覆盖。
3. 页面骨架统一：`.app-page` 根容器 + `AppPageHeader` 页头 + `.page-card(--flush)` 内容卡 + `.page-toolbar` 筛选条；空状态用 `AppEmpty`。
4. 登录页与内页共用同一套物料（底色 `--surface-page`、卡片规格对齐 `.page-card`），其背景「教务格栅」是全站表格线条语言的抽象。

浏览器验证请使用生产构建产物，不要用 vite dev server：

```bash
node ./node_modules/vite/bin/vite.js build          # 先构建
node _verify_test/serve-dist.mjs                    # 托管 dist/（:8848，含 /api 反代）

python _verify_test/ui-global-sweep.py http://127.0.0.1:8848 http://127.0.0.1:3000   # 全站扫描
python _verify_test/ui-login-shots.py  http://127.0.0.1:8848                          # 登录页专项
```

## 快速开始

### 方式一：Docker 部署（推荐）

> ⚠️ **上线前必读**：后端**必须**注入 `JWT_SECRET`，否则会回退到源码中的公开默认密钥，任何人可自签管理员 token 读取全部学员/家长电话/缴费数据。详见 `docs/上线评估报告-2026-09-12.md` 问题 **B1**。

```bash
# 0) 生成生产密钥（后端必需环境变量，模板见 server/.env.example）
export JWT_SECRET=$(openssl rand -hex 32)   # Windows PowerShell: [Convert]::ToHexString((1..32|%{Get-Random -Max 256})) -replace '-',''

# 构建并启动（国内网络已在 Dockerfile/.npmrc 配置 npmmirror 源）
docker compose up -d --build
```

并将 `JWT_SECRET` 注入 `docker-compose.yml` 的 `server.environment`（或同级 `.env` 文件），例如：

```yaml
  server:
    environment:
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET:?JWT_SECRET 未设置，拒绝启动}
```

> **后端环境变量清单**（完整模板见 `server/.env.example`）：
>
> | 变量 | 必填 | 说明 |
> | --- | --- | --- |
> | `JWT_SECRET` | **是** | 双 Token 签名密钥。生产**必须**注入且不可写入仓库；建议 `openssl rand -hex 32` 生成，并纳入密钥轮换计划 |
> | `PORT` | 否 | 后端监听端口，默认 `3000` |
>
> 前端环境变量见根目录 `.env.example`（所有自定义变量须以 `VITE_` 开头）。

启动后访问：

| 服务     | 地址                      |
| -------- | ------------------------- |
| 前端     | http://localhost:8080     |
| 后端 API | http://localhost:3000/api |

> 说明：
>
> - SQLite 数据持久化在 `server/data/attendance.db`（已挂载数据卷，首次启动自动建表并写入种子数据）
> - 后端健康检查：`GET /api/health`，`web` 服务会等 `server` 健康后再启动
> - 国内网络拉取 Docker Hub 基础镜像较慢时，可在 Docker Desktop → Settings → Docker Engine 中配置镜像加速（registry-mirrors），例如 `https://docker.m.daocloud.io`
> - `docker-compose.yml` 顶部显式声明了 `name: attendance-system`：Compose 默认用**目录名**推导项目名且只接受小写字母/数字/`-`/`_`，若项目放在**纯中文目录**（如 `教学管理系统`）下，推导结果为空字符串，会直接报 `project name must not be empty`。
> - **首次登录后必须修改默认口令**（`admin/admin123456`、`teacher/teacher123456`）。默认口令为公开信息，且当前后端登录接口无失败限速，未经修改的账号可被直接爆破（见上线评估报告 H7/H9）。

#### 部署后验证

```bash
bash server/scripts/docker-verify.sh     # 容器状态 / 健康检查 / 前端托管 / nginx 反代 / 数据持久化 / analytics（9 项）
node server/scripts/e2e-lifecycle.mjs    # 端到端回归（80 项断言）
```

#### 排障：`docker compose up` 报 `failed to dial gRPC ... non-printable ASCII characters`

这是 **Docker Desktop / Buildx 的已知缺陷**：`docker compose` 走 Bake 构建时会把**当前工作目录**编码进 gRPC 会话头（`x-docker-expose-session-sharedkey`），而 gRPC 要求头字段必须是可打印 ASCII。本项目的目录名是中文，于是头部出现非 ASCII 字符，构建在开始阶段即失败（`COMPOSE_BAKE=false` 亦无法规避）。

**两种解法（任选其一）：**

```bash
# 方案 A（推荐）：把项目放到纯 ASCII 路径，再正常使用 compose
#   例如 D:\attendance-system\ ，然后：
docker compose up -d --build

# 方案 B：留在当前中文目录，绕开 compose 的构建路径 —— 用 docker build 打镜像，再启动
docker build -t attendance-system-server -f server/Dockerfile .
docker build -t attendance-system-web    -f Dockerfile .
docker compose up -d --no-build
```

> 方案 B 之所以可行：compose 未指定 `image:` 时，镜像名默认就是 `<项目名>-<服务名>`，即 `attendance-system-server` / `attendance-system-web`，与上面手工打的标签一致；`--no-build` 会直接复用本地镜像。

### 方式二：本地开发

```bash
# 1. 后端（Node >= 22.13，端口 3000）
cd server
npm install
npm run dev

# 2. 前端（端口 8848，vite 代理 /api 到 localhost:3000）
pnpm install
pnpm dev
```

## 默认账号

初始密码规则：**用户名 + 123456**

| 账号    | 密码          | 角色   | 权限                                                            |
| ------- | ------------- | ------ | --------------------------------------------------------------- |
| admin   | admin123456   | 管理员 | 全部功能（含员工账号 / 班级 / 课程管理 / 经营报表）             |
| teacher | teacher123456 | 教师   | 班级 / 学生管理、考勤登记、考勤统计、请假管理、通知记录（本班） |

> 本系统为纯员工端 CRM：只有员工账号（admin / teacher）可登录；学生 / 家长无账号，家长信息作为学生档案字段维护。

## 角色权限

| 功能                                                       | admin       | teacher                   |
| ---------------------------------------------------------- | ----------- | ------------------------- |
| 员工账号（创建账号、分配角色、重置密码、删除）             | ✅          | ❌                        |
| 班级管理（增删改、指定班主任绑定）                         | ✅          | ✅ 仅本班（自动绑定自己） |
| 学生管理（增删改、批量导入导出、家长信息）                 | ✅          | ✅ 仅本班                 |
| 课程管理（增删改）                                         | ✅          | ❌                        |
| 招生线索（登记 / 跟进 / 状态流转 / 转化）                  | ✅ 全部     | ✅ 仅自己创建的线索       |
| 教学结果（考试 / 成绩录入 / 成绩单 / 学习报告 / 成长档案） | ✅ 全部     | ✅ 仅本班考试与学员       |
| 课消统计                                                   | ✅ 可见金额 | ✅ 仅本班、金额不可见     |
| 通知记录（查看 / 标记已读）                                | ✅ 全部     | ✅ 仅本班学员通知         |
| 经营报表（招生 / 营收 / 续班 / 在读）                      | ✅          | ❌                        |
| 考勤登记 / 考勤记录 / 统计 / 趋势 / 预警 / 请假审批 / 看板 | ✅ 全部     | ✅ 仅本班数据             |
| 登录                                                       | ✅          | ✅                        |

## AI 教学工作台与大模型配置

工作台是**独立部署**的教学辅助站点（Docker 默认 `http://localhost:8082`），从教务系统顶栏「AI 助手」按钮**免登进入**。

### 不配也能用

**`LLM_API_KEY` 留空时工作台完全可用**：九个场景（课程设计 / 备课方案 / 授课流程 / 作业设计 / 批改反馈 / 学情诊断 / 家长反馈 / 学情报告 …）全部由本地规则引擎生成，页面会标注「规则引擎生成」。所有数字都由本地指标引擎算出，不依赖模型。

### 配置大模型（可选）

在**项目根目录 `.env`**（compose 会自动读取，文件已被 gitignore）里加一行：

```bash
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx          # DeepSeek 官方 Key，可换任意 OpenAI 兼容端点
```

然后重建后端容器让环境变量生效：

```bash
docker build -t attendance-system-server -f server/Dockerfile .
docker compose up -d --no-build --force-recreate server
```

生效后：工作台 → **底座设置** → 选「服务端模型」→ 保存，右下角会显示当前模型名（如 `deepseek-flash`）。

### 可调项（全部可选，默认值已是最优）

| 变量 | 默认 | 什么时候要动 |
| --- | --- | --- |
| `LLM_MODEL` | `deepseek-flash` | 换更强的 `deepseek-v4-pro`（慢约 3.6 倍、更贵）；**旧别名 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用** |
| `LLM_BASE_URL` | `https://api.deepseek.com` | 换国产模型 / 本地 vLLM、Ollama |
| `LLM_REASONING_EFFORT` | `none` | **保持 `none`**。DeepSeek 现行模型都是推理型，思维链会先吃满输出额度导致正文为空；想让模型做多步推理才改 `medium`/`high`，同时必须调大额度 |
| `LLM_MAX_TOKENS` | `8192` | 开启推理后需上调。关闭推理时一份备课方案约 1900 输出 token，8192 余量充足 |
| `LLM_TIMEOUT_MS` | `60000` | 网络较慢时上调 |
| `AI_WORKBENCH_URL` | `http://localhost` | **同源部署（推荐）保持默认回环地址即可** —— 后端会自动把它替换为「访问者当前访问的地址」，因此 IP / 域名 / 80 端口 / HTTPS 全部自适应，无需改动。仅当工作台部署在**另一台机器或独立端口**时，才显式配成浏览器可达地址（如 `http://10.0.0.5:8082`） |
| `AI_WORKBENCH_BASE_PATH` | 空 | 同源部署且工作台挂在子路径时必须配（本项目统一入口为 `/ai`）。留空表示工作台在域名根路径 |

### 安全边界

- **Key 只存在于后端容器**，永远不下发浏览器；工作台通过 `/api/ai/generate` 走后端代理
- 出网前经服务端二次脱敏（姓名 / 电话 / 金额 / 含金额特征的文本一律剔除），学生以内部编号送出
- 模型调用失败会自动回退规则引擎并标注原因，**不阻塞教学流程**
- 实测单次生成约 **7 秒 / ¥0.011**；每天 30 份报告约 ¥10/月

### 更省事的方式：AI 配置中心

管理员登录后访问 **<http://localhost:8080/#/ai-admin>** —— 这个页面**不在任何菜单里**，只能输地址进。

在页面上可以直接改：大模型 Key / 模型名 / 输出额度 / 思维链强度 / 超时 / 工作台地址 / Dify 地址与工作流 Key，还能看到**账户余额**和**本月用量**。

**改完点保存立即生效，不用重建容器、不用重启。** 教师账号访问会被拒绝（403），页面上也只显示 Key 的掩码（如 `sk-****3f2a`），明文永不下发浏览器。

> 详细配置项见 `server/.env.example`，接口说明见 `docs/api.md` §5。

> **运维文档**：换机器部署 / 版本升级 / 备份回滚 → `docs/校区部署与升级指南.md`
> ｜ Dify 什么时候该用、怎么搭第一个 Agent → `docs/Dify上手指南.md`

## 目录结构

```text
├── WORKBUDDY.md                # 项目规则（Agent 开发约束，含 pure-admin 官方规范）
├── docs/PROGRESS.md           # 项目进度（已归入 docs）（已完成 / 进行中 / 待办 / 已知问题 / 浏览器验证记录）
├── docs/
│   ├── api.md                  # API 权威文档（人类可读，唯一权威）
│   └── openapi.yaml            # API 机器可读规范（OpenAPI 3.0）
├── src/                        # 前端（pure-admin-thin）
│   ├── api/                    # 接口封装（user / routes / attendance / teaching）
│   ├── views/
│   │   ├── welcome/            # 首页看板
│   │   ├── attendance/         # 员工账号 / 班级 / 学生 / 课程 / 考勤登记 / 统计 / 请假 / 课程表 / 调课审批 / 补课管理
│   │   ├── recruit/            # 招生管理（线索列表 / 跟进 / 转化 / 渠道统计）
│   │   ├── teaching/           # 教学结果（成绩管理 / 学习报告 / 成长档案）
│   │   ├── finance/            # 财务管理（报班 / 缴费 / 退费 / 财务统计 / 经营报表 / 课消统计）
│   │   ├── family/             # 家校管理（通知记录）
│   │   └── system/             # 系统管理（系统参数 / 通知公告 / 数据备份 / 审计日志）
│   └── utils/http/             # axios 封装（Token 自动刷新、过期处理）
├── server/                     # 后端（Express + SQLite）
│   ├── src/
│   │   ├── db.js               # 连接 + 版本化迁移入口
│   │   ├── migrations/         # 数据库迁移（权威建表脚本，v1~v14）
│   │   ├── seed.js             # 种子数据（首次启动自动执行）
│   │   ├── middleware/auth.js  # JWT 校验 + 角色控制
│   │   ├── utils/scope.js      # 数据级权限（教师仅管本班过滤）
│   │   ├── utils/audit.js      # 审计日志写入
│   │   ├── utils/backup.js     # 数据库备份/恢复/定时自动备份
│   │   └── routes/             # auth / users / classes / students / courses / attendance / leaves / dashboard / schedules / terms / settings / notices / backups / audit-logs / finance / leads / notifications / exams / reports / adjustments / makeups / analytics
│   ├── scripts/                # e2e-lifecycle.mjs（80 项断言）/ analytics-smoke.mjs / ui-p0-verify.py（P0 浏览器验证）
│   ├── database.md             # 数据库清单（schema 权威文档 + 版本历史）
│   ├── data/                   # SQLite 数据文件（Docker 卷挂载）
│   └── Dockerfile
├── Dockerfile                  # 前端多阶段构建（pnpm + nginx）
├── nginx.conf                  # nginx：SPA 托管 + /api 反代 server:3000
└── docker-compose.yml
```

## 数据库版本机制

数据库采用「版本化迁移 + 清单文档」机制，确保 schema 始终准确、可升级、可追溯：

- 所有建表语句统一维护在 `server/src/migrations/`（v1 初始建表、v2 users 角色扩展 student、v3 classes 班主任绑定、v4 schedules 课程表、v5 terms 学期、v6 settings 系统参数 + notices 通知公告、v7 audit_logs 操作审计、v8 orders 报班订单 + payments 收费 + refunds 退费、v9 orders 课时包字段 + leads 招生线索 + students 家长/来源字段、v10 users 角色扩展 parent + parent_children 家长学员绑定 + notifications 缺勤通知、v11 exams 考试 + exam_scores 成绩 + hour_consumptions 课时消耗流水 + notifications.type 扩展「成绩发布」、v12 schedule_adjustments 调课申请 + makeup_classes 补课记录、v13 students.user_id 账号档案关联 + leaves.source + 考勤请假联动 + notifications.type 扩展「请假审批通过」、v14 员工端 CRM 定调：users.role 收紧 admin/teacher + students 删 user_id + 删 parent_children + notifications 改 parent_name 快照），启动时按 `PRAGMA user_version` 自动执行增量迁移，每个迁移在事务内执行、失败自动回滚并终止启动
- 旧库升级只执行增量迁移，已有数据原样保留；新库从 v0 依次执行全部迁移
- `server/database.md` 为数据库清单（schema 权威文档 + 版本历史 + 维护规则），每次变更必须新增迁移脚本并同步更新清单
- 当前版本：v14（员工端 CRM 定调：学生/家长无账号）

## API 一览

| 模块     | 方法            | 路径                                  | 说明                                                                                                                                                  |
| -------- | --------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证     | POST            | /api/auth/login                       | 统一登录入口，body 含 `type`（本期实现 `password`）                                                                                                   |
| 认证     | GET             | /api/auth/info                        | 当前用户信息                                                                                                                                          |
| 认证     | GET             | /api/auth/async-routes                | 动态菜单路由（按角色）                                                                                                                                |
| 认证     | POST            | /api/auth/refresh-token               | 刷新 Token                                                                                                                                            |
| 认证     | POST            | /api/auth/logout                      | 退出登录                                                                                                                                              |
| 认证     | POST            | /api/auth/sms-code                    | 短信验证码（占位 501，待接入）                                                                                                                        |
| 认证     | POST            | /api/auth/wechat                      | 微信登录（占位 501，待接入）                                                                                                                          |
| 用户     | GET/POST        | /api/users                            | 用户列表（分页/角色筛选）/ 创建用户（admin）                                                                                                          |
| 用户     | PUT             | /api/users/:id                        | 修改用户（姓名/角色/手机号，admin）                                                                                                                   |
| 用户     | PUT             | /api/users/:id/password               | 重置密码（admin）                                                                                                                                     |
| 用户     | DELETE          | /api/users/:id                        | 删除用户（admin，不能删自己）                                                                                                                         |
| 班级     | GET/POST        | /api/classes                          | 班级列表（分页搜索）/ 新增（admin / teacher，教师自动绑定自己为班主任）                                                                               |
| 班级     | GET             | /api/classes/all                      | 全部班级（下拉用）                                                                                                                                    |
| 班级     | GET             | /api/classes/:id/students             | 班级名单 + 今日出勤概况（在读人数 / 实到 / 缺勤 / 请假）                                                                                              |
| 班级     | PUT/DELETE      | /api/classes/:id                      | 修改 / 删除（admin / teacher，仅限本班）                                                                                                              |
| 学生     | GET/POST        | /api/students                         | 学生列表（筛选分页：班级/姓名/学号精确 + keyword 姓名或学号模糊）/ 新增（admin / teacher）                                                            |
| 学生     | GET             | /api/students/export                  | 学生全量导出（与列表同筛选，不分页）                                                                                                                  |
| 学生     | POST            | /api/students/import                  | 批量导入（前端解析 Excel 后提交，逐条校验返回失败明细）                                                                                               |
| 学生     | PUT/DELETE      | /api/students/:id                     | 修改 / 删除（admin / teacher，仅限本班）                                                                                                              |
| 课程     | GET/POST        | /api/courses                          | 课程列表 / 新增（admin）                                                                                                                              |
| 课程     | GET             | /api/courses/all                      | 全部课程（下拉用）                                                                                                                                    |
| 课程     | PUT/DELETE      | /api/courses/:id                      | 修改 / 删除（admin）                                                                                                                                  |
| 考勤     | GET             | /api/attendance                       | 某课程某日全班名单（回显已登记状态）                                                                                                                  |
| 考勤     | POST            | /api/attendance/batch                 | 批量登记（事务 + 覆盖）                                                                                                                               |
| 考勤     | GET             | /api/attendance/records               | 考勤记录分页查询（日期/课程/班级/学生/状态筛选）                                                                                                      |
| 考勤     | GET             | /api/attendance/statistics            | 统计（student / class 维度）                                                                                                                          |
| 考勤     | GET             | /api/attendance/statistics/trend      | 出勤趋势（period=day\|week\|month）                                                                                                                   |
| 考勤     | GET             | /api/attendance/statistics/monthly    | 月度报表（班级 × 月份 出勤矩阵）                                                                                                                      |
| 考勤     | GET             | /api/attendance/warnings              | 缺勤预警（低出勤率 + 连续缺勤，rate/consecutive/days 阈值）                                                                                           |
| 请假     | GET/POST        | /api/leaves                           | 请假列表 / 提交申请                                                                                                                                   |
| 请假     | PUT             | /api/leaves/:id/approve               | 通过 / 驳回（teacher 及以上）                                                                                                                         |
| 课表     | GET/POST        | /api/schedules                        | 课表查询（class_id / day_of_week 过滤）/ 新增（含冲突检测：同班同时段拒绝，同教师跨班同时段返回警告）                                                 |
| 课表     | GET             | /api/schedules/all                    | 课表全量（课程表页渲染）                                                                                                                              |
| 课表     | PUT/DELETE      | /api/schedules/:id                    | 修改 / 删除课表条目                                                                                                                                   |
| 调课     | GET/POST        | /api/schedule-adjustments             | 调课申请列表（状态/班级筛选，teacher 仅本班）/ 提交申请（admin / teacher）                                                                            |
| 调课     | PUT             | /api/schedule-adjustments/:id/approve | 审批通过 / 驳回（admin）；通过后课表自动同步                                                                                                          |
| 调课     | DELETE          | /api/schedule-adjustments/:id         | 撤销申请（仅待审批可撤销，撤销后回滚课表）                                                                                                            |
| 补课     | GET/POST        | /api/makeup-classes                   | 补课记录列表（日期范围筛选，teacher 仅本班）/ 登记补课（admin / teacher）                                                                             |
| 补课     | PUT             | /api/makeup-classes/:id/status        | 标记完成（扣减课时包 1 课时 + 课时消耗流水）/ 恢复待安排（回补课时）                                                                                  |
| 补课     | DELETE          | /api/makeup-classes/:id               | 删除补课记录（admin / teacher）                                                                                                                       |
| 学期     | GET/POST        | /api/terms                            | 学期列表 / 新增（admin）                                                                                                                              |
| 学期     | GET             | /api/terms/all                        | 学期下拉（全部）                                                                                                                                      |
| 学期     | GET             | /api/terms/current                    | 当前学期                                                                                                                                              |
| 学期     | PUT             | /api/terms/:id                        | 修改学期（admin）                                                                                                                                     |
| 学期     | PUT             | /api/terms/:id/current                | 设为当前学期（admin）                                                                                                                                 |
| 学期     | DELETE          | /api/terms/:id                        | 删除学期（admin，当前学期不可删）                                                                                                                     |
| 看板     | GET             | /api/dashboard/overview               | 首页统计                                                                                                                                              |
| 系统参数 | GET             | /api/settings                         | 读取全部系统参数（登录即可）                                                                                                                          |
| 系统参数 | PUT             | /api/settings                         | 更新系统参数（admin，整体覆盖）                                                                                                                       |
| 公告     | GET             | /api/notices                          | 公告列表（分页 + 关键字）                                                                                                                             |
| 公告     | GET             | /api/notices/latest                   | 最新公告（看板用，已发布置顶优先，最多 3 条）                                                                                                         |
| 公告     | POST/PUT/DELETE | /api/notices[/:id]                    | 新增 / 修改 / 删除公告（admin）                                                                                                                       |
| 备份     | GET/POST        | /api/backups                          | 备份列表 / 立即备份（admin）                                                                                                                          |
| 备份     | POST            | /api/backups/:filename/restore        | 恢复备份（admin，服务自动重启）                                                                                                                       |
| 备份     | DELETE          | /api/backups/:filename                | 删除备份（admin）                                                                                                                                     |
| 审计     | GET             | /api/audit-logs                       | 审计日志（admin，分页 + 操作人/动作/时间筛选）                                                                                                        |
| 财务     | GET/POST        | /api/finance/orders                   | 报班订单列表（分页 + 状态/关键字/班级/低课时筛选 + 课时字段）/ 新增报班（含 total_hours 课时包）                                                      |
| 财务     | GET             | /api/finance/orders/:id               | 订单详情（含缴费明细与退费记录）                                                                                                                      |
| 财务     | PUT             | /api/finance/orders/:id               | 修改订单（班级/课程/金额/备注/课时，COALESCE 保留未传字段）                                                                                           |
| 财务     | PUT             | /api/finance/orders/:id/status        | 变更订单状态（结业/退班）                                                                                                                             |
| 财务     | DELETE          | /api/finance/orders/:id               | 删除订单（admin，级联删缴费/退费）                                                                                                                    |
| 财务     | GET/POST        | /api/finance/payments                 | 缴费记录列表（分页 + 学员/支付方式/时间筛选）/ 登记缴费                                                                                               |
| 财务     | PUT/DELETE      | /api/finance/payments/:id             | 修改 / 删除缴费记录（admin）                                                                                                                          |
| 财务     | GET/POST        | /api/finance/refunds                  | 退费记录列表 / 提交退费申请                                                                                                                           |
| 财务     | PUT             | /api/finance/refunds/:id/approve      | 退费审批（通过/驳回，admin）                                                                                                                          |
| 财务     | DELETE          | /api/finance/refunds/:id              | 删除退费记录（admin）                                                                                                                                 |
| 财务     | GET             | /api/finance/stats/revenue            | 营收统计（granularity=day\|month + 时间范围）                                                                                                         |
| 财务     | GET             | /api/finance/stats/arrears            | 欠费统计（订单应缴 - 实缴差额清单与合计）                                                                                                             |
| 财务     | GET             | /api/finance/stats/low-hours          | 低课时预警（threshold 阈值，仅统计在读 + total_hours > 0）                                                                                            |
| 招生     | GET/POST        | /api/leads                            | 线索列表（分页 + 姓名/电话/状态/渠道筛选，教师仅见自己）/ 新增线索                                                                                    |
| 招生     | PUT             | /api/leads/:id                        | 修改线索（admin / teacher 仅自己）                                                                                                                    |
| 招生     | PUT             | /api/leads/:id/follow                 | 追加跟进记录（时间线留痕）                                                                                                                            |
| 招生     | PUT             | /api/leads/:id/status                 | 状态流转（新线索/跟进中/已转化/已流失）                                                                                                               |
| 招生     | PUT             | /api/leads/:id/convert                | 线索转化（事务：自动创建学员档案（含家长姓名/电话）+ 报班订单）                                                                                       |
| 招生     | DELETE          | /api/leads/:id                        | 删除线索（admin）                                                                                                                                     |
| 招生     | GET             | /api/leads/stats/channels             | 渠道统计（各渠道线索数/转化数/转化率）                                                                                                                |
| 通知     | GET             | /api/notifications                    | 通知记录（分页 + 学员/类型/日期/已读筛选；teacher 仅本班学员；家长姓名快照留痕）                                                                      |
| 通知     | PUT             | /api/notifications/:id/read           | 单条标记已读                                                                                                                                          |
| 通知     | PUT             | /api/notifications/read-all           | 全部标记已读                                                                                                                                          |
| 考试     | GET/POST        | /api/exams                            | 考试列表（分页 + 课程/班级/关键字筛选，含成绩录入进度；teacher 仅本班）/ 新增考试                                                                     |
| 考试     | PUT/DELETE      | /api/exams/:id                        | 修改 / 删除考试（删除级联删成绩；teacher 仅本班）                                                                                                     |
| 考试     | GET             | /api/exams/:id/scores                 | 成绩录入表单（考试信息 + 该班在读学生 + 已有成绩）                                                                                                    |
| 考试     | PUT             | /api/exams/:id/scores                 | 批量录入成绩（事务 upsert 冲突覆盖；仅新插入成绩时向学生档案家长发「成绩发布」通知，家长姓名快照，幂等）                                              |
| 考试     | GET             | /api/exams/:id/scorecard              | 成绩单（排名 + 等级 + 平均分，teacher 仅本班）                                                                                                        |
| 报告     | GET             | /api/reports/students/:id             | 学习报告（学员信息 + 近30天考勤 + 最近成绩 + 课时包 + 在读订单）                                                                                      |
| 报告     | GET             | /api/reports/students/:id/timeline    | 成长档案时间线（入学/报班/缴费/退费/考勤异常/成绩/结业）                                                                                              |
| 财务     | GET             | /api/finance/stats/consumption        | 课消统计（dimension=teacher\|course\|student + 日期范围；summary 含 consumed/refunded/revenue_recognized/can_see_amount；teacher 仅本班且金额不可见） |
| 财务     | GET             | /api/finance/stats/business           | 经营报表（admin：在读/营收/线索/续班/在读率 + 近12月营收 + 按课程营收 + 渠道转化）                                                                    |
| 健康     | GET             | /api/health                           | 容器健康检查                                                                                                                                          |
| 分析     | GET             | /api/analytics/metrics                | 指标定义字典（12 项，AI 解析口径；仅 admin）                                                                                                           |
| 分析     | GET             | /api/analytics/overview               | 全局经营概览（21 项指标 + 近 12 月营收趋势 + 渠道转化；仅 admin）                                                                                      |
| 分析     | GET             | /api/analytics/attendance/export      | 考勤数据批量导出（`format=json\|csv`，CSV 带 BOM；仅 admin）                                                                                           |
| 分析     | GET             | /api/analytics/finance/export         | 财务流水批量导出（缴费为正 / 退费为负；仅 admin）                                                                                                      |
| 分析     | GET             | /api/analytics/leads/export           | 招生线索批量导出（仅 admin）                                                                                                                           |
| 分析     | GET             | /api/analytics/scores/export          | 成绩数据批量导出（含等级列；仅 admin）                                                                                                                 |

## 测试

### 全生命周期端到端测试（e2e）

`server/scripts/e2e-lifecycle.mjs` 提供可重复执行的 API 级端到端回归测试，以「学生全生命周期」为主线验证数据一致性。需先启动后端（Docker 或本地），然后执行：

```bash
node server/scripts/e2e-lifecycle.mjs
```

覆盖范围（80 项断言）：

- **招生链路**：线索创建 → 跟进 → 转化（自动建档 + 报班，students/orders/leads 三表事务一致性）
- **财务链路**：报班订单、缴费登记/修改/删除、退费申请/审批、删除订单级联清理缴费与退费
- **考勤课时联动**：正常扣 1 课时 / 缺勤不扣 / 改回正常自动回补；缺勤通知生成与撤销幂等
- **家校链路**：学生档案家长信息、缺勤通知以家长姓名快照留痕、单条/全部标记已读、教师同班可见
- **结课与经营报表**：订单「在读→结业→再报班」后在读率/续班率联动
- **排课优化**：冲突检测（同班同时段拒绝 / 同教师跨班警告）、调课全链路（teacher 提交 → admin 审批 → 课表同步 + 状态流转 + 目标时段占用拒绝 + 重复提交拒绝）、补课联动课时（完成扣 1 课时 / 撤销回补 / 课时消耗流水）、教师调课补课列表仅本班
- **教学与课消链路**：考试创建 → 成绩录入（新插入）/ 修改（幂等不重复通知）→ 成绩发布通知（家长姓名快照）→ 成绩单排名与等级（95→优）→ 学习报告（最新成绩 + 出勤率 + 课时包）→ 成长档案时间线（成绩/入学/报班事件）→ 课消统计（扣减/回补流水、课时包余额、收入确认金额、admin 可见金额 / teacher 不可见且仅本班）
- **删除语义**：有报班/缴费/退费记录的学生删除返回 400 明确提示（不误删）；无业务记录学生删除级联清理考勤/请假/通知、线索转化关联置空；有考勤的课程、有学生的班级删除被拦截

脚本自动创建 `e2e_` 前缀测试数据，结束后自清理（含 preClean 容错），可重复运行、不留数据残留；全部断言通过时退出码为 0。

## 多端登录扩展（预留口子）

> 注意：系统定位为**纯员工端 CRM**。以下扩展口子仅针对机构员工端的多端登录（手机号 / 微信扫码登录员工账号），不面向学生 / 家长端。

1. **后端**：
   - 登录接口统一为 `POST /api/auth/login`，body 增加 `type` 字段（`password` / `phone` / `wechat`），本期仅实现 `password`，其余返回 501 占位
   - `users` 表已预留 `phone` 字段（UNIQUE），`user_oauth` 表可存储微信 `openid` / `unionid` 及第三方绑定
   - 认证中间件与 Token 签发逻辑与登录方式解耦，新增登录方式只需实现对应 `type` 分支
2. **前端**：登录页已预留「手机号登录」「微信扫码登录」占位入口，接入时替换为对应表单 / 扫码组件即可
3. **小程序**：小程序端可复用同一套后端 API（nginx 已反代 `/api`），登录时调用 `/api/auth/login` 传入 `type: "wechat"` 与 `code` 换取 openid 后签发 Token

## 许可证

[MIT © 2020-present, pure-admin](./LICENSE)
