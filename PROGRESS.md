# 项目进度（PROGRESS）

> 每次会话开始读取本文件，结束更新。最近更新：**2026-09-12**
> 数据库版本：**v14** ｜ e2e：`server/scripts/e2e-lifecycle.mjs`（80 项断言，全绿）｜ analytics 冒烟：22 项（全绿）｜ P0 浏览器验证：31 项（全绿）
> 上线倒计时：**用户下周在校区正式使用** —— P0 模块优先于一切。

---

## 已完成

- [x] 项目初始化核查：读取 `README.md` / `server/database.md`，确认前后端运行方式（2026-09-11）
- [x] **e2e 基线确认通过**：`node server/scripts/e2e-lifecycle.mjs` → **PASS 80 / FAIL 0**，退出码 0（2026-09-11）
  - 注：README 原写「61 项断言」已过期，已修正为 80 项
- [x] **修复前端依赖不完整问题**：`node_modules` 顶层全为空目录（junction 链接丢失），表现为 `Cannot find module '.../node_modules/vite/bin/vite.js'`；执行 `pnpm install --frozen-lockfile` 重建后 vite 7.1.12 正常启动（2026-09-11）
- [x] **创建 `WORKBUDDY.md`**：项目规则文件，原样包含 pure-admin 官方规范（第〇节），并补充 P0 清单、迁移规则、API 文档规则、浏览器测试要求、本机环境注意事项（2026-09-11）
- [x] **创建 `docs/api.md`**：API 唯一权威文档。含通用约定、错误码、认证、角色数据权限、**全量接口总览（110+ 端点）**、P0 模块接口详解、analytics 信封与指标口径、新增 API 流程（2026-09-11）
- [x] **创建 `docs/openapi.yaml`**：OpenAPI 3.0 机器可读规范，覆盖认证 + 4 个 P0 模块 + 通知 + analytics，含复用 schema / responses（2026-09-11）
- [x] **预留并实现 AI 分析端点 `/api/analytics`**（2026-09-11）
  - `GET /api/analytics/metrics`：指标定义字典（12 项，含 formula / source_table / unit）
  - `GET /api/analytics/overview`：全局经营概览（21 项指标 + 近 12 月营收趋势 + 渠道转化）
  - `GET /api/analytics/{attendance|finance|leads|scores}/export`：批量导出，支持 `format=json|csv`（CSV 带 UTF-8 BOM）
  - 权限：JWT + **仅 admin**；统一 AI 分析信封（`data.metrics / data.records / data.meta`，`meta.data_version` 实时取自 `PRAGMA user_version`）
  - 已注册到 `server/src/index.js` 路由与审计模块表
  - **冒烟测试 22/22 通过**：`node server/scripts/analytics-smoke.mjs`（含权限 401/403、未知数据集 404、CSV BOM 字节校验、日期过滤）
- [x] **修复 P0 缺陷：学生档案「来源渠道 / 报名日期」缺失**（2026-09-11）
  - 问题：`students.source_channel` / `students.enroll_date` 自 v9 已存在，但 `POST/PUT /api/students` **不接收**、学生管理页**无展示列也无表单字段**，导致手动建档无法记录来源渠道（与 §1.2 B 及 README 声明不符）
  - 后端修复（`server/src/routes/students.js`）：POST / PUT / import 接收并持久化两字段（PUT 使用 `?? cur.xxx` 保留原值语义），export 输出两字段
  - 前端修复（`src/views/attendance/students/index.vue`）：列表新增「来源渠道」「报名日期」列；新增/编辑弹窗新增「来源与报名」分组（渠道下拉 + 日期选择，均为选填）；导入模板与解析同步支持两列
  - **无需数据库迁移**（列已存在于 v9）
  - 验证：e2e 仍 80/80；浏览器 ST-3 / ST-4 / ST-6 / ST-7 全通过
- [x] **P0 四模块浏览器验证（Playwright，31/31 通过）**（2026-09-11）
  - 脚本：`server/scripts/ui-p0-verify.py`（可重复执行，自带 setup/cleanup）
- [x] **修复 bug：8 处图标完全不渲染（同时导致 `pnpm lint` 失败）**（2026-09-11）
  - 问题：8 个视图写了 `<el-icon><component is="ep:xxx" /></el-icon>`。Vue 3 要求 `:is` 绑定，纯字符串属性会让 Vue 把 `ep:plus` 当作**未知自定义元素**渲染——**图标静默不显示、控制台无报错**（实测 DOM 为 `<ep:plus></ep:plus>`，无 `<svg>`）。同时触发 ESLint `vue/require-component-is`（8 个 error），使项目自带的 `pnpm lint` 退出码 1。
  - 涉及位置：`attendance/{makeups,schedules,statistics,adjustments}`、`finance/consumption`、`teaching/{exams,growth,reports}`（图标为 ep:plus / ep:warning / ep:printer / ep:right）
  - 修复：按官方写法改用 `unplugin-icons` 的构建期离线图标 —— `import EpPlus from "~icons/ep/plus"` + `<el-icon><EpPlus /></el-icon>`（纯离线，不依赖网络，适合校内断网部署）
  - 验证：DOM 已渲染出 `<svg>`；`pnpm lint:eslint` 由 **8 errors → 0 errors**
- [x] **修复「生产构建 / Docker 部署被阻断」的构建错误**（2026-09-11）
  - 问题：`pnpm build` 直接失败 —— `src/assets/iconfont/iconfont.js (23:21): Expression expected`。**Dockerfile 前端阶段执行 `pnpm build`，因此 Docker 部署同样会失败**，属交付阻断级问题。
  - 根因（已通过对照实验确认）：`vite-plugin-remove-console` 在处理该文件时，只删掉了 `console && console.log(t)` 中的 `console.log(t)` 片段，残留 `console && ;` 这一非法表达式，rollup 随即解析失败。该插件的 `external` 选项（官方配置里正是用来排除此文件的）在 **v2.2.0 实测对本项目源文件不生效**（改用 `"iconfont.js"` 短路径亦无效；整体注释掉插件后构建 17.8s 成功通过）。
  - 修复：保留 `removeConsole`（生产 console 清理仍生效），把 `iconfont.js` 中该 catch 分支改为不调用 `console`（空处理 + 中文注释说明原因），避免被插件局部删除。
  - 验证：`pnpm build` → **BUILD_EXIT=0**，打包成功
- [x] **Docker 全栈部署真机验证通过（9/9 + e2e 80/80 + 浏览器 31/31）**（2026-09-12）
  - 环境：Docker Desktop 29.7.2 / Compose v5.4.0 / Buildx v0.36.1
  - 容器：`attendance-server`（:3000，healthy）、`attendance-web`（:8080）
  - `bash server/scripts/docker-verify.sh` → **PASS 9 / 9**：容器运行、`/api/health` 200、前端 SPA 入口 200、SPA 深链接 fallback 200、**nginx 反代 `/api` 200**、admin 登录（挂载 SQLite 可读）、学生表 27 条、`/api/analytics/overview` 200（`data_version=v14`）、容器内 `/app/data/attendance.db` 在位
  - 对 Docker 后端跑 e2e：**80/80**；analytics 冒烟：**22/22**
  - 对 Docker **生产构建**（:8080）跑 P0 浏览器验证：**31/31**，控制台零错误
  - 新增 `server/scripts/ui-icon-check.py`：生产构建下 7 个页面的 `el-icon` **全部**渲染出 `<svg>`（如 29/29、36/36），确认图标修复在生产包中同样生效
  - **容器内 `pnpm build` 成功（26.18s）** —— 证明构建阻断修复在 Docker 内同样有效
- [x] **修复 Docker Compose 项目名为空的阻断**（2026-09-12）
  - 问题：`docker compose up -d --build` 直接报 `project name must not be empty`
  - 根因：Compose 用**所在目录名**推导项目名且只接受小写字母/数字/`-`/`_`；本项目目录为纯中文「教学管理系统」，清洗后为空串
  - 修复：`docker-compose.yml` 顶部显式声明 `name: attendance-system`
- [x] **定位并规避 Docker Desktop/Buildx 的 gRPC 缺陷**（2026-09-12）
  - 问题：`docker compose up --build` 报 `failed to dial gRPC: header key "x-docker-expose-session-sharedkey" contains value with non-printable ASCII characters`；`COMPOSE_BAKE=false` 无效
  - 定位（对照实验）：裸 `docker build` 在 **ASCII 路径与中文路径下均成功**；失败只出现在 `docker compose` 的 Bake 路径上 —— 该路径会把**工作目录**编码进 gRPC 会话头，中文目录产生非 ASCII 字符
  - 规避：`docker build -t attendance-system-server/-web` + `docker compose up -d --no-build`（已实测可用）；或把项目移到纯 ASCII 路径后正常使用 compose
  - 已写入 `README.md` 排障小节

## 进行中

- [ ] 无（本轮任务已闭环）

## 待办（按优先级）

- [ ] **P0**：成绩管理浏览器验证目前仅覆盖「页面可打开」。待补：创建考试 → 成绩录入 → 成绩单排名/等级 → 成绩发布通知 的全链路浏览器走查（API 层已由 e2e 覆盖）
- [ ] **P0**：销售管理浏览器验证目前仅覆盖「页面可打开 + 入口齐全」。待补：创建线索 → 追加跟进 → 状态流转 → 一键转化（自动建档 + 报班）→ 渠道统计 的浏览器走查（API 层已由 e2e 覆盖）
- [ ] **P0**：学生管理待补：新增学生 → 编辑 → Excel 导入（含错误行）→ 导出 的浏览器走查
- [ ] **P0**：签到页「缺勤自动生成家长通知 / 课时扣减」的浏览器侧核对（进入「通知记录」页确认通知生成、进入「报班管理」确认课时扣减）
- [ ] 跨模块联动清单（`WORKBUDDY.md` 第三节）逐项在浏览器复验
- [x] ~~Docker 完整验证~~ → **已完成（2026-09-12，9/9 + e2e 80/80 + 浏览器 31/31）**
- [ ] 本仓库**尚未 `git init`**；若要版本管理需先初始化并按 commitlint 规范提交
- [ ] 若坚持使用 `docker compose up -d --build`（而非 `docker build` + `--no-build`），需把项目移到纯 ASCII 路径（Docker Desktop 缺陷，见「已知问题 7」）

## 已知问题

1. **`node_modules` 顶层 junction 丢失**（环境层面，非代码）：表现是 `Cannot find module '.../node_modules/vite/bin/vite.js'`。→ **环境坑统一维护在 `WORKBUDDY.md` §八**，此处不重复（文档去重叠，2026-09-12）。
2. **本仓库不是 git 仓库**（无 `.git`）：`pnpm install` 的 husky `prepare` 会提示 `.git can't be found`（不影响安装）。提示词中的「提交 Git」步骤当前无法执行。
3. **`.env.example` 缺失**：提示词与 `WORKBUDDY.md` 均要求「新增环境变量同步更新 `.env.example`」，但根目录与 `server/` 下都没有该文件。建议补建（本系统环境变量为 pure-admin 默认项，无自定义密钥）。
4. **README 与真实实现存在偏差**（已修正其中一处）：e2e 断言数 61 → 80。另需注意：提示词第三节给出的 `POST /api/attendance/batch` 请求体含 `class_id`、响应含 `hours_deducted/notifications_created`，而**真实实现不含 `class_id`**（班级由学生档案决定），响应为 `{ count }`。`docs/api.md` 以**真实实现**为准。
5. **`vite-plugin-remove-console` 的 `external` 选项失效**（v2.2.0 实测）：无法用它排除指定源文件。已在 `build/plugins.ts` 就地注释说明；若日后需要真正排除文件，考虑改用 `custom` 配置或换插件，并在升级 `iconfont.js` 后重新验证 `pnpm build`（iconfont.cn 重新下载的文件会带回 `console && console.log(t)` 写法，**会导致构建再次失败**）。
6. **构建前置检查建议**：`pnpm build` 曾长期处于失败状态却未被发现（`dist/` 是历史产物）。建议把 `pnpm lint:eslint` + `pnpm build` 纳入每次前端改动后的必跑项（已写入 `WORKBUDDY.md` §九）。
7. **Docker Desktop / Buildx 缺陷（环境层面）**：`docker compose up --build` 在本项目**中文目录**下必然失败（gRPC 会话头含非 ASCII），`COMPOSE_BAKE=false` 无法规避。解法：① 用 `docker build` + `docker compose up -d --no-build`（方案 B，已实测可用）；② 或把项目移到纯 ASCII 路径。详见 `README.md` 排障小节。
8. **前端镜像基础版本**：`Dockerfile` 用 `node:20-alpine` 构建前端，而 `package.json` 的 engines 允许 `^20.19.0 || >=22.13.0`——当前实测通过，但后续 Node 20 进入 EOL 时建议升到 `node:24-alpine` 与后端一致。
9. **浏览器标签页标题**仍为模板默认 `pure-admin-thin`（`index.html` 的 `<title>` 未改），不影响功能，建议改为系统名。

### 🔴 安全评审发现（2026-09-12 代码评审，**用户决定暂不修、自行评估**）

> 以下 5 条由深度代码评审发现。上线前建议至少处理第 10 条（影响面最大）。

10. **JWT 密钥硬编码且生产未注入**（`server/src/middleware/auth.js:4`）
    - `const SECRET = process.env.JWT_SECRET || "attendance-secret-key-change-me"`，而 `docker-compose.yml` **只配了 `PORT`，没有 `JWT_SECRET`** → 生产环境使用源码中的公开密钥。
    - 影响：任何拿到源码的人可自签 `role:"admin"` 的 token，获取**全部学员 / 家长电话 / 缴费数据**。培训机构多为局域网部署，端口可达性高。
    - 建议修法：启动时若无 `JWT_SECRET` 直接 `throw` 拒绝启动；用 `openssl rand -hex 32` 生成并注入 compose；`.env.example` 补上该项。

11. **CORS 完全开放**（`server/src/index.js:16` `app.use(cors())`）：任意站点可跨域调用 API，与第 10 条叠加可直接打穿。建议限制为前端来源。

12. **请求体明文写入日志**（`server/src/index.js:63-70`）
    - `body=${JSON.stringify(req.body)}` 会把**登录密码、家长电话**写入 Docker 日志，涉及未成年人个人信息合规。建议改为只记 `method / path / status / 耗时`。

13. **无登录失败限速**：默认弱口令 `admin123456` 可被无限次爆破。建议加 `express-rate-limit`，失败 5 次锁定 15 分钟。

14. **恢复备份接口直接 `process.exit(0)`**（`server/src/routes/backups.js:25-27`）：任何持有 admin token 者可一键停服；本地非容器运行时不会自愈。建议改为优雅关闭 / 由外部编排重启。

## pure-admin 合规审计（2026-09-12，对照官方仓库实测）

> 方法：拉取官方 `pure-admin/pure-admin-thin`（精简版）与 `pure-admin/vue-pure-admin`（完整版）源码逐项比对，不靠记忆。

| 审计项 | 结论 |
| --- | --- |
| `dependencies` | 官方精简版 24 个 / 本项目 25 个，**仅多 1 个 `xlsx@^0.18.5`**（Excel 导入导出用），**版本号与官方完整版完全一致**，属官方认可依赖。其余 24 个**版本全一致** |
| `devDependencies` | 官方 53 个 / 本项目 53 个，**零差异** |
| `src/components/` | 官方精简版 8 个组件（ReAuth/ReCol/ReDialog/ReIcon/RePerms/RePureTableBar/ReSegmented/ReText），本项目 **8 个，一个不差** |
| `build/plugins.ts` | 全部为官方精简版自带插件，**无第三方野路子插件** |
| 前后端接口一致性 | 前端调用 **108** 个接口 / 后端定义 **115** 个路由 → **前端调的后端全都有，零死链** |
| ESLint | 改动文件 0 error |

**结论：依赖与组件 100% 官方来源，没有任何非官方第三方包。**

### 已确认的偏离（历史遗留，已记录在案）

- 15 个视图用 `<el-dialog>`、全部列表页用 `<el-table>` → 见下方「pure-admin 规范符合性检查」，go-live 后按页迁移
- `server/src/routes/schedules.js` 的 `POST /api/schedules/check-conflict` 未在 `docs/api.md` 登记 → **文档待补**
- `build/plugins.ts` 中 `vitePluginFakeServer({ enableProd: true })`：mock 在**生产包中也被打包**。因 mock 路径为 `/login`、`/refresh-token`、`/get-async-routes`，与真实接口 `/api/*` 不冲突，**不会覆盖真实数据**，但会增大包体 → 建议改为 `enableProd: false`
- 主 chunk `index-*.js` 达 **2,039 kB（gzip 684 kB）**，未做 manualChunks 拆分 → 首屏加载偏慢，可优化

## 登录图形验证码移植（2026-09-12 已完成）

**原因**：项目基于 **pure-admin-thin（精简版）**，官方精简版 `src/components/` 只有 8 个组件，**`ReImageVerify` 被官方精简掉了**，不是配置丢失。

**已完成**（源码与官方 `vue-pure-admin@main` 逐行一致）：

- 新增 `src/components/ReImageVerify/{index.ts, src/index.vue, src/hooks.ts}`
- `src/views/login/utils/rule.ts`：新增 `createLoginRules(getImgCode, captchaEnabled)` 工厂 + `verifyCode` 校验规则
- `src/views/login/index.vue`：接入验证码输入框 + canvas、登录失败自动刷新验证码
- 新增 `.env.example`，含 `VITE_LOGIN_CAPTCHA` 开关

**两个主动改动（重要）**：

1. **不修改 `src/store/modules/user.ts`**：官方把验证码存进 store 的 `verifyCode` 字段，但 `WORKBUDDY.md` §0.3 禁止改框架核心文件 → 改为由登录页通过 `getImgCode()` 传入
2. **去掉登录页默认填充的 `admin / admin123456`**：原代码把管理员账号密码**明文预填在登录框里**（打开页面即可见，F12 更可见）。上线后任何人走到电脑前都能直接登录 → 已改为空

**验证**：ESLint 0 error；`pnpm build` 等价构建 **BUILD_EXIT=0**（21.23s，3.55 MB）

**⚠️ 影响自动化验证**：`server/scripts/ui-p0-verify.py`（31 项）通过 UI 表单登录，**无法识别 canvas 验证码**。跑验证前需设 `VITE_LOGIN_CAPTCHA=false`。建议后续把脚本改为「接口登录 + 注入 token」，一次改造永久免疫登录页改动。

## pure-admin 规范符合性检查

> 每次改动前端后自查。判定依据：pure-admin 官方文档 + 官方仓库源码（`src/views/components/dialog/`）。

| 规范条目 | 现状 | 结论 |
| --- | --- | --- |
| 接口集中在 `src/api/`，用官方 `http` 封装 | `src/api/{user,routes,attendance,teaching}.ts` 覆盖全部业务接口；`src/views/**` 内 **零** `axios`、**零** `http.request` 直调 | ✅ 符合 |
| 禁止在 template 用 `$route` / `$router` | `src/views/**` 内 **零** 使用 | ✅ 符合 |
| 禁止直接操作 `localStorage` | 业务代码内 **零** 使用（持久化走官方封装） | ✅ 符合 |
| 环境变量以 `VITE_` 开头 | `VITE_PORT` / `VITE_PUBLIC_PATH` / `VITE_ROUTER_HISTORY` / `VITE_CDN` / `VITE_COMPRESSION`，全部合规 | ✅ 符合 |
| 路由 `name` 与页面 `defineOptions({ name })` 一致 | 后端下发路由 name（`Checkin` / `Students` / `TeachingExams` / `RecruitLeads` …）与各页面 `defineOptions` 一致 | ✅ 符合 |
| **弹窗统一用 `ReDialog` / `ReDrawer`** | **15 个视图在 template 中直接使用 `<el-dialog>`**（`welcome` / `recruit/leads` / `attendance/{students,classes,courses,records,leaves,makeups,schedules,users}` / `finance/{orders,payments}` / `teaching/exams` / `system/notices` / `system/audit-logs`） | ⚠️ **偏离，已记录（见下）** |
| **表格统一用 `@pureadmin/table`** | **全部列表页使用 `<el-table>`**（Element Plus 原生） | ⚠️ **偏离，已记录（见下）** |

**关于「弹窗 / 表格」两条的处置决定（重要，请用户知悉）**

经查 pure-admin 官方文档与官方仓库源码：**`ReDialog` 的官方定位是「函数式弹框」**（`addDialog({ title, contentRenderer, props })` + 生命周期回调），设计目的是**逻辑解耦、状态隔离、可复用表单**，官方示例位于 `src/views/components/dialog/`。它**并不是**「所有声明式弹窗都必须改用它」的要求——官方自身也保留 `<el-dialog>` 的声明式用法。

因此本项目的处置是：

- **不回退、不破坏**：现有 P0 页面是**已通过浏览器验证、下周即将上线**的可用代码。在 go-live 前把 15 个视图的弹窗 / 表格整体重写为 `addDialog` 函数式 / `@pureadmin/table`，属于**高风险大范围重构**，与「P0 模块优先于一切」「上线前不引入回归」直接冲突。
- **约定**：**新增**的复杂弹窗优先按函数式 `ReDialog` 编写；**新增**列表页必须使用 `@pureadmin/table`（支持 `cellRenderer`）。此约定已写入 `WORKBUDDY.md` §0.5。
- **排期**：go-live 后按「一页一改、每页浏览器复验」的节奏逐步迁移，不批量重写。
- `src/components/ReDialog/index.vue` 属框架组件，**禁止改动**（当前未被修改）。

> 若用户希望**立即**执行全量迁移，请明确指示；否则按上述约定在 go-live 后推进。

## 最近一次浏览器验证

### ① Docker 生产构建（2026-09-12，推荐以此为准）

- **时间**：2026-09-12 08:5x（GMT+8）
- **环境**：Docker 容器 `attendance-web`（nginx 托管生产包）→ `http://localhost:8080`；后端 `attendance-server` → `http://localhost:3000`
- **工具**：系统 Python 3.14 + Playwright 1.62（Chromium）
- **脚本**：`server/scripts/ui-p0-verify.py`、`server/scripts/ui-icon-check.py`、`server/scripts/docker-verify.sh`
- **结果**：
  - `docker-verify.sh` → **PASS 9 / 9**
  - e2e（打 Docker 后端）→ **PASS 80 / FAIL 0**
  - analytics 冒烟 → **PASS 22 / 22**
  - P0 浏览器验证（:8080）→ **PASS 31 / 31**，控制台错误 0
  - 图标渲染检查（生产包，7 个页面）→ **7 / 7**，所有 `el-icon` 均含 `<svg>`

### ② 本地 vite 开发模式（2026-09-11）

- **环境**：vite dev `http://localhost:8848` + 后端 `http://localhost:3000`（SQLite v14）
- **工具**：系统 Python 3.14 + Playwright 1.62（Chromium）
- **脚本**：`server/scripts/ui-p0-verify.py`（自带课表 setup/cleanup，可重复运行）
- **结果**：**PASS 31 / FAIL 0**

| 编号 | 检查项 | 结果 |
| --- | --- | --- |
| P0-0 | admin 登录进入首页 | ✅ |
| CK-1 | 签到页打开（日期/班级/课程/查询/提交按钮齐全） | ✅ |
| CK-2 | 可设置考勤日期（日期框值 = 2026-09-11） | ✅ |
| CK-3 | 可选择班级（软件工程一班） | ✅ |
| CK-4 | **班级+日期自动带出当天课表课程**（高等数学） | ✅ |
| CK-5 | 点击当天课表标签即选中课程 | ✅ |
| CK-6 | 加载全班名单（8 行） | ✅ |
| CK-7 | 逐人标记「迟到」 | ✅ |
| CK-8 | 逐人标记「缺勤」 | ✅ |
| CK-9 | 批量提交成功提示 | ✅ |
| CK-10 | **刷新后考勤状态回显**（落库确认） | ✅ |
| ST-1 | 学生列表打开 | ✅ |
| ST-2 | 含「家长」列 | ✅ |
| ST-3 | 含「来源渠道」列（本次修复） | ✅ |
| ST-4 | 含「报名日期」列（本次修复） | ✅ |
| ST-5 | 按班级筛选无报错（8 行） | ✅ |
| ST-6 | 新增弹窗含「来源渠道」字段（本次修复） | ✅ |
| ST-7 | 新增弹窗含「报名日期」字段（本次修复） | ✅ |
| EX-1 | 成绩管理页打开 | ✅ |
| LD-1 | 线索管理页打开 | ✅ |
| LD-2 | 含渠道/状态/跟进/转化入口 | ✅ |
| NT-1 | 通知记录页打开 | ✅ |
| CE-1 | admin 全程无控制台错误 | ✅ |
| TC-0 | teacher 登录成功 | ✅ |
| TC-1 | teacher 可访问学生管理 | ✅ |
| TC-2 | teacher 菜单无「员工账号」 | ✅ |
| TC-3 | teacher 可访问考勤登记 | ✅ |
| TC-4 | teacher 可访问成绩管理 | ✅ |
| TC-5 | teacher 可访问线索管理 | ✅ |
| TC-6 | teacher 被拒「经营报表」（403） | ✅ |
| CE-2 | teacher 全程无控制台错误 | ✅ |

- **截图**：`evidence/p0_checkin.png`、`evidence/p0_students.png`、`evidence/p0_exams.png`、`evidence/p0_leads.png`、`evidence/p0_teacher_scope.png`
- **发现的 bug 与修复状态**：签到模块未发现缺陷；学生模块发现「来源渠道 / 报名日期 前后端均缺失」已修复并复验通过。

## 下一步建议

1. 按上面「待办」补齐成绩 / 销售 / 学生三个模块的**全链路浏览器走查**（当前仅覆盖「页面可用」，API 层已由 e2e 覆盖）。
2. 补 `.env.example`（已知问题 3）。
3. 决定是否 `git init` 建立版本管理（已知问题 2）。
4. **Docker 完整验证**（交付前必做）。
5. go-live 后按约定逐步迁移 `el-dialog` → 函数式 `ReDialog`、`el-table` → `@pureadmin/table`。
