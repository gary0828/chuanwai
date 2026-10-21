# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 结构。系统尚未发语义化版本号，暂以**日期**分段；进入正式版本后改为 `[x.y.z] - 日期`。

分类：`新增` `修复` `变更` `文档` `移除`。

---

## [未发布]

### 新增

- **课次支持「一节课 = 多课时」**（v30）—— `class_sessions.hours`，默认 1，可按课次设（两节连上填 2）
  - 新增 `PUT /api/sessions/:id/hours`；手工新增课次可带 `hours`；挪课自动继承原课次课时数
  - 已产生课时流水的课次**禁止改课时数**（否则流水与账面会不一致）
  - 扣减/回补原先硬编码 `±1`，现改由 `utils/hours-reconcile` 的 `charge()` / `refund()` 统一按课时数记账
- **学员档案软删除**（v30）—— `students.deleted_at`，删除改为移入「已删除」，历史数据全部保留
  - 新增 `POST /api/students/:id/restore`（仅 admin）；列表/导出支持 `deleted=1|all`
  - 学员列表新增「档案状态」筛选与「档案」列，操作列按状态显示「删除 / 恢复」
  - 点名、班级名单、成绩录入、成长档案、待办生成等**名单类**查询自动排除已删学员；财务与课消统计**照常包含**（用户拍板：历史数据全部保留）
- **删除守卫接入 `classes`**（`scanReferences` 自动发现）—— 删班级前不再依赖硬编码的 6 张表清单

### 修复

- **删班级会静默清空课次 / 任课 / 课堂评价**（P0）：原实现硬编码检查 6 张表，而 `classes` 实际被 **12 张**表引用，其中 `class_sessions` / `teaching_assignments` / `class_evaluations` 是 CASCADE、`orders.class_id` 是 SET NULL。班级下学生已转走但学期课次已生成时，删除会连带清空课次（及其考勤锚点）并把订单班级静默置空，接口仍返回成功。现改为 `delete-guard` 自动发现，并逐项列出引用明细
- **删学员的影响面清单少算 3 类数据**（P0）：`buildDeleteImpact` 硬编码 6 张表，漏了 `class_evaluations` / `kp_assessments` / `student_timeline`。改为 `scanReferences` 自动发现；同时因改为软删，这些数据已不再被删除，确认框文案同步改为「档案移入已删除，历史数据保留」
- **转班追认历史业绩**：课消统计（`finance/stats/consumption` 的 teacher 维度）原按 `students.class_id`（学员**当前**班级）聚合，学员转班后原班历史课消被整笔算到新班。改为优先用流水上的 `class_id`（写入时班级快照），老流水无快照才回退当前班级
- **课时扣减的「单一权威」注释与代码不符**：`hours-reconcile.js` 声称三处已收口，实际 `leaves.js` / `makeups.js` 仍各自写 SQL。现真正收口到 `charge()` / `refund()`，注释改为如实描述两层结构（对账层 / 记账层）
- **删除考试的级联成绩不可见**：`DELETE /api/exams/:id` 现在回报 `{deletedScores}` 并写入审计详情
- **删除员工的失败提示笼统**：由 `scanReferences("users")` 自动发现阻塞项，提示「被哪些表引用」而不只是「存在关联数据」

### 变更

- **收入口径命名统一**：新增 `revenue_accrual`（权责发生制：已消耗课时对应收入）与 `revenue_cash_net`（收付实现制：实收 − 退费）两个自解释字段，旧字段 `revenue_recognized` / `revenue_total` / `totalRevenue` **保留不动**（零破坏）。两个口径的数值均未改变
- 学员名单类查询统一加 `deleted_at IS NULL`：`attendance`（点名 / 预警）、`classes`（班级名单）、`exams`（成绩名单）、`sessions`（课次点名）、`growth`（课评 / 知识点测评）、`timeline`、`todo-generator`、`agent`
- 数据库基线 **v28 → v30**（补登记 v29「课时流水来源」）

### 文档

- 新增 `docs/08-参考/业务逻辑关联性审查-2026-10-18.md`（全仓只读审计：P0×2 / P1×3 / P2×3 / P3×1）
- 新增项目级 skill `.workbuddy/skills/business-logic-audit/`（业务逻辑关联审查方法：5 维度 + 域地图 + 输出规范）
- `server/database.md` 补登 v29 / v30 版本历史与 `class_sessions.hours`、`students.deleted_at` 字段
- `docs/04-API/API.md` 与 `openapi.yaml` 同步 3 个新端点 + 2 处语义变更

### 新增（既有）

- **「使用指南」单页**（左侧菜单最末一项，`/#/guide`，admin 与 teacher 均可见）—— 面向**完全没有技术背景的校区老师**的保姆级操作说明
  - 六节内容：项目用途与适用场景 / 使用前的准备（含负责人一次性初始化 9 步顺序）/ 全部 36 个页面逐个的分步操作 / 四大业务流（招生转化、开学前排课、日常上课点名、课时与费用对账）/ 16 条按现象检索的常见问题 / 4 组关键注意事项
  - 排版参考 pure-admin 官方文档：右侧「本页目录」锚点导航（随滚动高亮）、顶部页内关键字搜索、编号步骤、三色提示框
  - 文案与视图分离（`src/views/guide/content.ts` + `index.vue`），改文字不用碰模板，也让可读性检查能直接读内容
  - 每个功能标注可见角色；「打开这个页面」按钮**只对有权使用的账号显示**（老师看不到 admin-only 页面的入口）
  - 新增两条可执行门禁：`_verify_test/check-guide.mjs`（内容一致性 + 可读性，16 项）与 `_verify_test/ui-guide.py`（浏览器实证，双角色 36 项）
  - 新增 `_verify_test/extract-ui-facts.mjs` —— 静态抽取各页面真实控件清单，作为写文档时的事实来源，杜绝"凭印象编造按钮"

### 变更

- **上传/推送一律排除测试数据**（用户拍板，永久规则，记忆 K-085）：`.gitignore` 新增专门一节，排除自然语言 e2e 试点工程 `_verify_test/e2e-flow/`、一次性排障脚本 `diag-*` / `fix-*`；复核确认 `server/data/`（数据库本体）与 `evidence/`（含真实姓名电话的截图）维持排除。成体系的回归套件仍作为项目资产入库
- `_verify_test/preflight.mjs` 的 `SKIP_DIRS` 增加 `.e2e` —— e2e 运行器的录制缓存是生成物且已排除入库，扫它只会产生无法处理的假阳性

### 文档

- 全项目文档体系重构：README 精简为入口页（54 KB → 7 KB），`docs/` 改为八个子目录 + `archive/`
- 新增 `docs/01-文档规范.md`（术语表、排版、命名、归档规则）、`CONTRIBUTING.md`、本文件
- 新增 `docs/02-快速开始/`（安装与启动、账号与权限）与 `docs/05-配置/`（环境变量、AI 与大模型）
- 8 份时点性报告移入 `docs/archive/`，原文保留，仅在导航页留索引

---

## [2026-09-23]

### 修复

- **生产部署整页白屏**（控制台 `Cannot read properties of undefined (reading 'split')`）：`git clone` 部署时 `.env.production` 被 `.gitignore` 的 `.env.*` 规则一并排除，`VITE_ROUTER_HISTORY` 被构建内联为 `undefined`，路由在应用启动瞬间崩溃。修复：① `getHistoryMode` 增加默认参数与非法值兜底 —— env 缺失也不再崩；② `.gitignore` 收窄为**只忽略真密钥**（`.env` / `*.local`），把 `.env.development` / `.env.production` / `.env.staging` 纳入版本库（三者只含 `VITE_*`，无密钥）
- `.dockerignore` 排除真密钥 `.env`，真密钥不再进入构建上下文

### 变更

- **Docker 部署统一为一份编排**：删除并存的「三端口」形态，`docker-compose.yml` 即统一入口单端口（教务 `/` + 工作台 `/ai/` + 后端 `/api`）；移除 `docker-compose.unified.yml`；`deploy/linux-server-setup.sh`、`deploy.sh`、部署文档同步
- **大模型 Key 移出 `.env`**：不再经 `.env` / compose 注入，只在「AI 配置中心」页面（`/#/ai-admin`）配置（存数据库 `settings` 表）；`config.js` 保留环境变量作末位兜底默认

### 文档

- 同步更新 README、安装与启动、环境变量、AI 与大模型、校区部署与升级、运维约定，部署口径统一

---

## [2026-09-21]

### 新增

- 待办功能 L2（手工待办）：迁移 v19 + 双端页面 + 权限边界
- 待办 L3 自动生成：4 类事件，按归属矩阵投递，前端折叠展示
- 站点信息可配置 + Logo 上传

### 修复

- 顶栏铃铛接真实公告，删除演示数据
- 1.8 MB 图片上传被 nginx 413 拒绝（`client_max_body_size` 三处配置脱同步）
- 补 3 份 nginx 的 `/assets` 反代；公开端点只返回非空项

### 文档

- 定案数据资产化与 AI 产出层架构（ADR-008）
- 建立项目长期记忆四层架构，MEMORY 注入量 16k → 4k

### 变更

- 清理项目冗余文件并纳入部署脚本

---

## [2026-09-20]

### 新增

- 学生成长时间轴；AI 工作台多菜单接真实数据
- 统一入口部署形态，彻底解决免登跳转串端口

### 修复

- **冷启动直达动态路由永久白屏**（自首个提交即存在）：守卫只在 `to` 能匹配已注册路由时才执行，改为在守卫最前面调用 `ensureAsyncRoutes()`，并补登出重置与失败重试
- 独立端口 / 同源部署下跳转地址丢失工作台端口导致 404
- AI 配置中心保存时只落库真正改动的项

### 文档

- 部署指南补「在页面上填 Key」，不再要求改 `.env`
- 补全并行验收覆盖文件的用途与用法说明

---

## [2026-09-19]

### 文档

- 新增架构现状评估与演进方案（归档）

---

## [2026-09-18]

### 变更

- 全站视觉改版为「专业信赖」方向（功能零变更）：主色深靛蓝 `#1F5C99`、语义色去糖果化、卡片细边框
- 登录页背景改为「教务格栅」，移除左右分栏的不对称
- AI 工作台配色全面对齐教务系统

### 文档

- 新增前端视觉规范；README 补界面设计规范章节

---

## [2026-09-16]

### 新增

- AI 配置中心（`/ #/ai-admin`），免登地址跟随访问者，改完即生效不用重建容器
- 一键部署脚本与出厂重置脚本

### 修复

- 空数据导出 CSV 补表头；e2e 不再依赖种子数据

---

## [2026-09-14]

### 新增

- AI 教学工作台与教务只读网关（`/api/agent/*`）
- 服务端大模型接入 + 出网二次脱敏
- 使用反馈模块（迁移 v16）
- Dify 部署配置与 ai-workbench 容器化

### 修复

- `ui-p0-verify` 改为接口登录注入 token，并修正过期的权限断言

### 移除

- 清理模板残留死代码与不可达分支，净减 1,027 行 / 5 个依赖

### 文档

- 新增校区部署升级指南、Dify 上手指南、AI 教师助手调研报告、ADR-007、过度设计审计报告

---

## [2026-09-12]

### 新增

- 培训机构教务管理系统首次入库

### 修复

- 上线门禁修复 + 全面测试发现的 5 项缺陷
- 收紧教师权限：费用与销售数据仅管理员可见

### 变更

- 建立 AI 读取排除规则与项目地图，降低上下文开销
