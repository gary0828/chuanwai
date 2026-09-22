---
title: API 权威文档 · 教务管理系统
status: active
updated: 2026-09-21
---

# API 权威文档 · 教务管理系统

> **本文件是本项目 REST API 的唯一权威文档**，人类可读；机器可读版本见 [`openapi.yaml`](openapi.yaml)（OpenAPI 3.0）。
> 每次新增 / 修改接口**必须同时更新这两份**。
>
> 后端：Express 4 + `node:sqlite` ｜ 数据库版本：**v19** ｜ 文档最后整理：2026-09-21
> 本文按接口分组编排：1 通用约定 → 2 接口总览 → 3 业务模块 → 4~8 AI / 反馈 / 成长 → 9 变更流程。

---

## 1. 通用约定

### 1.1 基础信息

| 项 | 值 |
| --- | --- |
| 开发环境 Base URL | `http://localhost:3000` |
| Docker 环境 Base URL | `http://localhost:3000`（nginx 反代 `/api` → `server:3000`） |
| 统一前缀 | `/api` |
| 认证方式 | `Authorization: Bearer <accessToken>` |
| 内容类型 | `application/json; charset=utf-8` |
| 健康检查 | `GET /api/health`（免认证，返回 `{ success: true, data: { status: "ok" } }`） |

### 1.2 统一响应格式

**成功**（绝大多数接口）：

```json
{ "success": true, "data": { } }
```

分页接口的 `data` 统一为 `{ "list": [], "total": 0 }`。

**失败**：

```json
{ "success": false, "message": "错误说明" }
```

**`/api/analytics/*` 例外**：使用「AI 分析信封」（见 §4），`success` 字段保留但结构不同。

### 1.3 错误码

| HTTP | 含义 | 典型场景 |
| --- | --- | --- |
| 200 | 成功 | — |
| 400 | 参数错误 / 业务规则拒绝 | 必填缺失、金额或课时超界、退费超过可退上限、删除时存在外键引用（如「该学员已有报班记录，不能删除」） |
| 401 | 未登录 / Token 失效 / **凭证已被吊销** | 无 Token、Token 过期、误用 refreshToken 访问、**该账号已登出或已改密/改角色**（token_version 不匹配） |
| 403 | 无权限 | 教师访问非本班数据、非 admin 访问管理员接口 |
| 404 | 资源不存在 | 接口路径错误、记录不存在 |
| 429 | 请求过于频繁 | **登录失败次数超过阈值**（默认 15 分钟内 10 次失败） |
| 500 | 服务器内部错误 | 未捕获异常（服务端已统一兜底） |

> 注意：本项目**不使用业务错误码 `code` 字段**，一律以 HTTP 状态码 + `success` 布尔表达。

### 1.4 认证与 Token

| 项 | 值 |
| --- | --- |
| 登录接口 | `POST /api/auth/login` |
| 请求体 | `{ "username": "admin", "password": "admin123456", "type": "password" }` |
| accessToken 有效期 | 7 天 |
| refreshToken 有效期 | 30 天 |
| 刷新接口 | `POST /api/auth/refresh-token`（body: `{ "refreshToken": "..." }`，**需认证**，且校验凭证未被吊销） |
| 登出接口 | `POST /api/auth/logout`（**需认证**；递增该账号 `token_version`，立即吊销其全部已签发凭证） |
| Token 载荷 | `{ id, username, role, tv }`，`role ∈ { admin, teacher }`；`tv` = 签发时的 `users.token_version` |

**凭证吊销（v15 新增）**：鉴权时会将 Token 中的 `tv` 与 `users.token_version` 比对，不一致即返回 401。以下操作会递增 `token_version`，**立即让该账号已签发的 accessToken 与 refreshToken 全部失效**（需重新登录）：

- 调用 `POST /api/auth/logout`（登出）
- `PUT /api/users/:id/password`（重置密码，`users.js`）
- `PUT /api/users/:id` 且角色发生变化（改角色，避免旧 Token 保留旧权限）
- 删除该账号（用户不存在，鉴权直接拒绝）

**登录限速**：同一 IP 在 15 分钟窗口内登录**失败**超过 10 次（可用 `LOGIN_RATE_LIMIT_MAX` 调整）将返回 429。成功登录不计数，因此不会误伤正常员工。

**默认账号**：`admin / admin123456`（管理员）、`teacher / teacher123456`（教师）。
> ⚠️ 初始口令为公开信息，**部署后必须立即修改**。后端启动时会自检并打印安全告警（`[安全告警] 以下账号仍在使用初始默认口令`）。

**部署必配环境变量**：`JWT_SECRET` —— 缺失或长度不足 16 位时后端**拒绝启动**（不会回退到默认密钥）。模板见 `server/.env.example`，生成方式 `openssl rand -hex 32`。

### 1.5 角色与数据级权限

系统为**纯员工端 CRM**，仅 `admin` / `teacher` 两种角色；学员、家长**无账号、不登录**。

| 角色 | 数据范围 |
| --- | --- |
| `admin` | 全量数据 + 所有管理功能 |
| `teacher` | **仅授课相关**：`classes.head_teacher_id = 当前用户` 的班级 / 学员 / 考勤 / 请假 / 补课 / 调课申请 / 课表 / 考试与成绩 / 通知 / 学习报告与成长档案（**金额字段脱敏**）。**费用与销售数据一律不可见**——财务（订单/缴费/退费/统计）与招生线索的全部接口均为 `admin` 专属（2026-09-12 权限收紧） |

实现位置：`server/src/utils/scope.js`（`canManageClass` / `canManageStudent` / `studentScopeWhere` / `classScopeClause`）。

> **教师权限边界（2026-09-12 收紧）**：教师仅保留授课相关权限（课程安排、课表查询、学员名单、出勤记录、教学资料、成绩管理）。
> 四层同时生效：① 菜单——`/api/auth/async-routes` 不再向 teacher 下发财务管理与招生管理目录；② 接口——`/api/finance/**` 与 `/api/leads/**` 全部 `requireRole("admin")`，teacher 调用一律 403；③ 字段——`/api/reports/students/:id` 对 teacher 剔除订单摘要的 `amount`/`paid`，`/timeline` 剔除缴费/退费事件；④ 导出——`/api/analytics/**` 本就仅 admin，学员导出不包含费用字段。

### 1.6 分页约定

请求：`?page=1&pageSize=10`（默认 `page=1`、`pageSize=10`）
响应：`{ "success": true, "data": { "list": [...], "total": 100 } }`

### 1.7 收入口径说明（两个口径并存，勿混用）

系统内存在**两个口径不同、但中文名都含"收入/营收"**的指标，前端展示时必须使用区分性文案：

| 口径 | 指标名 | 公式 | 实现位置 | 语义 |
| --- | --- | --- | --- | --- |
| **收付实现制（现金）** | `revenue_total` / `revenue_income` | `SUM(payments.amount) − SUM(refunds.amount WHERE status='通过')` | `routes/analytics.js:69`、`:304-306` | 实际收到的钱 − 实际退出的钱 |
| **权责发生制（课时确认）** | `revenue_recognized` | `SUM(orders.amount × (total_hours − remain_hours) / total_hours) WHERE total_hours > 0` | `routes/finance.js:765` | 已消耗课时对应的、已确认的收入 |

**两者不相等是正常的**（预收学费尚未消耗部分不计入已确认收入），但**必须向使用者说明差异**，不可在同页面并列展示"营收"而不加注解。

> **退班订单的处理原则（2026-09-12 修正）**：`revenue_recognized` **不按订单状态过滤**。退班订单的已消耗课时是已经真实提供过的教学服务，对应收入应当保留；退费只退「剩余未消耗课时」对应的部分，而 `orders.remain_hours` 会**保留原值**作为退款核算依据。
> 历史实现为 `status IN ('在读','结业')`，会把退班订单整单收入抹除，导致已上课收入凭空消失且不可追溯（上线评估报告问题 **B3**，已修复）。

### 1.8 财务入参校验与课时流水约定（v15 加固）

| 规则 | 说明 |
| --- | --- |
| 金额范围 | 单笔金额须为数字且 ≤ `10,000,000`（1000 万元）；缴费 / 退费须 **> 0**，报班订单金额可 **≥ 0**（允许赠课）。超界返回 400 |
| 课时范围 | `total_hours` / `remain_hours` 须为 **非负整数** 且 ≤ `100,000`；超界或非整数返回 400 |
| 课时关系 | 任意时刻须满足 `remain_hours ≤ total_hours`，否则 400 |
| 退费上限 | 退费金额 ≤ `该订单已缴金额 − 已申请(待审批)/已通过退费合计`，防止超额退款 |
| 手工改课时必留流水 | `PUT /api/finance/orders/:id` 修改 `remain_hours` 时，会在**同一事务内**自动写入一条 `hour_consumptions` 记录（`type` 按增减取 `扣减`/`回补`，`hours` 为差额绝对值），保证 `orders.remain_hours` 与课时流水始终可对账 |

> 说明：`hour_consumptions.hours` 恒为**正数**，变动方向由 `type`（`扣减`/`回补`）表达。

---

## 2. 接口总览

| 模块 | 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- | --- |
| 认证 | POST | `/api/auth/login` | 公开 | 统一登录入口（`type=password`） |
| 认证 | GET | `/api/auth/info` | 登录 | 当前用户信息 |
| 认证 | GET | `/api/auth/async-routes` | 登录 | 动态菜单路由（按角色） |
| 认证 | POST | `/api/auth/refresh-token` | 公开 | 刷新 Token |
| 认证 | POST | `/api/auth/logout` | 登录 | 退出登录 |
| 认证 | POST | `/api/auth/sms-code` | 公开 | 短信验证码（占位 501） |
| 认证 | POST | `/api/auth/wechat` | 公开 | 微信登录（占位 501） |
| 员工账号 | GET | `/api/users` | admin | 员工列表（分页/角色筛选） |
| 员工账号 | POST | `/api/users` | admin | 创建员工 |
| 员工账号 | PUT | `/api/users/:id` | admin | 修改员工（姓名/角色/手机号） |
| 员工账号 | PUT | `/api/users/:id/password` | admin | 重置密码 |
| 员工账号 | DELETE | `/api/users/:id` | admin | 删除员工（不能删自己） |
| 班级 | GET | `/api/classes` | 登录 | 班级列表（分页搜索，教师仅本班） |
| 班级 | GET | `/api/classes/all` | 登录 | 全部班级（下拉用） |
| 班级 | GET | `/api/classes/:id/students` | 登录 | 班级名单 + 今日出勤概况 |
| 班级 | POST | `/api/classes` | admin/teacher | 新增班级（教师自动绑定自己为班主任） |
| 班级 | PUT | `/api/classes/:id` | admin/teacher | 修改班级（教师仅本班） |
| 班级 | DELETE | `/api/classes/:id` | admin/teacher | 删除班级（有学员则 400） |
| 学员 | GET | `/api/students` | 登录 | 学员列表（筛选分页，教师仅本班） |
| 学员 | GET | `/api/students/export` | 登录 | 学员全量导出（同列表筛选，不分页） |
| 学员 | POST | `/api/students` | admin/teacher | 新增学员 |
| 学员 | POST | `/api/students/import` | admin/teacher | 批量导入（前端解析 Excel 后提交） |
| 学员 | PUT | `/api/students/:id` | admin/teacher | 修改学员（仅本班） |
| 学员 | DELETE | `/api/students/:id` | admin/teacher | 删除学员（有业务记录则 400） |
| 课程 | GET | `/api/courses` | 登录 | 课程列表 |
| 课程 | GET | `/api/courses/all` | 登录 | 全部课程（下拉用） |
| 课程 | POST | `/api/courses` | admin | 新增课程 |
| 课程 | PUT | `/api/courses/:id` | admin | 修改课程 |
| 课程 | DELETE | `/api/courses/:id` | admin | 删除课程（有考勤则 400） |
| 考勤 | GET | `/api/attendance` | 登录 | 某课程某日全班名单（回显已登记状态） |
| 考勤 | POST | `/api/attendance/batch` | 登录 | **批量登记（事务）** — 联动课时包 + 缺勤通知 + 请假同步单 |
| 考勤 | GET | `/api/attendance/records` | 登录 | 考勤记录分页查询 |
| 考勤 | GET | `/api/attendance/statistics` | 登录 | 统计（`dimension=student\|class`） |
| 考勤 | GET | `/api/attendance/statistics/trend` | 登录 | 出勤趋势（`period=day\|week\|month`） |
| 考勤 | GET | `/api/attendance/statistics/monthly` | 登录 | 月度报表（班级 × 月份矩阵） |
| 考勤 | GET | `/api/attendance/warnings` | 登录 | 缺勤预警（低出勤率 + 连续缺勤） |
| 请假 | GET | `/api/leaves` | 登录 | 请假列表（教师仅本班） |
| 请假 | POST | `/api/leaves` | 登录 | 提交请假申请 |
| 请假 | PUT | `/api/leaves/:id/approve` | admin/teacher | 通过 / 驳回（通过后写考勤 + 回补课时 + 通知家长） |
| 课表 | GET | `/api/schedules` | 登录 | 课表查询（`class_id` / `day_of_week` 过滤） |
| 课表 | GET | `/api/schedules/all` | 登录 | 课表全量 |
| 课表 | POST | `/api/schedules` | admin/teacher | 新增课表（含冲突检测） |
| 课表 | POST | `/api/schedules/check-conflict` | 登录 | 保存前冲突预览（教师仅本班）。入参 `class_id/course_id/day_of_week/period/exclude_id`，返回 `class_conflict` 与 `teacher_warnings` |
| 课表 | PUT | `/api/schedules/:id` | admin/teacher | 修改课表条目 |
| 课表 | DELETE | `/api/schedules/:id` | admin/teacher | 删除课表条目 |
| 调课 | GET | `/api/schedule-adjustments` | 登录 | 调课申请列表（教师仅本班） |
| 调课 | POST | `/api/schedule-adjustments` | admin/teacher | 提交调课申请 |
| 调课 | PUT | `/api/schedule-adjustments/:id/approve` | admin | 审批通过 / 驳回（通过后课表自动同步） |
| 调课 | DELETE | `/api/schedule-adjustments/:id` | admin/teacher | 撤销/删除申请。非 admin 仅可撤销**自己提交的待审批**申请；admin 可删除任意状态记录（用于清理历史），**不回滚课表** |
| 补课 | GET | `/api/makeup-classes` | 登录 | 补课记录列表（教师仅本班） |
| 补课 | POST | `/api/makeup-classes` | admin/teacher | 登记补课 |
| 补课 | PUT | `/api/makeup-classes/:id/status` | admin/teacher | 标记完成（扣 1 课时）/ 恢复待安排（回补） |
| 补课 | DELETE | `/api/makeup-classes/:id` | admin/teacher | 删除补课记录 |
| 学期 | GET | `/api/terms` | 登录 | 学期列表 |
| 学期 | GET | `/api/terms/all` | 登录 | 学期下拉（全部） |
| 学期 | GET | `/api/terms/current` | 登录 | 当前学期 |
| 学期 | POST | `/api/terms` | admin | 新增学期 |
| 学期 | PUT | `/api/terms/:id` | admin | 修改学期 |
| 学期 | PUT | `/api/terms/:id/current` | admin | 设为当前学期 |
| 学期 | DELETE | `/api/terms/:id` | admin | 删除学期（当前学期不可删） |
| 看板 | GET | `/api/dashboard/overview` | 登录 | 首页统计 |
| 系统参数 | GET | `/api/settings` | 登录 | 读取全部系统参数 |
| 系统参数 | PUT | `/api/settings` | admin | 更新系统参数（整体覆盖） |
| 站点信息 | GET | `/api/site-info` | **免登录** | 公开站点信息（机构名/Logo/页脚）。**字段白名单 + 只返回非空项**（未登录访客看不到"有哪些配置项"）。空对象表示全未配置 |
| 站点信息 | GET | `/api/site-info/admin` | 登录 | 读取**全部 12 个** `site.*` 键（含默认值，设置页回填用） |
| 站点信息 | PUT | `/api/site-info` | admin | 保存站点信息（**只接受 `site.*` 白名单键**，越界键静默忽略，单值 ≤500 字） |
| 站点信息 | POST | `/api/site-info/upload?kind=logo\|favicon` | admin | 上传 Logo / 图标（**文件头魔数校验**，≤2MB，落盘 `server/data/assets/site/`，DB 只存路径，**自动清理同 kind 旧文件**） |
| 静态资源 | GET | `/assets/*` | **免登录** | 站点上传的图片；仅暴露 `data/assets/`，禁止目录穿越 |
| 公告 | GET | `/api/notices` | 登录 | 公告列表（分页 + 关键字） |
| 公告 | GET | `/api/notices/latest` | 登录 | 最新公告（看板用，最多 3 条） |
| 公告 | POST | `/api/notices` | admin | 新增公告 |
| 公告 | PUT | `/api/notices/:id` | admin | 修改公告 |
| 公告 | DELETE | `/api/notices/:id` | admin | 删除公告 |
| 备份 | GET | `/api/backups` | admin | 备份列表 |
| 备份 | POST | `/api/backups` | admin | 立即备份 |
| 备份 | POST | `/api/backups/:filename/restore` | admin | 恢复备份（服务自动重启） |
| 备份 | DELETE | `/api/backups/:filename` | admin | 删除备份 |
| 审计 | GET | `/api/audit-logs` | admin | 审计日志（分页 + 筛选） |
| 财务·订单 | GET | `/api/finance/orders` | admin | 报班订单列表（分页 + 多条件筛选） |
| 财务·订单 | GET | `/api/finance/orders/:id` | admin | 订单详情（含缴费明细与退费记录） |
| 财务·订单 | POST | `/api/finance/orders` | admin | 新增报班（含 `total_hours` 课时包） |
| 财务·订单 | PUT | `/api/finance/orders/:id` | admin | 修改订单 |
| 财务·订单 | PUT | `/api/finance/orders/:id/status` | admin | 变更状态（结业 / 退班） |
| 财务·订单 | DELETE | `/api/finance/orders/:id` | admin | 删除订单（**存在缴费/退费记录时返回 400，禁止删除**；仅课时流水允许级联清理） |
| 财务·缴费 | GET | `/api/finance/payments` | admin | 缴费记录列表 |
| 财务·缴费 | POST | `/api/finance/payments` | admin | 登记缴费 |
| 财务·缴费 | PUT | `/api/finance/payments/:id` | admin | 修改缴费记录 |
| 财务·缴费 | DELETE | `/api/finance/payments/:id` | admin | 删除缴费记录 |
| 财务·退费 | GET | `/api/finance/refunds` | admin | 退费记录列表 |
| 财务·退费 | POST | `/api/finance/refunds` | admin | 提交退费申请 |
| 财务·退费 | PUT | `/api/finance/refunds/:id/approve` | admin | 退费审批 |
| 财务·退费 | DELETE | `/api/finance/refunds/:id` | admin | 删除退费记录 |
| 财务·统计 | GET | `/api/finance/stats/revenue` | admin | 营收统计（`granularity=day\|month`） |
| 财务·统计 | GET | `/api/finance/stats/arrears` | admin | 欠费统计 |
| 财务·统计 | GET | `/api/finance/stats/low-hours` | admin | 低课时预警 |
| 财务·统计 | GET | `/api/finance/stats/consumption` | admin | 课消统计 |
| 财务·统计 | GET | `/api/finance/stats/business` | admin | 经营报表 |
| 招生 | GET | `/api/leads` | admin | 线索列表 |
| 招生 | POST | `/api/leads` | admin | 新增线索 |
| 招生 | PUT | `/api/leads/:id` | admin | 修改线索 |
| 招生 | PUT | `/api/leads/:id/follow` | admin | 追加跟进记录 |
| 招生 | PUT | `/api/leads/:id/status` | admin | 状态流转 |
| 招生 | PUT | `/api/leads/:id/convert` | admin | **一键转化**（事务：建档 + 报班） |
| 招生 | DELETE | `/api/leads/:id` | admin | 删除线索 |
| 招生 | GET | `/api/leads/stats/channels` | admin | 渠道统计 |
| 通知 | GET | `/api/notifications` | 登录 | 通知记录（教师仅本班学员） |
| 通知 | PUT | `/api/notifications/:id/read` | 登录 | 单条标记已读 |
| 通知 | PUT | `/api/notifications/read-all` | 登录 | 全部标记已读 |
| 待办 | GET | `/api/todos` | 登录 | 待办列表（`?scope=mine\|all`、`?status=`、`?priority=`、`?keyword=`、`?owner_id=`）。★ **teacher 传 `scope=all` 也会被收敛为只看自己**；仅 `admin` 可看全部 |
| 待办 | POST | `/api/todos` | 登录 | 新建待办。`owner_id` 默认自己；★ **仅 `admin` 可指派给别人**（teacher 传他人 id → 403） |
| 待办 | PUT | `/api/todos/:id` | 本人/admin | 修改（含标记完成 `{status:'已完成'}`；改 `owner_id` 仅 admin）。★ 非本人且非 admin → **403** |
| 待办 | DELETE | `/api/todos/:id` | 本人/admin | 删除。★ 非本人且非 admin → **403** |
| 待办 | POST | `/api/todos/generate` | **仅 admin** | 手动触发一次自动生成（`?force=1` 跳过 60s 节流）。★ 自动生成由 **4 类事件**按**归属矩阵**投递：`tuition_low`/`lead_follow` → **仅 admin**；`absent_streak`/`eval_missing` → **班主任 + admin**。幂等（一条来源 = 一条待办） |
| 考试 | GET | `/api/exams` | 登录 | 考试列表（含成绩录入进度，教师仅本班） |
| 考试 | POST | `/api/exams` | 登录 | 新增考试 |
| 考试 | PUT | `/api/exams/:id` | 登录 | 修改考试 |
| 考试 | DELETE | `/api/exams/:id` | 登录 | 删除考试（级联删成绩） |
| 考试 | GET | `/api/exams/:id/scores` | 登录 | 成绩录入表单（考试信息 + 在读学员 + 已有成绩） |
| 考试 | PUT | `/api/exams/:id/scores` | 登录 | **批量录入成绩**（事务 upsert；新插入时推送成绩通知） |
| 考试 | GET | `/api/exams/:id/scorecard` | 登录 | 成绩单（排名 + 等级 + 平均分） |
| 报告 | GET | `/api/reports/students/:id` | admin/teacher | 学习报告（**teacher 订单摘要剔除 amount/paid**） |
| 报告 | GET | `/api/reports/students/:id/timeline` | admin/teacher | 成长档案时间线（**teacher 剔除缴费/退费事件**） |
| 分析 | GET | `/api/analytics/metrics` | admin | 指标定义字典（AI 解析用） |
| 分析 | GET | `/api/analytics/overview` | admin | 全局经营概览 |
| 分析 | GET | `/api/analytics/attendance/export` | admin | 考勤数据批量导出 |
| 分析 | GET | `/api/analytics/finance/export` | admin | 财务数据批量导出 |
| 分析 | GET | `/api/analytics/leads/export` | admin | 招生线索批量导出 |
| 分析 | GET | `/api/analytics/scores/export` | admin | 成绩数据批量导出 |
| AI 工作台 | POST | `/api/ai/sso/ticket` | 登录 | 签发 60 秒一次性免登票据（跳转 AI 教学工作台） |
| AI 工作台 | POST | `/api/ai/sso/verify` | 公开 | 校验票据换取工作台会话 + **只读凭证**（票据一次性） |
| AI 工作台 | GET | `/api/ai/llm-status` | 登录 | 服务端模型是否已配置（工作台据此决定是否展示该选项） |
| AI 工作台 | POST | `/api/ai/generate` | 登录 | **服务端**调用大模型生成文案（Key 不下发前端；未配置返回 503） |
| AI 只读网关 | GET | `/api/agent/context` | 登录 | 教学上下文：身份 / 可见班级 / 数据能力位 |
| AI 只读网关 | GET | `/api/agent/classes/:id/overview` | 登录 | 班级概览：学员 + 考勤/成绩/课时聚合（**不含金额**） |
| 使用反馈 | POST | `/api/feedback` | 登录 | 提交使用中遇到的问题与改进建议 |
| 使用反馈 | GET | `/api/feedback/mine` | 登录 | 我的反馈（含管理员回复） |
| 使用反馈 | GET | `/api/feedback` | admin | 全部反馈（分页 + 状态筛选，待处理优先） |
| 使用反馈 | GET | `/api/feedback/summary` | admin | 反馈统计（各状态计数） |
| 使用反馈 | PUT | `/api/feedback/:id` | admin | 处理反馈（改状态 / 写回复） |
| 使用反馈 | GET | `/api/feedback/options` | 登录 | 可选值字典（分类 / 状态） |
| 成长时间轴 | GET | `/api/growth/eval-form` | 登录+本班 | 课堂评价预填（名单 + 待评知识点 + 已评情况） |
| 成长时间轴 | POST | `/api/growth/class-eval` | 登录+本班 | 提交课堂评价（3 维 1–5 分，追加时间轴事件） |
| 成长时间轴 | POST | `/api/growth/kp-assessment` | 登录+本班 | 批量知识点评定（三档，支持个别覆盖） |
| 成长时间轴 | GET | `/api/growth/students/:id/timeline` | 登录+本班学员 | 单学员成长时间轴（三表 UNION + 新事件，已去重） |
| 成长时间轴 | GET | `/api/growth/students/:id/growth` | 登录+本班学员 | 单学员成长画像（起点 vs 现在 + 里程碑） |
| 成长时间轴 | GET | `/api/growth/classes/:id/growth` | 登录+本班 | 整班成长概览（课堂曲线 + 知识点掌握度） |
| 成长时间轴 | GET | `/api/growth/knowledge-points` | 登录 | 知识点列表（可按课程筛选） |
| 成长时间轴 | GET | `/api/growth/thresholds` | 登录 | 读成长阈值（8 条） |
| 成长时间轴 | PUT | `/api/growth/thresholds` | admin | 改成长阈值（立即生效，不重建镜像） |
| 健康 | GET | `/api/health` | 公开 | 容器健康检查 |

---

## 3. P0 模块接口详解

### POST /api/attendance/batch

**业务说明**：批量登记考勤（签到核心接口）。提交后自动联动**课时包扣减**、**缺勤家长通知**、**考勤↔请假同步单**。

**权限**：admin / teacher（teacher 仅限本班学员，逐条校验，越权返回 403）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| date | string | 是 | 日期 `YYYY-MM-DD` |
| course_id | number | 是 | 课程 ID |
| records | array | 是 | 考勤记录数组，不允许为空 |
| records[].student_id | number | 是 | 学员 ID |
| records[].status | string | 是 | `正常` / `迟到` / `早退` / `缺勤` / `请假` |
| records[].remark | string | 否 | 备注 |

> 说明：班级由学员档案（`students.class_id`）决定，**请求体不需要传 `class_id`**。

**请求示例**：

```json
{
  "date": "2026-09-11",
  "course_id": 1,
  "records": [
    { "student_id": 1, "status": "正常" },
    { "student_id": 2, "status": "缺勤", "remark": "家长未请假" }
  ]
}
```

**响应示例**：

```json
{ "success": true, "data": { "count": 2 } }
```

**业务联动**（事务内执行，任一失败整体回滚）：

- 状态为 `正常` / `迟到` / `早退` → 匹配「在读 + 同课程 + `total_hours > 0` 且 `remain_hours > 0`」的订单**扣减 1 课时**，并写入 `hour_consumptions`（`type='扣减'`）。扣减优先选择剩余课时最多的订单。
- 状态为 `缺勤` / `请假` → **不扣课时**。
- 状态由非扣减态改为扣减态（或反向）→ 按**新旧状态差异**自动扣减 / 回补，并各写一条流水（回补受 `MIN(total_hours, ...)` 上限保护）。
- 状态变为 `缺勤` → 生成家长缺勤通知（`notifications.type='考勤缺勤'`，`parent_name` 为家长姓名快照）；幂等：同日同学员已有则跳过。
- 状态由 `缺勤` 改为其他 → **撤销当日缺勤通知**。
- 状态变为 `请假` → 生成待审批请假同步单（`leaves.source='考勤同步'`）；幂等：覆盖该日期已有任意来源的待审批 / 已通过单则不重复生成。
- 状态由 `请假` 改为其他 → 撤销当日同步单（待审批 / 已通过一并删除）并撤销「请假审批通过」通知。
- 保存语义为 `ON CONFLICT(student_id, course_id, date) DO UPDATE`（**重复提交覆盖**）。

**错误**：

| HTTP | 场景 |
| --- | --- |
| 400 | `date` / `course_id` / `records` 缺失或 `records` 为空；状态值非法 |
| 403 | 包含无权操作的学员记录 |

---

### PUT /api/exams/:id/scores

**业务说明**：批量录入考试成绩（事务 upsert）。**仅新插入**成绩时向家长推送「成绩发布」通知。

**权限**：admin / teacher（teacher 仅本班考试）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| scores | array | 是 | 成绩数组 |
| scores[].student_id | number | 是 | 学员 ID |
| scores[].score | number | 是 | 分数（≥ 0） |
| scores[].remark | string | 否 | 备注 |

**请求示例**：

```json
{ "scores": [ { "student_id": 1, "score": 92 }, { "student_id": 2, "score": 78 } ] }
```

**业务联动**：

- 冲突键 `UNIQUE(exam_id, student_id)` → **一考一成绩，重复录入覆盖**。
- 仅**新插入**成绩时生成 `notifications.type='成绩发布'` 通知（含分数与等级相关文案，`parent_name` 快照）；**修改已有成绩不重复生成**（幂等）。
- 成绩单等级口径：得分率 ≥90% 优 / ≥80% 良 / ≥70% 中 / ≥60% 及格 / 否则不及格。

**相关接口**：

- `GET /api/exams/:id/scores` → 成绩录入表单（考试信息 + 该班在读学员 + 已有成绩）
- `GET /api/exams/:id/scorecard` → 成绩单（排名 + 等级 + 平均分）

---

### PUT /api/leads/:id/convert

**业务说明**：招生线索**一键转化**。在**单个事务**内自动创建学员档案 + 报班订单，并把线索标记为「已转化」。

**权限**：admin / teacher（teacher 仅限自己创建的线索）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| class_id | number | 是 | 转入班级 ID（须有权限管理该班级） |
| course_id | number | 否 | 报班课程 ID（缺省取线索的 `intent_course_id`） |
| amount | number | 否 | 订单金额，默认 0 |
| remark | string | 否 | 订单备注，默认 `线索转化建档` |

> ⚠️ **实现与旧版文档不符，以上表为准**（`routes/leads.js:220-320`）。后端**只读取上述 4 个字段**，以下字段**不接受、传入即被忽略**：`student_no`、`gender`、`parent_name`、`parent_phone`、`total_hours`。
>
> **业务语义已确认（2026-09-12）：本接口只做「建档」，不完成报班收费。**
>
> 转化生成的 `orders` 记录 **`total_hours` 为 0**，而考勤扣减（`attendance.js:81`）与收入确认（`finance.js:765`）均要求 `total_hours > 0`，因此：
>
> - **转化后必须到「财务管理 → 报班管理」补录课时包与缴费**，或直接调用 `POST /api/finance/orders` 建一个带 `total_hours` 的正式订单；
> - 未补录前，该学员的考勤**不会扣减课时**（不会写 `hour_consumptions`），也不会产生已确认收入 —— 这是预期行为，不是缺陷；
> - 前端转化弹窗已加提示文案，员工按提示操作即可。
>
> 详见 `../archive/上线评估报告-2026-09-12.md` 问题 **B2**（已按「仅建档」闭环）。

**后端自动填充的字段**：`student_no`（当年年份 + 3 位递增序号）、`gender`（固定 `'男'`）、`parent_name`（`{线索姓名}家长`）、`parent_phone`（取线索电话）、`enroll_date`（当天）、`source_channel`（取线索来源）。

**业务联动**：

- 事务内 `INSERT students` + `INSERT orders`，并把 `leads.status` 置为 `已转化`、`leads.converted_student_id` 指向新学员。
- 原子性：任一步失败整体回滚，**不会**出现「建了学员没有订单」或反之。
- 前置校验：线索已转化/已流失、已生成过学员档案、或线索手机号已存在学员档案时，均返回 400。
- 线索删除（admin）时已转化线索**禁止删除**（`leads.js:335-343`），避免转化率统计失真。
- 响应：`{ student_id, student_no }`。

---

### GET /api/attendance

**业务说明**：取某课程某日全班名单，用于签到页渲染（**回显已登记状态**）。

**权限**：登录（teacher 仅本班，否则 403）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| date | string | 是 | 日期 `YYYY-MM-DD` |
| class_id | number | 是 | 班级 ID |
| course_id | number | 是 | 课程 ID |

**响应示例**：

```json
{
  "success": true,
  "data": [
    { "student_id": 1, "student_no": "S001", "name": "张三", "gender": "男", "status": "正常", "remark": "", "attendance_id": 12 },
    { "student_id": 2, "student_no": "S002", "name": "李四", "gender": "女", "status": null, "remark": null, "attendance_id": null }
  ]
}
```

> 仅返回 `students.status = '在读'` 的学员；未登记的 `status` 为 `null`。

---

### GET /api/students

**业务说明**：学员列表（筛选 + 分页）。

**权限**：登录（teacher 仅本班）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页条数，默认 10 |
| class_id | number | 否 | 按班级筛选 |
| name | string | 否 | 姓名（精确） |
| student_no | string | 否 | 学号（精确） |
| keyword | string | 否 | 姓名或学号模糊搜索 |

**相关接口**：

- `GET /api/students/export` → 与列表**同筛选条件**、不分页，返回全量（供 Excel 导出）
- `POST /api/students/import` → 前端解析 Excel 后提交；**逐条校验并返回失败明细**

### POST /api/students/import

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| records | array | 是 | 待导入行数组（前端解析 Excel 得到）。**非空数组，否则 400** |
| records[].student_no | string | 是 | 学号（唯一，重复则该行失败） |
| records[].name | string | 是 | 姓名 |
| records[].class_id | number | 是 | 班级 ID（教师仅可导入自己管理的班级） |
| records[].gender | string | 否 | `男` / `女` |
| records[].phone | string | 否 | 学员手机号 |
| records[].email | string | 否 | 邮箱 |
| records[].parent_name | string | 否 | 家长姓名 |
| records[].parent_phone | string | 否 | 家长电话 |
| records[].source_channel | string | 否 | 来源渠道 |

**响应示例**：

```json
{ "success": true, "data": { "total": 4, "successCount": 3, "failCount": 1, "fails": [ { "row": 4, "student_no": "S002", "message": "学号已存在" } ] } }
```

> ⚠️ **实现与旧版文档不符，以上表为准**（`routes/students.js:164-252`）。字段名由 `list` 更正为 **`records`**；响应字段由 `success_count/fail_count/failures` 更正为 **`successCount/failCount/fails`**，并新增 `total`。
> 另：本接口**无行数上限**，且**每行一个独立事务**（非整体事务），部分成功不会回滚——前端需按行展示失败明细引导修正后重导。详见上线评估报告问题 **H13**。

---

## 4. AI 分析接口（`/api/analytics`）

> 为「AI 经营分析 / 批量数据导出」预留的统一出口。**全部端点需 JWT 认证且仅 `admin` 可访问**；全部为只读查询。

### 4.1 统一响应信封

```json
{
  "success": true,
  "data": {
    "metrics": {},
    "records": [],
    "meta": {
      "generated_at": "2026-09-11T10:00:00.000Z",
      "period": { "start": null, "end": null },
      "total_count": 0,
      "data_version": "v15",
      "dataset": "attendance",
      "dataset_label": "考勤明细"
    }
  },
  "metric_definitions": {
    "attendance_rate": {
      "name": "出勤率",
      "formula": "实到人数 / 应到人数",
      "note": "实到 = 状态为 正常/迟到/早退；请假不计入分母",
      "source_table": "attendances",
      "unit": "百分比"
    }
  }
}
```

- `meta.data_version` 实时取自 `PRAGMA user_version`，与 `server/database.md` 版本历史对应。
- `meta.period` 回显请求的 `start` / `end`（未传为 `null`）。
- 通用查询参数：`start` / `end`（`YYYY-MM-DD`，按各数据集的时间字段过滤）。

### 4.2 GET /api/analytics/metrics

返回**指标定义字典**（12 项），供下游 AI 自动解释口径。`records` 固定为空数组。

### 4.3 GET /api/analytics/overview

返回全局经营概览。`metrics` 含 21 项指标，`meta` 额外返回：

| 字段 | 说明 |
| --- | --- |
| `meta.revenue_trend` | 近 12 个月营收走势 `[{ month, amount, count }]` |
| `meta.channel_stats` | 各来源渠道线索数与转化率 `[{ source, total, converted, conversion_rate }]` |

**metrics 字段**：

| 指标 | 单位 | 口径 |
| --- | --- | --- |
| `student_total` | 人 | 学员总数 |
| `student_active` | 人 | 在读学员数（`orders.status='在读'` 去重） |
| `active_rate` | % | 在读率 |
| `class_total` | 个 | 班级总数 |
| `attendance_total` | 次 | 考勤记录数 |
| `attendance_present` | 次 | 实到（正常/迟到/早退） |
| `attendance_absent` | 次 | 缺勤 |
| `attendance_leave` | 次 | 请假 |
| `attendance_rate` | % | 出勤率 = 实到 / (总数 − 请假) |
| `absent_rate` | % | 缺勤率 |
| `revenue_income` | 元 | 实收合计 |
| `revenue_refunded` | 元 | 已通过退费合计 |
| `revenue_total` | 元 | 实收 − 退费 |
| `lead_total` / `lead_converted` / `lead_lost` | 条 | 线索总数 / 转化数 / 流失数 |
| `lead_conversion_rate` | % | 线索转化率 |
| `hours_consumed` | 课时 | 净消耗（扣减 − 回补） |
| `exam_score_total` | 条 | 成绩条数 |
| `exam_average` | 分 | 平均分 |
| `score_excellent_rate` | % | 优秀率（得分率 ≥ 90%） |

### 4.4 导出端点

`GET /api/analytics/{attendance|finance|leads|scores}/export`

| 数据集 | 说明 | 主要列 |
| --- | --- | --- |
| `attendance` | 考勤明细 | `id, date, student_no, student_name, class_name, course_name, status, remark, created_at, updated_at` |
| `finance` | 财务流水（缴费为正、退费为负） | `time, type, student_no, student_name, class_name, amount, method, remark` |
| `leads` | 招生线索 | `id, name, phone, intent_course, source, status, follow_user, converted_student_no, follow_count, remark, created_at, updated_at` |
| `scores` | 考试成绩 | `exam_name, exam_date, exam_type, full_score, class_name, course_name, student_no, student_name, score, level, remark` |

**格式参数**：`?format=json`（默认，返回统一信封）｜`?format=csv`（带 UTF-8 BOM，Excel 直接打开不乱码；响应头 `Content-Disposition: attachment`）

**响应示例（`format=csv`）**：

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="analytics-attendance-2026-09-11.csv"
```

**错误**：

| HTTP | 场景 |
| --- | --- |
| 401 | 未登录 / Token 失效 |
| 403 | 非 admin（含 teacher） |
| 404 | 未知数据集，`data.supported` 返回可用数据集列表 |

---

## 5. AI 教学工作台接入（`/api/ai`）

### 5.1 背景与链路

AI 教学工作台是**独立部署**的教师端应用（仓库内 `ai-workbench/`），登录态由教务系统统一提供，教师不需要二次登录：

```
教务系统已登录
  └─ 顶栏「AI 助手」按钮 → POST /api/ai/sso/ticket（带 Bearer Token）
       └─ 浏览器打开 <AI_WORKBENCH_URL>/#/sso?ticket=<一次性票据>
            └─ 工作台 POST /api/ai/sso/verify → 换取工作台会话
```

> 该模块**只做身份交接**，不读写任何教务业务数据；工作台侧取数走独立的只读适配层（规划中，见 `../archive/AI教师助手调研分析报告-2026-09-14.md`）。

### 5.2 POST /api/ai/sso/ticket

签发一次性免登票据。

| 项 | 值 |
| --- | --- |
| 权限 | 登录（admin / teacher） |
| 请求体 | `{ "origin": "http://192.168.1.20:8080" }`（可选，但**新前端一律传**） |
| 响应 | `{ "success": true, "data": { "ticket": "...", "url": "...", "expiresIn": 60 } }` |

```json
{
  "success": true,
  "data": {
    "ticket": "eyJhbGciOiJIUzI1NiIs...",
    "url": "http://192.168.1.20:8080/ai/#/sso?ticket=eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 60
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `ticket` | 一次性票据（JWT，HS256，复用 `JWT_SECRET`） |
| `url` | 工作台跳转地址，**票据置于 URL hash 片段**（浏览器不会把它发给服务器） |
| `expiresIn` | 有效期（秒），固定 60 |

**请求体 `origin` 的作用（解决"点击 AI 工具台进不去"）**：

前端传 `window.location.origin`，后端据此决定跳转地址：

| `AI_WORKBENCH_URL` 配置 | 行为 |
| --- | --- |
| 回环地址（`localhost` / `127.0.0.1`，**同源部署默认**） | 返回**访问者 origin + `AI_WORKBENCH_BASE_PATH`**，即 `http://访问者地址/ai`。因此 IP / 域名 / 80 端口 / HTTPS 全部自适应 |
| 非回环地址（如 `http://10.0.0.5:8082`） | 尊重配置原样返回（分离部署）；若配置自带路径则不再叠加 base path |

> 兼容：仍接受旧字段 `host`，但只替换主机名、**端口沿用配置值**，同源部署下会跳错，请勿再使用。

**安全**：`origin` 只接受 `http:` / `https:` 协议 + 纯主机名或 IPv4，拒绝 userinfo 混淆、`javascript:` / `file:` 协议、路径穿越、查询串等，防止被当作开放重定向诱骗跳往第三方站点。

**票据载荷**：`{ id, username, role, tv, type: "ai_sso", jti }` —— 不含姓名、手机号、金额等任何业务字段。

**错误**：`401` 未登录 / Token 失效。

### 5.3 POST /api/ai/sso/verify

校验票据并换取工作台会话。

| 项 | 值 |
| --- | --- |
| 权限 | **公开**（票据本身即凭证） |
| 请求体 | `{ "ticket": "eyJhbGciOiJIUzI1NiIs..." }` |
| 响应 | `{ "success": true, "data": { "id": 1, "name": "管理员", "role": "admin", "loginAt": "...", "scope": "all", "agentToken": "eyJ..." } }` |

| 字段 | 说明 |
| --- | --- |
| `id` / `name` / `role` | 工作台用于展示与判断可生成哪种版式报告 |
| `scope` | `all`（admin）/ `own`（teacher），工作台据此限制数据范围 |
| `agentToken` | **工作台只读凭证**（`type = ai_agent`，有效期 12 小时）：仅可访问 `/api/agent/*` 与 `/api/ai/*`，调用其他接口一律 403（见 §六） |
| `loginAt` | 本次交接时间 |

**错误**：

| HTTP | 场景 |
| --- | --- |
| 400 | 缺少 `ticket` 或类型不是字符串 |
| 401 | 票据无效 / 已过期（>60 秒）/ 已被使用（重放）/ 类型不符 / `token_version` 不匹配（已登出或改密改角色） |

### 5.4 安全约束

| 约束 | 实现 |
| --- | --- |
| 一次性 | 票据含 `jti`，校验通过即记入已用集合，重放返回 401 |
| 短时效 | 60 秒 |
| 可吊销 | 票据携带 `tv`，与 `users.token_version` 比对；登出 / 改密 / 改角色后票据立即失效（与 §1.4 一致） |
| 不落日志 | `ticket` 位于 URL hash 片段，不随 HTTP 请求发送，不会进入 nginx / 应用访问日志 |
| 最小载荷 | 票据只含身份与吊销所需字段，不含姓名、手机号、金额 |
| 不含写权限 | 票据仅证明「该用户此刻已在教务系统登录」，不能用于调用教务系统任何写接口 |

> **部署注意**：已使用票据记录在**进程内存**中，多实例部署需改用数据库或 Redis 存储。

### 5.5 相关配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_WORKBENCH_URL` | 本地开发 `http://127.0.0.1:5300`；**同源部署（推荐）保持回环地址 `http://localhost`** | 工作台入口地址，仅用于拼装跳转 URL。配成**回环地址**时后端会替换为访问者 origin（见 §5.2），因此 IP / 域名 / 端口 / HTTPS 全自适应。仅分离部署时显式配成浏览器可达地址 |
| `AI_WORKBENCH_BASE_PATH` | 空 | 同源部署且工作台挂在子路径时必填（统一入口为 `/ai`）。空串表示工作台在域名根路径 |
| `CORS_ORIGINS` | 默认白名单已含 `http://127.0.0.1:5300` | **统一入口部署无需配置**：请求同源发出不触发 CORS。只有「本地 `serve.mjs` 预览 + 浏览器直连 :3000」这种跨域形态才需要把预览地址加入白名单 |

### 5.6 GET /api/ai/llm-status

| 项 | 值 |
| --- | --- |
| 权限 | 登录 |
| 响应 | `{ success, data: { configured: boolean, model: string \| null } }` |

只返回「是否已配置」与**模型名**，**绝不返回 Key**。工作台据此决定是否展示「服务端模型」选项。

### 5.7 POST /api/ai/generate（服务端模型生成）

| 项 | 值 |
| --- | --- |
| 权限 | 登录（admin / teacher），亦接受只读凭证 `ai_agent` |
| 请求体 | `{ "scene": "lesson_plan", "payload": { … }, "extra": "教师补充说明（可选）" }` |

`scene` 白名单：`course_design` / `lesson_plan` / `teaching_flow` / `homework_design` / `grading_feedback` / `student_insight` / `class_diagnosis` / `parent_feedback` / `report_narrative`

**安全设计（本节重点）**

| 约束 | 实现 |
| --- | --- |
| **Key 不下发前端** | Key 只存服务端（环境变量 `LLM_API_KEY` 或配置中心 `ai_settings`），前端永远拿不到。★ 工作台**已彻底移除**早期「浏览器直连 Dify 工作流」的旁路（该实现把 apiKey 存 localStorage）；工作台设置页只保留「服务端模型 / 规则引擎」两个选项，**不提供任何密钥输入入口**。若将来要接入 Dify，必须由**服务端**代持其 Key 并转发 |
| **服务端二次脱敏** | 载荷经 `utils/redact.js` 硬编码白名单过滤后才出网（姓名 / 电话 / 金额 / 含金额特征的文本一律剔除）。**不信任前端** —— 工作台是独立部署的静态应用，任何人可改其代码后直接调本接口 |
| 手机号 / 证件号兜底 | 自由文本中的 11 位手机号与 18 位证件号由 `scrubText()` 替换 |
| 数字不出本地逻辑 | 提示词硬约束「只能使用给定数字，禁止编造」；全部数字由本地指标引擎算出 |
| 未配置即降级 | `LLM_API_KEY` 为空返回 503，工作台自动回退规则引擎并标注原因，不阻塞教学流程 |
| 用量集中可审计 | 每次调用写入 `ai_usage` 表（`username` / `scene` / `model` / `tokens_in` / `tokens_out` / `cost`）。走服务端通道是用量可见的**前提**，浏览器直连会让配置中心看不到消耗 |

**响应**

```json
{
  "success": true,
  "data": {
    "scene": "lesson_plan",
    "sceneLabel": "备课方案",
    "text": "【本课定位】…",
    "model": "deepseek-flash",
    "usage": { "prompt_tokens": 517, "completion_tokens": 3241, "reasoning_tokens": 1980 },
    "redactedByServer": ["payload.studentName"],
    "generatedAt": "2026-09-14T08:12:33.101Z"
  }
}
```

**错误**

| HTTP | 场景 |
| --- | --- |
| 400 | `scene` 不在白名单 / 缺少 `payload` |
| 401 | 未登录 |
| 502 | 模型超时（`LLM_TIMEOUT`）/ HTTP 异常（`LLM_HTTP_ERROR`）/ 返回为空（`LLM_EMPTY`） |
| 503 | 服务端未配置模型（`LLM_NOT_CONFIGURED`）—— 工作台应回退规则引擎 |

**相关环境变量**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LLM_API_KEY`（或 `DEEPSEEK_API_KEY`） | 空 | 为空时模型能力整体不可用，不影响其他功能 |
| `LLM_BASE_URL` | `https://api.deepseek.com` | 任意 OpenAI 兼容端点 |
| `LLM_MODEL` | `deepseek-flash` | 实测 `GET /models` 返回的可用模型为 `deepseek-flash` / `deepseek-v4-pro`（旧别名 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用；DeepSeek 对未知模型名仍返回 200 而非报错，容易漏配）。**两者均为推理型**：响应同时含 `reasoning_content`，思维链会**先**占用输出额度，故默认已把 `LLM_REASONING_EFFORT` 设为 `none` 关掉推理；若改回 `medium`/`high`，必须同步调大 `LLM_MAX_TOKENS`，否则思维链吃满额度会导致正文为空（`finish_reason=length`） |
| `LLM_MAX_TOKENS` | `8192` | 单次输出额度上限。关闭推理（`REASONING_EFFORT=none`）时实测生成一份备课方案约 1900 输出 token，`8192` 余量充足；开启推理后思维链会数倍占用，需相应上调 |
| `LLM_REASONING_EFFORT` | `none` | 思维链强度。**`none` 完全关闭推理**（实测输出 token 直降约 90%、耗时减半，文案类任务质量无可见下降）；可改 `minimal` / `low` / `medium` / `high` |
| `LLM_TIMEOUT_MS` | `60000` | 单次调用超时 |

### 5.8 AI 配置中心（仅管理员）

配置存数据库（v17 `ai_settings`），**优先级高于环境变量，改完立即生效，无需重建容器**。
前端页面 `http://<教务系统>/#/ai-admin` **不出现在任何菜单里**，只能凭地址进入。

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/ai/admin/config` | admin | 读取全部配置项；敏感值只返回掩码 `__masked__sk-****3f2a`，并标注当前 `source` 是 `db` 还是 `env` |
| `PUT /api/ai/admin/config` | admin | 保存。空串 = 清除该键（回退环境变量）；掩码原样回传 = 不修改；**与当前生效值相同的项不落库**（防止一次保存把全部字段钉死、`.env` 从此失效）；未知键忽略 |
| `GET /api/ai/admin/balance` | admin | 查询模型账户余额。**Key 不出服务端**，只回传余额数字 |
| `GET /api/ai/admin/usage` | admin | 本月用量：次数、输入/输出 token、估算成本、按场景分布 |

教师访问上述任一接口均返回 **403**。

### 5.9 免登地址的「跟随访问者」机制

`POST /api/ai/sso/ticket` 接受可选请求体 `{ origin }`（前端传 `window.location.origin`，含协议+主机+端口）：

- `AI_WORKBENCH_URL` 配的是**非回环地址**（如 `http://192.168.1.20:8082`）→ 原样使用配置；
- 配置仍是 `localhost` / `127.0.0.1` → **返回访问者 origin + `AI_WORKBENCH_BASE_PATH`**。

> 为什么需要：2026-09-16 校区部署实测——`localhost` 指的是**打开浏览器的那台电脑**，
> 老师用自己的电脑访问校区机器时会被跳到"自己电脑的 8082"而打不开，或回落到演示身份。
>
> ★ 2026-09-20 补充修复（同源部署下端口与协议也必须跟随）：
> 早期实现只替换 hostname 而沿用配置里的 `:8082`，导致同源部署（一个 nginx 同时托管两端）时：
> · 用户从 `http://域名`（80 端口）访问 → 跳 `http://域名:8082` ❌
> · 用户从 `https://域名` 访问 → 跳 `http://域名:8082` ❌（协议降级 + 错端口）
> 现改为返回**访问者完整 origin**，并补上工作台子路径（`/ai`），
> 于是 `http://域名/ai/#/sso?...` 在 IP / 域名 / 80 / 443 下全部正确。
>
> 安全：`origin` 只接受 `http:` / `https:` 协议 + 合法主机名/IPv4（正则白名单），
> 含 `/`、`@`、查询串、`javascript:` / `file:` 协议等一律拒绝并回退到配置值，
> 防止本接口被当作开放重定向（open redirect）使用。

---

## 6. AI 只读数据网关（`/api/agent`）

### 6.1 定位与硬约束

教学 AI 工作台（独立部署的 `ai-workbench/`）取数**只走这里**。设计依据：调研报告方案 C —— 教务业务数据留在原库，由原系统只读提供。

| # | 约束 |
| --- | --- |
| 1 | 全部为**只读 `GET`**，没有任何写接口 |
| 2 | 复用既有鉴权与数据范围（`utils/scope.js`）：admin 可取全部班级，**teacher 仅能取自己带的班**（非本班返回 403） |
| 3 | **不返回金额**（`orders.amount` / `payments` / `refunds`）、不返回家长姓名与电话；学员只保留编号与姓名（教师本来就可见） |

> 该网关只服务教学场景；财务、招生线索、经营分析等接口**不对工作台凭证开放**（见 §6.4）。

### 6.2 GET /api/agent/context

| 项 | 值 |
| --- | --- |
| 权限 | 登录（admin / teacher），亦接受只读凭证 `ai_agent` |
| 请求体 | 无 |

```json
{
  "success": true,
  "data": {
    "user": { "id": 2, "name": "王老师", "role": "teacher" },
    "classes": [{ "id": 1, "name": "初二数学强化班 A 班", "grade": "八年级", "student_count": 24 }],
    "capabilities": {
      "students": true, "attendance": true, "scores": false, "hours": true,
      "evaluations": false, "knowledge": false, "questions": false
    },
    "data_version": "v16"
  }
}
```

**`capabilities` 的用途**：如实告知工作台「真实库里当前已有哪类数据」，避免把「没有数据」渲染成「0 分」。

| 字段 | 判定方式 |
| --- | --- |
| `students` / `attendance` / `scores` / `hours` | 对应表行数是否 > 0 |
| `evaluations` / `knowledge` / `questions` | 当前库中**尚无对应表**（`class_evaluations` / `knowledge_points` / `questions`），恒为 `false`；工作台据此标注「待建设」并继续展示演示内容 |

`classes` 按当前用户数据范围过滤：teacher 只会看到 `classes.head_teacher_id = 自己` 的班级。

### 6.3 GET /api/agent/classes/:id/overview

| 项 | 值 |
| --- | --- |
| 权限 | 登录；admin 可访问全部班级，teacher 仅本班 |
| 响应 | `{ success, data: { class, summary, students[], capabilities, data_version } }` |

```json
{
  "success": true,
  "data": {
    "class": { "id": 1, "name": "初二数学强化班 A 班", "grade": "八年级" },
    "summary": {
      "student_count": 24, "attendance_sessions": 576, "absent_total": 9,
      "score_avg": 82.3, "excellent_rate": 25.0, "scored_students": 24
    },
    "students": [
      {
        "id": 301, "no": "2501", "name": "陈嘉禾", "gender": "男", "status": "在读",
        "enroll_date": "2026-03-02",
        "attendance": { "total": 24, "normal": 23, "late": 1, "early": 0, "absent": 0, "leave": 0, "rate": 100 },
        "exams": [{ "name": "全等三角形单元小测（一）", "date": "2026-09-04", "full": 100, "score": 88, "rate": 88 }],
        "hours": { "total": 48, "remain": 29 },
        "avg_rate": 88, "trend": 5
      }
    ],
    "capabilities": { "...": "同上" },
    "data_version": "v16"
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `attendance.rate` | `(总数 − 缺勤) / 总数 × 100`；**无考勤记录时为 `null`**（区别于「0%」） |
| `exams[]` | 按 `exam_date` 正序；`rate = score / full_score × 100` |
| `avg_rate` / `trend` | 无成绩记录时为 `null`；`trend = 最后一次 − 第一次` |
| `hours` | 仅课时**数量**，来自 `orders`（`status='在读'`），不含任何金额 |

**错误**：

| HTTP | 场景 |
| --- | --- |
| 400 | 班级 ID 非正整数 |
| 403 | teacher 访问非本班 |
| 404 | 班级不存在 |

### 6.4 凭证类型与权限边界

| 凭证 | 签发方式 | 可访问范围 |
| --- | --- | --- |
| `accessToken` | 教务系统正常登录 | 全部接口（按角色与数据范围） |
| `agentToken` | 工作台用免登票据换取（`type = ai_agent`，12 小时） | **仅 `/api/agent/*` 与 `/api/ai/*`**；调用其他任何接口返回 403 |

路径校验在 `server/src/middleware/auth.js`；两种凭证共用同一套 `token_version` 吊销机制 —— 登出 / 改密 / 改角色后，`agentToken` 与 `accessToken` 同时失效。

---

## 7. 使用反馈（`/api/feedback`）

### 7.1 定位与数据边界

教师与管理员在使用系统过程中提交问题与改进建议，admin 汇总查看、回复与跟踪处理。

**数据边界**：只记录提交人身份（`user_id` / `username` / `user_role`）与问题描述，**不落任何学员数据** —— 避免「反馈」成为绕过四层权限的数据出口。

### 7.2 POST /api/feedback

| 项 | 值 |
| --- | --- |
| 权限 | 登录（admin / teacher） |
| 请求体 | `{ "category": "功能异常", "content": "…", "page_path": "/data/students" }` |

| 字段 | 约束 |
| --- | --- |
| `category` | 单选：`功能异常` / `操作不便` / `数据不准` / `性能问题` / `功能建议` / `其他`；非法值回落为 `其他` |
| `content` | **5–2000 字**，超出返回 400 |
| `page_path` | 选填，最长 200 字符（便于定位问题页面） |

**响应**：`{ "success": true, "data": { "id": 12 } }`

### 7.3 GET /api/feedback/mine

| 项 | 值 |
| --- | --- |
| 权限 | 登录 |
| 响应 | `{ success, data: { list: [...], total } }`，按 id 倒序，最多 100 条 |

每条含 `category / content / page_path / status / admin_reply / handled_at / created_at`，教师据此看到管理员的回复。

### 7.4 GET /api/feedback（admin）

| 项 | 值 |
| --- | --- |
| 权限 | **仅 admin**（teacher 返回 403） |
| 查询参数 | `?page=1&pageSize=20&status=待处理` |
| 排序 | **待处理优先** → 处理中 → 其他，同组内按 id 倒序 |

### 7.5 GET /api/feedback/summary（admin）

返回各状态计数与总数：`{ total, 待处理, 处理中, 已处理, 已忽略 }`，供首页角标展示。

### 7.6 PUT /api/feedback/:id（admin）

| 项 | 值 |
| --- | --- |
| 请求体 | `{ "status": "已处理", "admin_reply": "已定位，下个版本修复" }`（两者均可选） |
| 状态白名单 | `待处理` / `处理中` / `已处理` / `已忽略`；非法值返回 400 |
| 错误 | 404 反馈不存在 |

改状态时会同时写入 `handled_by`（处理人）与 `handled_at`（处理时间），`updated_at` 每次更新刷新。

---

## 8. 学员成长时间轴（`/api/growth`，v18 新增）
### 9.1 定位与硬约束

目标：不是「一份当前状态报告」，而是**一条成长轨迹** —— 能看到每个学员从 0 到成功的每一步。

| 约束 | 说明 |
| --- | --- |
| **只增不改** | `student_timeline` 只 INSERT。历史事件不可篡改是成长路径可信的前提 |
| **既有表不重复** | 出勤 / 成绩 / 课时由原表承载，读取时 UNION 合并，**不再写时间轴**（否则双份） |
| **金额与电话不出网** | 时间轴 payload 禁止放金额、家长电话，`scrubPayload` 兜底剔除 |
| **权限继承** | 复用 `utils/scope.js`，教师只能碰自己带的班与班内学员 |
| **阈值可改** | 走 `growth_thresholds`，admin 可调、立即生效、不重建镜像 |

**★ 采集入口在工作台，不在教务系统**（2026-09-18 人群分离定案）

教务系统给校区负责人 / 非一线教学人员用，教学 AI 工作台给一线老师用；
**老师要用的功能一律收在工作台**。因此「课后随手记」落在工作台的「授课流程」页，
「看学员成长路径」落在工作台的「学员成长路径」页，二者共用同一数据域。

**工作台凭证（`type=ai_agent`）对本模块的边界**（见 `middleware/auth.js`）：

| 路径 | 放行 | 理由 |
| --- | --- | --- |
| `GET /api/growth/*` | ✅ | 成长路径页需要读 |
| `POST /api/growth/class-eval`、`POST /api/growth/kp-assessment` | ✅ | 采集入口，教学口径 |
| `PUT /api/growth/thresholds` | ❌ 403 | 管理动作（改全局阈值），仅 admin |
| 其余 `/api/*`（财务 / 用户 / 学员增删改…） | ❌ 403 | 不在工作台职责内 |

> 读写必须同权。曾一度只放行写（采集端）而挡住读（查询端），
> 结果是老师能往班里写数据却看不到自己写的数据，成长路径页整页 403 —— 那是错的。
> 安全边界靠 `canManageClass` / `canManageStudent`（**老师只能碰自己带的班，跨班一律 403**），
> 不靠「挡住读」。

**审计**：`/api/growth` 的写操作已计入 `AUDIT_MODULES`，动作名为「新增成长记录」。

### 9.2 GET /api/growth/eval-form

老师打开「授课流程」页时的预填数据 —— 不让老师自己找该评什么。

| 项 | 值 |
| --- | --- |
| 权限 | auth + 本班（`canManageClass`） |
| 查询参数 | `?class_id=1&date=2026-09-20`（date 必须 `YYYY-MM-DD`） |
| 返回 | `students[]`（含 `evaluated` 与今日已评内容）、`knowledge_points[]`（该班课程的**叶子**知识点，最多 40 个）、`already_evaluated` |
| 错误 | 400 参数不合法 / 403 无权操作该班 |

**★ `knowledge_points[]` 只含叶子知识点（可评定对象）**，单元节点被后端过滤掉。

`knowledge_points` 是**两级结构**：单元（`seq=0` / `parent_id IS NULL`，如「第一单元 · 全等三角形」）
与其下的知识点（`seq>0` / `parent_id=单元 id`）。单元是**分组标题**，老师无法对它打勾。
不过滤会有两个后果：① 采集列表出现无法操作的行；② 单元节点占掉 `LIMIT` 名额，
把真正可评的知识点挤出去（真实数据里 13 条中 3 条是单元节点，`LIMIT 12` 恰好截掉了最后一个知识点）。

- 过滤条件用 `parent_id IS NOT NULL` 而非 `seq > 0`：语义更准（有父节点才是叶子），
  将来新增不按 `seq` 编号的知识点也不会漏
- 单元名不丢失：以 `unit_name` 字段带下来，供采集页做「单元 → 知识点」分组标题
- 定位区别：`GET /api/growth/knowledge-points` 返回**含单元节点的完整层级**（带 `parent_id`），
  用于展示层；`eval-form` 返回**可评集合**，用于采集层 —— 两者不应合并

### 9.3 POST /api/growth/class-eval

提交课堂评价（老师课后 10 秒动作）。

| 项 | 值 |
| --- | --- |
| 权限 | auth + 本班 |
| 请求体 | `{ class_id, course_id, eval_date, session_no, items: [{ student_id, focus, participation, mastery, note }] }` |
| 取值范围 | 三维均为 1–5（越界自动夹取，缺省 3） |
| 幂等 | `UNIQUE(student_id, course_id, eval_date)`，重复提交覆盖 |
| 联动 | 向 `student_timeline` **追加**一条 `class_eval` 事件（历史不可改） |
| 越权保护 | 学员不属于该班时静默跳过 |
| 返回 | `{ saved, appended, eval_date, class_id }` |

### 9.4 POST /api/growth/kp-assessment

批量知识点评定（老师课后 1 分钟动作）。

| 项 | 值 |
| --- | --- |
| 权限 | auth + 本班 |
| 请求体 | `{ class_id, course_id, assessed_at, session_no, kps: [{ kp_id, level }], student_ids?: [], overrides?: [{ student_id, kp_id, level }] }` |
| level 白名单 | `未掌握` / `部分掌握` / `已掌握` |
| 默认范围 | `student_ids` 缺省 = 全班在读学员 |
| 覆盖机制 | `overrides` 用于个别学员单独调整（如全班「已掌握」但某生「部分掌握」） |
| 联动 | 每条评定追加一条 `kp_assessment` 事件，payload 含 `from`（上次等级）与 `changed` |
| 返回 | `{ students, records }` |

### 9.5 GET /api/growth/students/:id/timeline

单学员成长时间轴（既有三表 UNION + 新事件，已去重）。

| 项 | 值 |
| --- | --- |
| 权限 | auth + 本班学员（`canManageStudent`） |
| 查询参数 | `?from=YYYY-MM-DD&to=YYYY-MM-DD`（可选） |
| 返回 | `{ studentId, from, to, count, events[] }`，事件含 `type / label / date / summary / payload` |
| 去重 | 既有表承载的维度优先，`student_timeline` 中的同名类型被丢弃；同类型同日期保留内容更全的一条 |

### 9.6 GET /api/growth/students/:id/growth

单学员成长画像 —— 「从 0 到成功」最直接的数据表达。

| 项 | 值 |
| --- | --- |
| 权限 | auth + 本班学员 |
| 返回要点 | `sessionCount`（课次数）、`attendance`（attended/absent/leave/rate）、`evalTrend[]`（课堂三维曲线）、`evalDelta`（首末对比）、`examSeries[]`、`kpProgress[]`（含 `from/to/delta/jumps`）、`milestones[]`、`breakdown`（分类计数） |
| 里程碑类型 | `kp_progress`（知识点真实跃迁，取过程中的跃迁点而非首末差值）、`attendance_streak`（连续 4 的倍数次课全勤且按时） |

### 9.7 GET /api/growth/classes/:id/growth

整班成长概览 —— 老师的使用动机来源（「这个班我教得怎么样」）。

| 项 | 值 |
| --- | --- |
| 权限 | auth + 本班 |
| 返回 | `studentCount`、`students[]`、`evalSeries[]`（每课班级三维均值）、`kpMastery[]`（每个知识点的已掌握/已评定与掌握率）、`thresholds` |

### 9.8 GET /api/growth/knowledge-points

知识点列表，供工作台筛选与展示。

| 项 | 值 |
| --- | --- |
| 权限 | auth（全员可读） |
| 查询参数 | `?course_id=1`（可选） |
| 排序 | 按 `unit_no, seq` 教学顺序 |
| 返回字段 | 含 `parent_id`，**保留单元节点**（`parent_id IS NULL` 即单元） |

**★ 与 9.2 `eval-form` 的定位区别（勿合并）**：
本端点返回**含单元节点的完整层级**，供展示层做树/分组；
`eval-form` 只返回**叶子知识点**（可评集合），供采集层逐行打勾。
两者形状相似但用途不同 —— 合成一个会导致要么采集页出现无法操作的行、
要么展示层丢失层级。

### 9.9 GET / PUT /api/growth/thresholds

| 项 | 值 |
| --- | --- |
| GET 权限 | auth（全员可读，供界面展示口径） |
| PUT 权限 | **仅 admin** |
| PUT 请求体 | `{ items: [{ key, value }] }`；未知 key 跳过，非数值跳过 |
| 返回 | `{ updated: n }` |
| 生效 | 立即（每次计算实时读表，无需重启） |

默认 8 条阈值：`absent_streak_warn` 2｜`score_trend_down` -8｜`score_trend_up` 8｜
`hours_low_warn` 12｜`excellent_rate` 88｜`outlier_z` 1.2｜`kp_progress_step` 1｜`attention_score` 6

---

## 9. 新增 / 修改 API 的流程（必须遵守）

1. 在 `server/src/routes/<module>.js` 中实现，复用 `auth` / `requireRole` / `utils/scope.js`。
2. 需要新表 / 新字段 → **新增迁移脚本**（`server/src/migrations/0NN-*.js`，版本连续递增），同步更新 `server/database.md`。
3. 在**本文件**「接口总览」表登记，并补写详细小节（路径、方法、权限、参数表、请求 / 响应示例、错误码、业务联动）。
4. 同步更新 `../04-API/openapi.yaml`。
5. 在 `../08-参考/PROGRESS.md` 记录；后端改动跑 `node server/scripts/e2e-lifecycle.mjs`。
