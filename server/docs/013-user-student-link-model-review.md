# 013 统一用户与联动（账号档案关联/考勤请假联动/删除保护）数据模型评审

- 日期：2026-08-14
- 变更类型：加字段 / 跨模块联动 / 删除逻辑 / 状态流转
- 结论：通过

## 1. 数据模型变更单

| 表 | 字段 | 类型 | NULL | 默认值 | CHECK | 外键(ON DELETE) | 唯一索引 |
|---|---|---|---|---|---|---|---|
| students | user_id | INTEGER | YES | - | - | 无（逻辑关联 users.id） | UNIQUE（账号↔档案一对一） |
| leaves | source | TEXT | NO | '手动' | IN ('手动','考勤同步') | - | - |
| notifications | type | - | NO | '考勤缺勤' | IN ('考勤缺勤','成绩发布','请假审批通过')（重建表） | - | - |
| settings | term_id | - | - | - | - | - | 删除（僵尸键，与 terms.is_current 双数据源） |

## 2. 数据源归属表

| 字段 | 唯一写入口 | 消费方（只读） | 是否冗余 | 冗余同步时机 |
|---|---|---|---|---|
| students.user_id | 迁移 013 / users.js / students.js（同事务建账号+回填） | users.js 列表 JOIN、reports | 否 | - |
| students.phone | students（档案） | - | 收敛：users.phone 不再复制学生手机号 | v13 迁移后由档案为唯一来源 |
| terms.is_current | terms 接口 | 学期筛选 | 是 | settings.term_id 已删除，is_current 为唯一当前学期数据源 |

## 3. 跨模块联动清单

| 触发方 | 目标方 | 方向 | 反向补偿 | 幂等性 | 事务边界 |
|---|---|---|---|---|---|
| attendance/batch 标记「请假」 | leaves 生成同步单(source=考勤同步) | 正向 | 考勤改回其他状态 → 删除同步单（待审批/已通过）+ 撤销「请假审批通过」通知 | 已有任意来源待审批/通过单覆盖日期则不重复生成 | 同事务 |
| leaves 审批「通过」 | attendances 回写请假 + orders 回补课时 + notifications 通知家长 | 正向 | 考勤改回正常 → 重扣课时 + 删通知 + 删同步单 | 重复审批拒绝（仅待审批可审批） | 同事务 |
| leaves 审批「驳回」 | attendances「请假」→「缺勤」 | 正向+补偿 | 缺勤不扣课时（与请假一致，课时留给补课） | 重复审批拒绝 | 同事务 |
| 线索转化 | students 建档案 + users 建 student/parent 账号 + parent_children 绑定 + orders 建单 | 正向 | 删除学生级联清理；已转化线索禁止删除 | 手机号/学号已存在则复用账号 | 同事务 |
| students 转班 | orders.class_id 跟随 | 正向 | 无（历史考勤按原班级保留） | - | 同事务 |
| 学生删除 | users(student) 账号级联删除 | 正向 | 有订单 → 400 保护 | - | 同事务 |

## 4. 删除影响矩阵

| 删除对象 | 级联清理 | 应保护（RESTRICT，原因） | e2e 断言 |
|---|---|---|---|
| students | attendances / leaves / makeup_classes / hour_consumptions / notifications / parent_children / exam_scores / users(student 账号) | orders（有报班/缴费/退费记录禁止删） | 阶段6.2/6.3 |
| orders | payments / refunds / hour_consumptions | 有缴费/退费记录禁止删（保护资金历史） | 阶段6.1 |
| classes | 学生/课表/考试/调课/补课/课时流水任一存在禁止删 | 全部保护 | 阶段6.5 |
| courses | 考勤/课表/考试/课时流水任一存在禁止删 | 全部保护 | 阶段6.4 |
| leads | 已转化禁止删除 | 已转化/已流失 | 阶段6.3 |
| schedules | 有已通过调课历史禁止删 | 调课记录 | 阶段9.6 |
| makeup_classes | 已「已完成」删除时先回补课时再删 | - | 阶段9.4 |

## Gate 检查结果

| Gate | 结果 | 说明 |
|---|---|---|
| G1 唯一数据源 | ✅ | students.user_id 一对一；settings.term_id 僵尸键已清理 |
| G2 单事务 | ✅ | 所有跨模块写均 BEGIN/COMMIT 包裹 |
| G3 状态机成对 | ✅ | 考勤↔请假双向联动 + 驳回补偿（G11 补齐反向缺口） |
| G4 删除影响矩阵 | ✅ | 见上文矩阵，历史业务表全部保护 |
| G5 联动幂等 | ✅ | 同步单去重、通知幂等、补课状态机防重 |
| G6 版本化迁移 + 文档 | ✅ | 013-user-student-link.js + 本文件 + database.md v13 |
| G7 e2e 覆盖 | ✅ | 阶段10 考勤↔请假双向联动、阶段6 删除语义、阶段9 排课 |

## 实现记录

- 迁移版本：v13（013-user-student-link.js）
- e2e：阶段 10（考勤↔请假双向联动）、阶段 6（删除语义）、阶段 9（排课联动）
- 追认说明：v13 为历史修复，本评审为提交前补写追认记录
