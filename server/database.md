# 数据库清单（权威文档）

数据库文件：`server/data/attendance.db`（SQLite，WAL 模式，Node 内置 `node:sqlite`）

> **维护规则（必须遵守）**
>
> 1. 每次数据库变更必须新增一个版本化迁移脚本（`server/src/migrations/00N-*.js`，版本 +1），**禁止修改已发布的迁移**
> 2. 同步更新本清单的「版本历史」与「表结构」，保持清单与迁移脚本一致
> 3. 迁移必须事务化、可重放（从任意旧版本能升级到最新），失败自动回滚并终止启动
> 4. 发布前用旧库副本验证升级路径（数据保留、外键完整、自增序列正确）

## 版本历史

| 版本 | 说明               | 变更内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1   | 初始版本           | 建 8 张表（users / user_oauth / classes / students / courses / attendances / leaves）                                                                                                                                                                                                                                                                                                                                                                                          |
| v2   | 角色系统           | `users.role` 的 CHECK 约束扩展为 `('admin','teacher','student')`；重建 users 表并保留数据；生成历史快照表 `users_backup_v1`（可回溯，后续版本可清理）                                                                                                                                                                                                                                                                                                                          |
| v3   | 班主任绑定         | `classes` 新增 `head_teacher_id`（引用 users 表教师账号），实现教师"仅管本班"数据级权限；仅 ADD COLUMN，不重建表                                                                                                                                                                                                                                                                                                                                                               |
| v4   | 课程表             | 新增 `schedules` 表（班级 × 星期 × 节次 的课程安排），考勤登记可自动带出课程                                                                                                                                                                                                                                                                                                                                                                                                   |
| v5   | 学期管理           | 新增 `terms` 表（学期名称/起止日期/是否当前），统计报表可按学期筛选，日期范围自动联动学期起止                                                                                                                                                                                                                                                                                                                                                                                  |
| v6   | 系统参数与通知公告 | 新增 `settings`（键值对系统参数：缺勤预警阈值等）与 `notices`（通知公告，支持置顶/发布/下架）两张表                                                                                                                                                                                                                                                                                                                                                                            |
| v7   | 操作审计日志       | 新增 `audit_logs` 表（自动记录登录用户的关键写操作：操作人/动作/接口/IP/时间），仅 admin 可查看                                                                                                                                                                                                                                                                                                                                                                                |
| v8   | 财务管理           | 新增 `orders`（报班订单）、`payments`（收费记录）、`refunds`（退费记录）三表，打通「报名 → 缴费 → 退费」主链路；存量学员自动补默认报班订单（幂等）                                                                                                                                                                                                                                                                                                                             |
| v9   | 课时与招生         | `orders` 增 `total_hours` / `remain_hours`（课时包，考勤登记自动联动扣减）；`students` 增家长信息 / 来源渠道 / 报名日期；新增 `leads` 招生线索表（渠道/跟进/转化）                                                                                                                                                                                                                                                                                                             |
| v10  | 家校与经营报表     | `users.role` 的 CHECK 约束扩展为 `('admin','teacher','student','parent')`（重建 users 表并保留数据）；新增 `parent_children`（家长 ↔ 学员绑定）与 `notifications`（考勤缺勤通知，target 为绑定家长）两表                                                                                                                                                                                                                                                                      |
| v11  | 教学结果与课消     | 新增 `exams`（考试）、`exam_scores`（成绩，UNIQUE(exam_id,student_id) 一考一成绩）、`hour_consumptions`（课时消耗流水：扣减/回补逐笔留痕）三表；重建 `notifications` 表，`type` 的 CHECK 约束扩展为 `('考勤缺勤','成绩发布')`（成绩发布通知 target 为绑定家长，仅新插入成绩时生成，修改成绩不重复，幂等防重）；`exams.course_id/class_id` 级联删除、`exam_scores` 级联删除、`hour_consumptions.order_id` 级联删除                                                              |
| v12  | 排课优化           | 新增 `schedule_adjustments`（调课申请表：原/目标时段快照、审批状态、通过后事务内同步 `schedules` 原时段释放/新时段占用）与 `makeup_classes`（补课登记表：关联缺勤/请假原始日期，标记完成联动扣减课时包并写 `hour_consumptions` 流水，撤销回补，幂等由状态机保证）两表                                                                                                                                                                                                          |
| v13  | 统一用户与联动     | `students` 增 `user_id`（唯一索引，账号↔档案一对一）；存量学生自动补建 student 账号（username=学号，占位密码 123456，学生暂不可登录）；`leaves` 增 `source`（手动/考勤同步），考勤↔请假双向联动（考勤标记请假自动生成待审批同步单，审批通过回写考勤+回补课时+通知家长；驳回回滚考勤为缺勤；改回其他状态撤销同步单及通知）；`notifications.type` CHECK 扩展 '请假审批通过'；清理 `settings.term_id` 僵尸键；删除保护增强（订单有缴费/退费禁删、班级/课程/课表/线索/学生保护） |
| v14  | 员工端 CRM 定调    | **系统定位调整为纯员工端 CRM**：学生/家长不登录、无账号。`users.role` CHECK 收紧为 `('admin','teacher')`（重建表，清理历史 student/parent 账号数据）；`students` 删除 `user_id` 列及索引（账号关联废弃）；删除 `parent_children` 表（绑定关系回填为 `students.parent_name/parent_phone`）；`notifications` 重建：删除 `target_user_id`，新增 `parent_name` 快照列（通知仅内部留痕）；删除家长管理路由与页面，家长信息统一存于学生档案；线索转化不再建 student/parent 账号      |
| v15  | JWT 凭证可吊销     | `users` 新增 `token_version INTEGER NOT NULL DEFAULT 0`。签发的 accessToken / refreshToken 均携带 `tv` 声明，`middleware/auth.js` 鉴权时与 `users.token_version` 比对；**登出 / 改密 / 改角色 / 删号**时递增该值即可立即吊销该用户全部已签发凭证（此前 JWT 无状态，登出为空实现、refreshToken 30 天内无法失效）。兼容性：升级前签发的旧 token 无 `tv` 声明，按 0 处理，与本列默认值一致，不会强制已登录员工重新登录 |
| v16  | 使用反馈           | 新增 `feedbacks` 表（教师 / 管理员在使用系统过程中提交的问题与建议：提交人 `user_id`/`username`/`user_role`、`category`、`content`、`page_path`、`status`、`admin_reply`、`handled_by`/`handled_at`）。支撑首页「使用反馈」模块：教师提交并看到回复，admin 汇总、回复与跟踪处理。**只记录提交人身份与问题描述，不落任何学员数据**，避免反馈成为绕过四层权限的数据出口。建索引 `status` / `user_id` / `created_at` |

| v17  | AI 配置中心       | 新增 `ai_settings`（AI 配置键值表，**优先级高于环境变量**，改完立即生效，无需重建容器）与 `ai_usage`（每次服务端生成后落一条用量：谁、什么场景、多少 token、多少成本）。支撑「AI 配置中心」页面（仅 admin，不进菜单，凭 `/#/ai-admin` 进入）。解决 2026-09-16 校区部署反馈的「改一个 Key 要重建镜像」问题 |

当前最新版本：**v17**（`PRAGMA user_version` = 17）

## 表结构

### users（员工账号，纯员工端 CRM 唯一账号体系）

| 字段          | 类型    | 约束                                                                  | 说明                                 |
| ------------- | ------- | --------------------------------------------------------------------- | ------------------------------------ |
| id            | INTEGER | PK, AUTOINCREMENT                                                     | 用户 ID                              |
| username      | TEXT    | NOT NULL, UNIQUE                                                      | 登录账号                             |
| password_hash | TEXT    | NOT NULL                                                              | bcrypt 密码哈希                      |
| name          | TEXT    | NOT NULL                                                              | 姓名                                 |
| role          | TEXT    | NOT NULL, DEFAULT 'teacher', CHECK IN ('admin','teacher')（v14 收紧） | 角色：管理员/教师（学生/家长无账号） |
| phone         | TEXT    | UNIQUE                                                                | 手机号                               |
| token_version | INTEGER | NOT NULL, DEFAULT 0（v15 新增）                                       | 凭证版本号；登录时写入 JWT 的 `tv` 声明，鉴权时比对。递增即吊销该员工全部已签发凭证（登出/改密/改角色） |
| created_at    | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')                         | 创建时间                             |

### user_oauth（第三方/多端绑定，预留微信小程序）

| 字段       | 类型    | 约束                                             | 说明                  |
| ---------- | ------- | ------------------------------------------------ | --------------------- |
| id         | INTEGER | PK, AUTOINCREMENT                                | 绑定 ID               |
| user_id    | INTEGER | NOT NULL, REFERENCES users(id) ON DELETE CASCADE | 用户 ID               |
| provider   | TEXT    | NOT NULL                                         | 登录方式（如 wechat） |
| openid     | TEXT    | NOT NULL                                         | 平台 openid           |
| unionid    | TEXT    |                                                  | 平台 unionid          |
| created_at | TEXT    | NOT NULL, DEFAULT                                | 绑定时间              |

约束：`UNIQUE (provider, openid)`

### classes（班级）

| 字段            | 类型    | 约束                            | 说明                                              |
| --------------- | ------- | ------------------------------- | ------------------------------------------------- |
| id              | INTEGER | PK, AUTOINCREMENT               | 班级 ID                                           |
| name            | TEXT    | NOT NULL, UNIQUE                | 班级名称                                          |
| grade           | TEXT    | NOT NULL, DEFAULT ''            | 年级                                              |
| head_teacher    | TEXT    | NOT NULL, DEFAULT ''            | 班主任姓名（展示用）                              |
| head_teacher_id | INTEGER | REFERENCES users(id)（v3 新增） | 班主任账号（数据级权限：教师仅可见/管理绑定班级） |
| created_at      | TEXT    | NOT NULL, DEFAULT               | 创建时间                                          |

### students（学生档案）

| 字段           | 类型    | 约束                                                      | 说明                       |
| -------------- | ------- | --------------------------------------------------------- | -------------------------- |
| id             | INTEGER | PK, AUTOINCREMENT                                         | 学生 ID                    |
| student_no     | TEXT    | NOT NULL, UNIQUE                                          | 学号                       |
| name           | TEXT    | NOT NULL                                                  | 姓名                       |
| gender         | TEXT    | NOT NULL, DEFAULT '男', CHECK IN ('男','女')              | 性别                       |
| phone          | TEXT    |                                                           | 手机号                     |
| email          | TEXT    |                                                           | 邮箱                       |
| class_id       | INTEGER | NOT NULL, REFERENCES classes(id) ON DELETE RESTRICT       | 所属班级（有学生禁止删班） |
| status         | TEXT    | NOT NULL, DEFAULT '在读', CHECK IN ('在读','休学','退学') | 学籍状态                   |
| parent_name    | TEXT    | NOT NULL, DEFAULT ''（v9 新增）                           | 家长姓名                   |
| parent_phone   | TEXT    | NOT NULL, DEFAULT ''（v9 新增）                           | 家长电话                   |
| source_channel | TEXT    | NOT NULL, DEFAULT ''（v9 新增）                           | 来源渠道（线索转化时写入） |
| enroll_date    | TEXT    | NOT NULL, DEFAULT ''（v9 新增）                           | 报名日期                   |
| created_at     | TEXT    | NOT NULL, DEFAULT                                         | 创建时间                   |

> v14：`user_id` 列已删除（v13 引入的账号↔档案关联废弃）。学生不登录、无账号；家长信息（姓名/电话）是学生档案的普通字段，通知以 parent_name 快照留痕。

索引：`idx_students_class_id (class_id)`

### courses（课程）

| 字段       | 类型    | 约束                 | 说明     |
| ---------- | ------- | -------------------- | -------- |
| id         | INTEGER | PK, AUTOINCREMENT    | 课程 ID  |
| code       | TEXT    | NOT NULL, UNIQUE     | 课程编号 |
| name       | TEXT    | NOT NULL             | 课程名称 |
| teacher    | TEXT    | NOT NULL, DEFAULT '' | 授课教师 |
| created_at | TEXT    | NOT NULL, DEFAULT    | 创建时间 |

### schedules（课程表，v4 新增）

| 字段        | 类型    | 约束                                               | 说明                    |
| ----------- | ------- | -------------------------------------------------- | ----------------------- |
| id          | INTEGER | PK, AUTOINCREMENT                                  | 课表条目 ID             |
| class_id    | INTEGER | NOT NULL, REFERENCES classes(id) ON DELETE CASCADE | 班级 ID                 |
| course_id   | INTEGER | NOT NULL, REFERENCES courses(id) ON DELETE CASCADE | 课程 ID                 |
| day_of_week | INTEGER | NOT NULL, CHECK BETWEEN 1 AND 7                    | 星期（1=周一 … 7=周日） |
| period      | INTEGER | NOT NULL, CHECK BETWEEN 1 AND 8                    | 节次（1-8）             |
| created_at  | TEXT    | NOT NULL, DEFAULT                                  | 创建时间                |

约束：`UNIQUE (class_id, course_id, day_of_week, period)`
索引：`idx_schedules_class_day (class_id, day_of_week)`

### terms（学期，v5 新增）

| 字段                  | 类型    | 约束                                | 说明                                 |
| --------------------- | ------- | ----------------------------------- | ------------------------------------ |
| id                    | INTEGER | PK, AUTOINCREMENT                   | 学期 ID                              |
| name                  | TEXT    | NOT NULL, UNIQUE                    | 学期名称                             |
| start_date / end_date | TEXT    | NOT NULL                            | 起止日期                             |
| is_current            | INTEGER | NOT NULL, DEFAULT 0, CHECK IN (0,1) | 是否当前学期（应用层保证仅一条为 1） |
| created_at            | TEXT    | NOT NULL, DEFAULT                   | 创建时间                             |

### settings（系统参数，v6 新增，键值对）

| 字段       | 类型 | 约束                 | 说明                                                               |
| ---------- | ---- | -------------------- | ------------------------------------------------------------------ |
| key        | TEXT | PK                   | 参数键（预置：warn_rate / warn_consecutive / warn_days / term_id） |
| value      | TEXT | NOT NULL, DEFAULT '' | 参数值                                                             |
| updated_at | TEXT | NOT NULL, DEFAULT    | 更新时间                                                           |

### notices（通知公告，v6 新增）

| 字段                    | 类型    | 约束                                               | 说明                       |
| ----------------------- | ------- | -------------------------------------------------- | -------------------------- |
| id                      | INTEGER | PK, AUTOINCREMENT                                  | 公告 ID                    |
| title                   | TEXT    | NOT NULL                                           | 标题                       |
| content                 | TEXT    | NOT NULL, DEFAULT ''                               | 内容                       |
| creator_id              | INTEGER | REFERENCES users(id)                               | 发布人（用户 ID）          |
| is_top                  | INTEGER | NOT NULL, DEFAULT 0, CHECK IN (0,1)                | 是否置顶                   |
| status                  | TEXT    | NOT NULL, DEFAULT '发布', CHECK IN ('发布','下架') | 状态（下架后看板不再展示） |
| created_at / updated_at | TEXT    | NOT NULL, DEFAULT                                  | 创建/更新时间              |

### audit_logs（操作审计日志，v7 新增）

| 字段       | 类型    | 约束                 | 说明                                       |
| ---------- | ------- | -------------------- | ------------------------------------------ |
| id         | INTEGER | PK, AUTOINCREMENT    | 日志 ID                                    |
| user_id    | INTEGER | REFERENCES users(id) | 操作用户 ID                                |
| username   | TEXT    | NOT NULL, DEFAULT '' | 操作人账号                                 |
| action     | TEXT    | NOT NULL             | 动作描述（如「新增学生」「修改系统参数」） |
| method     | TEXT    | NOT NULL             | HTTP 方法（POST/PUT/DELETE）               |
| path       | TEXT    | NOT NULL             | 接口路径                                   |
| detail     | TEXT    | NOT NULL, DEFAULT '' | 补充说明                                   |
| ip         | TEXT    | NOT NULL, DEFAULT '' | 来源 IP                                    |
| created_at | TEXT    | NOT NULL, DEFAULT    | 操作时间                                   |

索引：`idx_audit_logs_user (user_id)`、`idx_audit_logs_time (created_at)`

### attendances（考勤记录）

| 字段 | 类型 | 约束 | 说明 |
| id | INTEGER | PK, AUTOINCREMENT | 记录 ID |
| student_id | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE CASCADE | 学生 ID |
| course_id | INTEGER | NOT NULL, REFERENCES courses(id) ON DELETE CASCADE | 课程 ID |
| date | TEXT | NOT NULL | 考勤日期（YYYY-MM-DD） |
| status | TEXT | NOT NULL, CHECK IN ('正常','迟到','早退','缺勤','请假') | 考勤状态 |
| remark | TEXT | NOT NULL, DEFAULT '' | 备注 |
| created_at / updated_at | TEXT | NOT NULL, DEFAULT | 创建/更新时间 |

约束：`UNIQUE (student_id, course_id, date)`
索引：`idx_attendance_date (date)`、`idx_attendance_course_date (course_id, date)`

### leaves（请假申请）

| 字段                      | 类型    | 约束                                                               | 说明                                  |
| ------------------------- | ------- | ------------------------------------------------------------------ | ------------------------------------- |
| id                        | INTEGER | PK, AUTOINCREMENT                                                  | 申请 ID                               |
| student_id                | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE CASCADE                | 学生 ID                               |
| type                      | TEXT    | NOT NULL, CHECK IN ('病假','事假','其他')                          | 请假类型                              |
| reason                    | TEXT    | NOT NULL, DEFAULT ''                                               | 请假原因                              |
| start_date / end_date     | TEXT    | NOT NULL                                                           | 起止日期                              |
| status                    | TEXT    | NOT NULL, DEFAULT '待审批', CHECK IN ('待审批','通过','驳回')      | 审批状态                              |
| source                    | TEXT    | NOT NULL, DEFAULT '手动'（v13 新增），CHECK IN ('手动','考勤同步') | 请假来源：手动申请 / 考勤登记同步生成 |
| approved_by               | INTEGER | REFERENCES users(id)                                               | 审批人（用户 ID）                     |
| apply_time / approve_time | TEXT    |                                                                    | 申请/审批时间                         |

索引：`idx_leaves_status (status)`、`idx_leaves_student (student_id)`

> **考勤↔请假双向联动（v13）**：考勤登记标记「请假」自动生成待审批同步单（source=考勤同步，幂等：已有任意来源待审批/通过单覆盖该日期则不重复）；同步单/手动单审批「通过」→ 回写请假日期范围内考勤为请假 + 回补课时 + 通知家长；审批「驳回」→ 覆盖日期内考勤「请假」回滚为「缺勤」（缺勤/请假均不扣课时，课时留给补课）；考勤改回其他状态 → 撤销当日同步单（待审批/已通过一并删除）+ 撤销「请假审批通过」通知。

### orders（报班订单，v8 新增）

| 字段                    | 类型    | 约束                                                      | 说明                                   |
| ----------------------- | ------- | --------------------------------------------------------- | -------------------------------------- |
| id                      | INTEGER | PK, AUTOINCREMENT                                         | 订单 ID                                |
| student_id              | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE RESTRICT      | 学员 ID（有报班记录禁止删学员）        |
| class_id                | INTEGER | REFERENCES classes(id) ON DELETE SET NULL                 | 班级 ID（删班后保留订单）              |
| course_id               | INTEGER | REFERENCES courses(id) ON DELETE SET NULL                 | 课程 ID（删课后保留订单）              |
| enroll_date             | TEXT    | NOT NULL, DEFAULT date('now','localtime')                 | 报名日期                               |
| amount                  | REAL    | NOT NULL, DEFAULT 0, CHECK >= 0                           | 订单金额（应缴总额）                   |
| total_hours             | REAL    | NOT NULL, DEFAULT 0（v9 新增）                            | 总课时（课时包）                       |
| remain_hours            | REAL    | NOT NULL, DEFAULT 0（v9 新增）                            | 剩余课时（考勤正常/迟到/早退自动扣 1） |
| status                  | TEXT    | NOT NULL, DEFAULT '在读', CHECK IN ('在读','结业','退班') | 订单状态                               |
| enroll_user_id          | INTEGER | REFERENCES users(id) ON DELETE SET NULL                   | 报名老师                               |
| remark                  | TEXT    | NOT NULL, DEFAULT ''                                      | 备注                                   |
| created_at / updated_at | TEXT    | NOT NULL, DEFAULT                                         | 创建/更新时间                          |

索引：`idx_orders_student (student_id)`、`idx_orders_status (status)`、`idx_orders_enroll_date (enroll_date)`

### payments（收费记录，v8 新增）

| 字段        | 类型    | 约束                                                      | 说明                      |
| ----------- | ------- | --------------------------------------------------------- | ------------------------- |
| id          | INTEGER | PK, AUTOINCREMENT                                         | 记录 ID                   |
| order_id    | INTEGER | NOT NULL, REFERENCES orders(id) ON DELETE CASCADE         | 订单 ID（删单级联删缴费） |
| student_id  | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE RESTRICT      | 学员 ID                   |
| amount      | REAL    | NOT NULL, CHECK > 0                                       | 缴费金额                  |
| pay_method  | TEXT    | NOT NULL, DEFAULT '转账', CHECK IN ('现金','转账','扫码') | 支付方式                  |
| pay_user_id | INTEGER | REFERENCES users(id) ON DELETE SET NULL                   | 收款人                    |
| pay_time    | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')             | 收费时间                  |
| remark      | TEXT    | NOT NULL, DEFAULT ''                                      | 备注                      |
| created_at  | TEXT    | NOT NULL, DEFAULT                                         | 创建时间                  |

索引：`idx_payments_order (order_id)`、`idx_payments_time (pay_time)`、`idx_payments_student (student_id)`

### refunds（退费记录，v8 新增）

| 字段                      | 类型    | 约束                                                          | 说明          |
| ------------------------- | ------- | ------------------------------------------------------------- | ------------- |
| id                        | INTEGER | PK, AUTOINCREMENT                                             | 记录 ID       |
| order_id                  | INTEGER | NOT NULL, REFERENCES orders(id) ON DELETE CASCADE             | 订单 ID       |
| student_id                | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE RESTRICT          | 学员 ID       |
| amount                    | REAL    | NOT NULL, CHECK > 0                                           | 退费金额      |
| reason                    | TEXT    | NOT NULL, DEFAULT ''                                          | 退费原因      |
| status                    | TEXT    | NOT NULL, DEFAULT '待审批', CHECK IN ('待审批','通过','驳回') | 审批状态      |
| apply_user_id             | INTEGER | REFERENCES users(id) ON DELETE SET NULL                       | 申请人        |
| approved_by               | INTEGER | REFERENCES users(id) ON DELETE SET NULL                       | 审批人        |
| apply_time / approve_time | TEXT    |                                                               | 申请/审批时间 |
| remark                    | TEXT    | NOT NULL, DEFAULT ''                                          | 备注          |
| created_at                | TEXT    | NOT NULL, DEFAULT                                             | 创建时间      |

索引：`idx_refunds_order (order_id)`、`idx_refunds_status (status)`

### leads（招生线索，v9 新增）

| 字段                    | 类型    | 约束                                                                       | 说明                                       |
| ----------------------- | ------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| id                      | INTEGER | PK, AUTOINCREMENT                                                          | 线索 ID                                    |
| name                    | TEXT    | NOT NULL                                                                   | 姓名                                       |
| phone                   | TEXT    | NOT NULL, DEFAULT ''                                                       | 电话                                       |
| intent_course_id        | INTEGER | REFERENCES courses(id) ON DELETE SET NULL                                  | 意向课程                                   |
| source                  | TEXT    | NOT NULL, DEFAULT '转介绍', CHECK IN ('转介绍','线上','地推','广告')       | 来源渠道                                   |
| follow_user_id          | INTEGER | REFERENCES users(id) ON DELETE SET NULL                                    | 跟进人（创建者，教师仅可见自己线索）       |
| follow_records          | TEXT    | NOT NULL, DEFAULT '[]'                                                     | 跟进记录（JSON 数组：{time,user,content}） |
| status                  | TEXT    | NOT NULL, DEFAULT '新线索', CHECK IN ('新线索','跟进中','已转化','已流失') | 线索状态                                   |
| converted_student_id    | INTEGER | REFERENCES students(id) ON DELETE SET NULL                                 | 转化学员（转化时自动建档+报班）            |
| remark                  | TEXT    | NOT NULL, DEFAULT ''                                                       | 备注                                       |
| created_at / updated_at | TEXT    | NOT NULL, DEFAULT                                                          | 创建/更新时间                              |

索引：`idx_leads_status (status)`、`idx_leads_phone (phone)`

### notifications（通知：缺勤 / 成绩发布 / 请假审批通过，v10 新增、v11/v13/v14 演进）

| 字段        | 类型    | 约束                                                                                                  | 说明                                                                                                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id          | INTEGER | PK, AUTOINCREMENT                                                                                     | 通知 ID                                                                                                                                                  |
| student_id  | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE CASCADE                                                   | 学员 ID                                                                                                                                                  |
| type        | TEXT    | NOT NULL, DEFAULT '考勤缺勤', CHECK IN ('考勤缺勤','成绩发布','请假审批通过')（v11 扩展、v13 再扩展） | 通知类型：考勤缺勤 / 成绩发布 / 请假审批通过                                                                                                             |
| title       | TEXT    | NOT NULL                                                                                              | 标题                                                                                                                                                     |
| content     | TEXT    | NOT NULL, DEFAULT ''                                                                                  | 内容（含学员/日期/课程/分数）                                                                                                                            |
| date        | TEXT    | NOT NULL, DEFAULT ''                                                                                  | 通知日期（YYYY-MM-DD）                                                                                                                                   |
| parent_name | TEXT    | NOT NULL, DEFAULT ''（v14 新增）                                                                      | 家长姓名快照（考勤缺勤时自动生成，改回正常自动撤销；成绩发布时仅新插入成绩生成，修改成绩不重复；请假审批通过时审批通过后生成，考勤改回其他状态自动撤销） |
| is_read     | INTEGER | NOT NULL, DEFAULT 0, CHECK IN (0,1)                                                                   | 是否已读                                                                                                                                                 |
| created_at  | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')                                                         | 创建时间                                                                                                                                                 |

> v14：`target_user_id` 已删除，改为 `parent_name` 快照（家长无账号，通知仅内部留痕）。

索引：`idx_notifications_student (student_id)`、`idx_notifications_date (date)`、`idx_notifications_read (is_read)`

### exams（考试，v11 新增）

| 字段       | 类型    | 约束                                                          | 说明     |
| ---------- | ------- | ------------------------------------------------------------- | -------- |
| id         | INTEGER | PK, AUTOINCREMENT                                             | 考试 ID  |
| name       | TEXT    | NOT NULL                                                      | 考试名称 |
| course_id  | INTEGER | REFERENCES courses(id) ON DELETE CASCADE                      | 课程 ID  |
| class_id   | INTEGER | NOT NULL, REFERENCES classes(id) ON DELETE CASCADE            | 班级 ID  |
| exam_date  | TEXT    | NOT NULL, DEFAULT date('now','localtime')                     | 考试日期 |
| type       | TEXT    | NOT NULL, DEFAULT '单元测', CHECK IN ('单元测','期中','期末') | 考试类型 |
| full_score | REAL    | NOT NULL, DEFAULT 100                                         | 满分     |
| remark     | TEXT    | NOT NULL, DEFAULT ''                                          | 备注     |
| created_by | INTEGER | REFERENCES users(id) ON DELETE SET NULL                       | 创建人   |
| created_at | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')                 | 创建时间 |

索引：`idx_exams_class (class_id)`、`idx_exams_date (exam_date)`

> ⚠️ `exams(course_id)` **无索引**（`011-teaching-consumption.js:24-25` 未建）。考试列表按课程筛选（`routes/exams.js:51`）会退化为全表扫描，属已知缺索引项，见上线评估报告 H11。

### exam_scores（考试成绩，v11 新增）

| 字段                    | 类型    | 约束                                                | 说明                        |
| ----------------------- | ------- | --------------------------------------------------- | --------------------------- |
| id                      | INTEGER | PK, AUTOINCREMENT                                   | 成绩 ID                     |
| exam_id                 | INTEGER | NOT NULL, REFERENCES exams(id) ON DELETE CASCADE    | 考试 ID（删考试级联删成绩） |
| student_id              | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE CASCADE | 学员 ID                     |
| score                   | REAL    | NOT NULL, CHECK >= 0                                | 分数                        |
| remark                  | TEXT    | NOT NULL, DEFAULT ''                                | 备注                        |
| created_at / updated_at | TEXT    | NOT NULL, DEFAULT                                   | 创建/更新时间               |

约束：`UNIQUE (exam_id, student_id)`（一考一成绩，批量录入冲突覆盖）
索引：`idx_exam_scores_student (student_id)`
（`exam_id` 未单独建索引，由 `UNIQUE (exam_id, student_id)` 的最左前缀隐式覆盖，`011-teaching-consumption.js:33-39`）

### hour_consumptions（课时消耗流水，v11 新增）

| 字段        | 类型    | 约束                                                | 说明                           |
| ----------- | ------- | --------------------------------------------------- | ------------------------------ |
| id          | INTEGER | PK, AUTOINCREMENT                                   | 流水 ID                        |
| student_id  | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE CASCADE | 学员 ID                        |
| order_id    | INTEGER | NOT NULL, REFERENCES orders(id) ON DELETE CASCADE   | 课时包订单 ID                  |
| course_id   | INTEGER | REFERENCES courses(id) ON DELETE CASCADE            | 课程 ID                        |
| class_id    | INTEGER | REFERENCES classes(id) ON DELETE CASCADE            | 班级 ID                        |
| date        | TEXT    | NOT NULL                                            | 考勤日期                       |
| hours       | REAL    | NOT NULL, DEFAULT 1                                 | 变动课时**绝对值，恒为正数 1**（方向由 `type` 字段表达，非符号） |
| type        | TEXT    | NOT NULL, DEFAULT '扣减', CHECK IN ('扣减','回补')  | 流水类型                       |
| operator_id | INTEGER | REFERENCES users(id) ON DELETE SET NULL             | 操作人                         |
| created_at  | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')       | 创建时间                       |

索引：`idx_hour_cons_order (order_id)`、`idx_hour_cons_student_date (student_id, date)`、`idx_hour_cons_course (course_id)`
（`011-teaching-consumption.js:56-58`。注意：**无**单独的 `idx_hour_cons_student` / `idx_hour_cons_date`，二者已由联合索引 `(student_id, date)` 覆盖）

### schedule_adjustments（调课申请，v12 新增）

| 字段                           | 类型    | 约束                                                          | 说明                                  |
| ------------------------------ | ------- | ------------------------------------------------------------- | ------------------------------------- |
| id                             | INTEGER | PK, AUTOINCREMENT                                             | 申请 ID                               |
| schedule_id                    | INTEGER | NOT NULL, REFERENCES schedules(id) ON DELETE CASCADE          | 原课表条目 ID（删课表条目级联删申请） |
| class_id                       | INTEGER | NOT NULL, REFERENCES classes(id) ON DELETE CASCADE            | 班级 ID（冗余便于统计与权限过滤）     |
| course_id                      | INTEGER | REFERENCES courses(id) ON DELETE CASCADE                      | 课程 ID                               |
| from_day_of_week / from_period | INTEGER | NOT NULL, CHECK BETWEEN 1 AND 7 / 1 AND 8                     | 原时段（提交时快照）                  |
| to_day_of_week / to_period     | INTEGER | NOT NULL, CHECK BETWEEN 1 AND 7 / 1 AND 8                     | 目标时段                              |
| reason                         | TEXT    | NOT NULL, DEFAULT ''                                          | 调课原因                              |
| status                         | TEXT    | NOT NULL, DEFAULT '待审批', CHECK IN ('待审批','通过','驳回') | 审批状态                              |
| apply_user_id                  | INTEGER | REFERENCES users(id) ON DELETE SET NULL                       | 申请人（teacher，仅本班课表可申请）   |
| approve_user_id                | INTEGER | REFERENCES users(id) ON DELETE SET NULL                       | 审批人（admin）                       |
| apply_time / approve_time      | TEXT    |                                                               | 申请 / 审批时间                       |
| created_at                     | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')                 | 创建时间                              |

索引：`idx_adj_status (status)`、`idx_adj_class (class_id)`、`idx_adj_schedule (schedule_id)`

### makeup_classes（补课登记，v12 新增）

| 字段                    | 类型    | 约束                                                     | 说明                           |
| ----------------------- | ------- | -------------------------------------------------------- | ------------------------------ |
| id                      | INTEGER | PK, AUTOINCREMENT                                        | 登记 ID                        |
| student_id              | INTEGER | NOT NULL, REFERENCES students(id) ON DELETE CASCADE      | 学员 ID                        |
| class_id                | INTEGER | NOT NULL, REFERENCES classes(id) ON DELETE CASCADE       | 班级 ID                        |
| course_id               | INTEGER | REFERENCES courses(id) ON DELETE CASCADE                 | 课程 ID                        |
| original_date           | TEXT    | NOT NULL                                                 | 原始缺勤 / 请假日期            |
| makeup_date             | TEXT    | NOT NULL                                                 | 补课日期                       |
| status                  | TEXT    | NOT NULL, DEFAULT '待安排', CHECK IN ('待安排','已完成') | 状态（已完成时联动扣减课时包） |
| remark                  | TEXT    | NOT NULL, DEFAULT ''                                     | 备注                           |
| apply_user_id           | INTEGER | REFERENCES users(id) ON DELETE SET NULL                  | 登记人                         |
| created_at / updated_at | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')            | 创建 / 更新时间                |

索引：`idx_makeup_student (student_id)`、`idx_makeup_status (status)`、`idx_makeup_date (makeup_date)`

### feedbacks（使用反馈，v16 新增）

| 字段                    | 类型    | 约束                                              | 说明                                                                              |
| ----------------------- | ------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| id                      | INTEGER | PK, AUTOINCREMENT                                 | 反馈 ID                                                                           |
| user_id                 | INTEGER | NOT NULL, REFERENCES users(id)                    | 提交人（员工账号）                                                                |
| username                | TEXT    | NOT NULL, DEFAULT ''                              | 提交人账号快照                                                                    |
| user_role               | TEXT    | NOT NULL, DEFAULT ''                              | 提交时角色（admin / teacher），用于定位「谁在什么角色下遇到问题」                 |
| category                | TEXT    | NOT NULL, DEFAULT '其他'                          | 分类：功能异常 / 操作不便 / 数据不准 / 性能问题 / 功能建议 / 其他；非法值回落「其他」 |
| content                 | TEXT    | NOT NULL                                          | 问题描述（5–2000 字）                                                             |
| page_path               | TEXT    | NOT NULL, DEFAULT ''                              | 出现问题时的页面路径（选填，最长 200 字符）                                       |
| status                  | TEXT    | NOT NULL, DEFAULT '待处理'                        | 处理状态：待处理 / 处理中 / 已处理 / 已忽略（后端白名单校验）                     |
| admin_reply             | TEXT    | NOT NULL, DEFAULT ''                              | 管理员回复（提交人可见）                                                          |
| handled_by              | INTEGER | REFERENCES users(id)                              | 处理人                                                                            |
| handled_at              | TEXT    |                                                   | 处理时间（改状态时写入）                                                          |
| created_at / updated_at | TEXT    | NOT NULL, DEFAULT datetime('now','localtime')     | 创建 / 更新时间                                                                   |

索引：`idx_feedbacks_status (status)`、`idx_feedbacks_user (user_id)`、`idx_feedbacks_time (created_at)`

> **数据边界**：只记录提交人身份与问题描述，**不落任何学员数据** —— 避免「反馈」成为绕过四层权限的数据出口。教师只能看自己的（`/api/feedback/mine`）；全量列表、统计与处理仅 admin。

## 辅助表

| 表名            | 说明                                     | 状态                     |
| --------------- | ---------------------------------------- | ------------------------ |
| users_backup_v1 | v2 迁移时生成的 users 快照（历史可回溯） | 可清理（后续版本可删除） |

## 数据关系

```text
users（员工账号，admin/teacher）──< user_oauth（多端绑定，预留）
users（员工账号）──< leaves.approved_by（审批人）
classes ──< students ──< attendances
courses ──< attendances
students ──< leaves（考勤↔请假双向联动，leaves.source 区分手动/考勤同步）
students ──< orders ──< payments（缴费）
students ──< orders ──< refunds（退费）
leads ──> students（转化建档，家长姓名/电话随档案写入）──< orders（报班）
students ──< notifications（考勤缺勤 / 成绩发布 / 请假审批通过，parent_name 快照留痕）
courses ──< exams ──< exam_scores ──> students（考试与成绩）
classes ──< exams（班级考试）
students ──< hour_consumptions ──> orders（课时消耗流水：考勤/补课扣减与回补逐笔留痕）
schedules ──< schedule_adjustments（调课申请，通过后同步更新课表时段）
students ──< makeup_classes（补课登记，完成时联动扣减课时包 + hour_consumptions 流水）
```

> v14 定位：**纯员工端 CRM**。学生/家长无账号、不登录；家长信息是学生档案字段（parent_name / parent_phone）；通知为内部留痕（家长姓名快照）。

## 初始账号（seed 自动生成，仅当 users 表为空时）

| 账号    | 密码          | 角色    | 说明   |
| ------- | ------------- | ------- | ------ |
| admin   | admin123456   | admin   | 管理员 |
| teacher | teacher123456 | teacher | 教师   |

> **出厂状态**：交付给客户前执行 `node server/scripts/reset-production-data.mjs --confirm`，
> 会清空全部业务数据并只保留 `admin` 一个账号（教师账号由客户自行创建）。
> 该脚本执行前会自动备份，且保留 `terms`（当前学期）与 `settings`（系统配置），
> 因为签到等功能依赖当前学期，清空会导致系统不可用。

## AI 配置相关表（v17 新增）

### ai_settings（AI 配置，优先级高于环境变量）

| 字段       | 类型 | 约束                     | 说明                                                     |
| ---------- | ---- | ------------------------ | -------------------------------------------------------- |
| key        | TEXT | PK                       | 配置键，取值受后端白名单约束（未知键写入时忽略）         |
| value      | TEXT | NOT NULL, DEFAULT ''     | 配置值；**空串或删除该行 = 回退到环境变量**              |
| updated_by | TEXT | NOT NULL, DEFAULT ''     | 最近修改人                                               |
| updated_at | TEXT | NOT NULL, DEFAULT ''     | 最近修改时间                                             |

可配置键：`llmApiKey`、`llmBaseUrl`、`llmModel`、`llmMaxTokens`、`llmReasoningEffort`、
`llmTimeoutMs`、`aiWorkbenchUrl`、`difyEndpoint`、`difyApiKey`、`difyWorkflows`。
敏感值（Key 类）**永不明文返回前端**，只给 `__masked__sk-****3f2a` 形式的掩码；
掩码原样回传表示「不修改」。

### ai_usage（AI 用量，配置中心展示本月用量与成本）

| 字段       | 类型    | 约束                 | 说明                                   |
| ---------- | ------- | -------------------- | -------------------------------------- |
| id         | INTEGER | PK, AUTOINCREMENT    | 记录 ID                                |
| username   | TEXT    | NOT NULL, DEFAULT '' | 生成人                                 |
| scene      | TEXT    | NOT NULL, DEFAULT '' | 场景（备课方案 / 学情报告 …）          |
| model      | TEXT    | NOT NULL, DEFAULT '' | 实际使用的模型                         |
| tokens_in  | INTEGER | NOT NULL, DEFAULT 0  | 输入 token                             |
| tokens_out | INTEGER | NOT NULL, DEFAULT 0  | 输出 token                             |
| cost       | REAL    | NOT NULL, DEFAULT 0  | 估算成本（元，高峰价，仅供量级参考）   |
| created_at | TEXT    | NOT NULL, DEFAULT '' | 生成时间；建索引 `created_at`          |
