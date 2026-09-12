# API 权威文档 · 教务管理系统

> **本文件是本项目 REST API 的唯一权威文档。** 每次新增 / 修改接口必须同步更新本文件与 `docs/openapi.yaml`。
> 生成时间：2026-09-11 ｜ 数据库版本：**v14** ｜ 后端：Express 4 + `node:sqlite`

---

## 一、通用约定

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
| 400 | 参数错误 / 业务规则拒绝 | 必填缺失、删除时存在外键引用（如「该学员已有报班记录，不能删除」） |
| 401 | 未登录 / Token 失效 | 无 Token、Token 过期、误用 refreshToken 访问 |
| 403 | 无权限 | 教师访问非本班数据、非 admin 访问管理员接口 |
| 404 | 资源不存在 | 接口路径错误、记录不存在 |
| 500 | 服务器内部错误 | 未捕获异常（服务端已统一兜底） |

> 注意：本项目**不使用业务错误码 `code` 字段**，一律以 HTTP 状态码 + `success` 布尔表达。

### 1.4 认证与 Token

| 项 | 值 |
| --- | --- |
| 登录接口 | `POST /api/auth/login` |
| 请求体 | `{ "username": "admin", "password": "admin123456", "type": "password" }` |
| accessToken 有效期 | 7 天 |
| refreshToken 有效期 | 30 天 |
| 刷新接口 | `POST /api/auth/refresh-token`（body: `{ "refreshToken": "..." }`） |
| Token 载荷 | `{ id, username, role }`，`role ∈ { admin, teacher }` |

**默认账号**：`admin / admin123456`（管理员）、`teacher / teacher123456`（教师）。

### 1.5 角色与数据级权限

系统为**纯员工端 CRM**，仅 `admin` / `teacher` 两种角色；学生、家长**无账号、不登录**。

| 角色 | 数据范围 |
| --- | --- |
| `admin` | 全量数据 + 所有管理功能 |
| `teacher` | 仅 `classes.head_teacher_id = 当前用户` 的班级 / 学生 / 考勤 / 请假 / 统计 / 考试 / 通知；招生线索仅可见**自己创建**的 |

实现位置：`server/src/utils/scope.js`（`canManageClass` / `canManageStudent` / `studentScopeWhere` / `classScopeClause`）。

### 1.6 分页约定

请求：`?page=1&pageSize=10`（默认 `page=1`、`pageSize=10`）
响应：`{ "success": true, "data": { "list": [...], "total": 100 } }`

---

## 二、接口总览

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
| 班级 | DELETE | `/api/classes/:id` | admin/teacher | 删除班级（有学生则 400） |
| 学生 | GET | `/api/students` | 登录 | 学生列表（筛选分页，教师仅本班） |
| 学生 | GET | `/api/students/export` | 登录 | 学生全量导出（同列表筛选，不分页） |
| 学生 | POST | `/api/students` | admin/teacher | 新增学生 |
| 学生 | POST | `/api/students/import` | admin/teacher | 批量导入（前端解析 Excel 后提交） |
| 学生 | PUT | `/api/students/:id` | admin/teacher | 修改学生（仅本班） |
| 学生 | DELETE | `/api/students/:id` | admin/teacher | 删除学生（有业务记录则 400） |
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
| 课表 | PUT | `/api/schedules/:id` | admin/teacher | 修改课表条目 |
| 课表 | DELETE | `/api/schedules/:id` | admin/teacher | 删除课表条目 |
| 调课 | GET | `/api/schedule-adjustments` | 登录 | 调课申请列表（教师仅本班） |
| 调课 | POST | `/api/schedule-adjustments` | admin/teacher | 提交调课申请 |
| 调课 | PUT | `/api/schedule-adjustments/:id/approve` | admin | 审批通过 / 驳回（通过后课表自动同步） |
| 调课 | DELETE | `/api/schedule-adjustments/:id` | admin/teacher | 撤销申请（仅待审批，撤销后回滚课表） |
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
| 财务·订单 | GET | `/api/finance/orders` | 登录 | 报班订单列表（分页 + 多条件筛选） |
| 财务·订单 | GET | `/api/finance/orders/:id` | 登录 | 订单详情（含缴费明细与退费记录） |
| 财务·订单 | POST | `/api/finance/orders` | 登录 | 新增报班（含 `total_hours` 课时包） |
| 财务·订单 | PUT | `/api/finance/orders/:id` | 登录 | 修改订单 |
| 财务·订单 | PUT | `/api/finance/orders/:id/status` | 登录 | 变更状态（结业 / 退班） |
| 财务·订单 | DELETE | `/api/finance/orders/:id` | admin | 删除订单（级联删缴费 / 退费） |
| 财务·缴费 | GET | `/api/finance/payments` | 登录 | 缴费记录列表 |
| 财务·缴费 | POST | `/api/finance/payments` | 登录 | 登记缴费 |
| 财务·缴费 | PUT | `/api/finance/payments/:id` | admin | 修改缴费记录 |
| 财务·缴费 | DELETE | `/api/finance/payments/:id` | admin | 删除缴费记录 |
| 财务·退费 | GET | `/api/finance/refunds` | 登录 | 退费记录列表 |
| 财务·退费 | POST | `/api/finance/refunds` | 登录 | 提交退费申请 |
| 财务·退费 | PUT | `/api/finance/refunds/:id/approve` | admin | 退费审批 |
| 财务·退费 | DELETE | `/api/finance/refunds/:id` | admin | 删除退费记录 |
| 财务·统计 | GET | `/api/finance/stats/revenue` | 登录 | 营收统计（`granularity=day\|month`） |
| 财务·统计 | GET | `/api/finance/stats/arrears` | 登录 | 欠费统计 |
| 财务·统计 | GET | `/api/finance/stats/low-hours` | 登录 | 低课时预警 |
| 财务·统计 | GET | `/api/finance/stats/consumption` | 登录 | 课消统计（teacher 金额不可见） |
| 财务·统计 | GET | `/api/finance/stats/business` | admin | 经营报表 |
| 招生 | GET | `/api/leads` | 登录 | 线索列表（教师仅自己） |
| 招生 | POST | `/api/leads` | 登录 | 新增线索 |
| 招生 | PUT | `/api/leads/:id` | 登录 | 修改线索 |
| 招生 | PUT | `/api/leads/:id/follow` | 登录 | 追加跟进记录 |
| 招生 | PUT | `/api/leads/:id/status` | 登录 | 状态流转 |
| 招生 | PUT | `/api/leads/:id/convert` | 登录 | **一键转化**（事务：建档 + 报班） |
| 招生 | DELETE | `/api/leads/:id` | admin | 删除线索 |
| 招生 | GET | `/api/leads/stats/channels` | 登录 | 渠道统计 |
| 通知 | GET | `/api/notifications` | 登录 | 通知记录（教师仅本班学员） |
| 通知 | PUT | `/api/notifications/:id/read` | 登录 | 单条标记已读 |
| 通知 | PUT | `/api/notifications/read-all` | 登录 | 全部标记已读 |
| 考试 | GET | `/api/exams` | 登录 | 考试列表（含成绩录入进度，教师仅本班） |
| 考试 | POST | `/api/exams` | 登录 | 新增考试 |
| 考试 | PUT | `/api/exams/:id` | 登录 | 修改考试 |
| 考试 | DELETE | `/api/exams/:id` | 登录 | 删除考试（级联删成绩） |
| 考试 | GET | `/api/exams/:id/scores` | 登录 | 成绩录入表单（考试信息 + 在读学生 + 已有成绩） |
| 考试 | PUT | `/api/exams/:id/scores` | 登录 | **批量录入成绩**（事务 upsert；新插入时推送成绩通知） |
| 考试 | GET | `/api/exams/:id/scorecard` | 登录 | 成绩单（排名 + 等级 + 平均分） |
| 报告 | GET | `/api/reports/students/:id` | 登录 | 学习报告 |
| 报告 | GET | `/api/reports/students/:id/timeline` | 登录 | 成长档案时间线 |
| 分析 | GET | `/api/analytics/metrics` | admin | 指标定义字典（AI 解析用） |
| 分析 | GET | `/api/analytics/overview` | admin | 全局经营概览 |
| 分析 | GET | `/api/analytics/attendance/export` | admin | 考勤数据批量导出 |
| 分析 | GET | `/api/analytics/finance/export` | admin | 财务数据批量导出 |
| 分析 | GET | `/api/analytics/leads/export` | admin | 招生线索批量导出 |
| 分析 | GET | `/api/analytics/scores/export` | admin | 成绩数据批量导出 |
| 健康 | GET | `/api/health` | 公开 | 容器健康检查 |

---

## 三、P0 模块接口详解

### POST /api/attendance/batch

**业务说明**：批量登记考勤（签到核心接口）。提交后自动联动**课时包扣减**、**缺勤家长通知**、**考勤↔请假同步单**。

**权限**：admin / teacher（teacher 仅限本班学生，逐条校验，越权返回 403）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| date | string | 是 | 日期 `YYYY-MM-DD` |
| course_id | number | 是 | 课程 ID |
| records | array | 是 | 考勤记录数组，不允许为空 |
| records[].student_id | number | 是 | 学生 ID |
| records[].status | string | 是 | `正常` / `迟到` / `早退` / `缺勤` / `请假` |
| records[].remark | string | 否 | 备注 |

> 说明：班级由学生档案（`students.class_id`）决定，**请求体不需要传 `class_id`**。

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
- 状态变为 `缺勤` → 生成家长缺勤通知（`notifications.type='考勤缺勤'`，`parent_name` 为家长姓名快照）；幂等：同日同学生已有则跳过。
- 状态由 `缺勤` 改为其他 → **撤销当日缺勤通知**。
- 状态变为 `请假` → 生成待审批请假同步单（`leaves.source='考勤同步'`）；幂等：覆盖该日期已有任意来源的待审批 / 已通过单则不重复生成。
- 状态由 `请假` 改为其他 → 撤销当日同步单（待审批 / 已通过一并删除）并撤销「请假审批通过」通知。
- 保存语义为 `ON CONFLICT(student_id, course_id, date) DO UPDATE`（**重复提交覆盖**）。

**错误**：

| HTTP | 场景 |
| --- | --- |
| 400 | `date` / `course_id` / `records` 缺失或 `records` 为空；状态值非法 |
| 403 | 包含无权操作的学生记录 |

---

### PUT /api/exams/:id/scores

**业务说明**：批量录入考试成绩（事务 upsert）。**仅新插入**成绩时向家长推送「成绩发布」通知。

**权限**：admin / teacher（teacher 仅本班考试）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| scores | array | 是 | 成绩数组 |
| scores[].student_id | number | 是 | 学生 ID |
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

- `GET /api/exams/:id/scores` → 成绩录入表单（考试信息 + 该班在读学生 + 已有成绩）
- `GET /api/exams/:id/scorecard` → 成绩单（排名 + 等级 + 平均分）

---

### PUT /api/leads/:id/convert

**业务说明**：招生线索**一键转化**。在**单个事务**内自动创建学员档案 + 报班订单，并把线索标记为「已转化」。

**权限**：admin / teacher（teacher 仅限自己创建的线索）

**请求参数**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| class_id | number | 是 | 转入班级 ID |
| course_id | number | 否 | 报班课程 ID |
| student_no | string | 否 | 学号（缺省由后端生成） |
| gender | string | 否 | `男` / `女` |
| parent_name | string | 否 | 家长姓名（缺省取线索姓名） |
| parent_phone | string | 否 | 家长电话（缺省取线索电话） |
| amount | number | 否 | 订单金额，默认 0 |
| total_hours | number | 否 | 课时包总课时，默认 0 |

**业务联动**：

- 事务内 `INSERT students`（`source_channel` 写入线索来源，`enroll_date` 写入当天）+ `INSERT orders`，并把 `leads.status` 置为 `已转化`、`leads.converted_student_id` 指向新学员。
- 原子性：任一步失败整体回滚，**不会**出现「建了学员没有订单」或反之。
- 线索删除（admin）时 `converted_student_id` 置空，不影响已建学员档案。

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

> 仅返回 `students.status = '在读'` 的学生；未登记的 `status` 为 `null`。

---

### GET /api/students

**业务说明**：学生列表（筛选 + 分页）。

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
| list | array | 是 | 待导入行数组（前端解析 Excel 得到） |
| list[].student_no | string | 是 | 学号（唯一） |
| list[].name | string | 是 | 姓名 |
| list[].class_id | number | 是 | 班级 ID |
| list[].gender | string | 否 | `男` / `女` |
| list[].parent_name | string | 否 | 家长姓名 |
| list[].parent_phone | string | 否 | 家长电话 |
| list[].source_channel | string | 否 | 来源渠道 |

**响应示例**：

```json
{ "success": true, "data": { "success_count": 3, "fail_count": 1, "failures": [ { "row": 4, "student_no": "S002", "message": "学号已存在" } ] } }
```

---

## 四、AI 分析接口（`/api/analytics`）

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
      "data_version": "v14",
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

## 五、新增 / 修改 API 的流程（必须遵守）

1. 在 `server/src/routes/<module>.js` 中实现，复用 `auth` / `requireRole` / `utils/scope.js`。
2. 需要新表 / 新字段 → **新增迁移脚本**（`server/src/migrations/0NN-*.js`，版本连续递增），同步更新 `server/database.md`。
3. 在**本文件**「接口总览」表登记，并补写详细小节（路径、方法、权限、参数表、请求 / 响应示例、错误码、业务联动）。
4. 同步更新 `docs/openapi.yaml`。
5. 在 `PROGRESS.md` 记录；后端改动跑 `node server/scripts/e2e-lifecycle.mjs`。
