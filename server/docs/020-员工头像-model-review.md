# v20 员工头像与个人中心（自助改密码 / 改资料 / 上传头像）数据模型评审

- 日期：2026-09-23
- 变更类型：**加字段**（`users.avatar`）+ 新增 3 个自助端点（无新表、无新外键、无删除逻辑变更、无状态流转）
- 结论：通过

## 背景与必要性

来源：`docs/07-架构与决策/ROADMAP.md` §6「内容清点待办」的 **C3（P1）** 与 **C2（P2）**。

- **C3**：`users` 只有 `PUT /api/users/:id/password`（`requireRole("admin")`），**系统内不存在任何自助改密端点** → 老师改密码必须找管理员，与「上线必改默认口令」的安全要求直接冲突。
- **C2**：`users` 表**无 `avatar` 字段**，`routes/auth.js` 在 `buildLoginData` 与 `GET /api/auth/info` **两处硬编码 `avatar: ""`**，前端空值回落内置静态图 → 全链路（表 → 接口 → UI）缺失。

必要性：均为**员工端硬伤/全链路缺失**，非重复建设；复杂度低（1 个字段 + 3 个端点 + 1 个页面）。
用户 2026-09-23 逐项拍板（4 项决策全部采纳推荐值），范围与非目标见 ROADMAP §七之二。

## 1. 数据模型变更单

| 表 | 字段 | 类型 | NULL | 默认值 | CHECK | 外键(ON DELETE) | 唯一索引 |
|---|---|---|---|---|---|---|---|
| users | avatar | TEXT | NO | `''` | - | - | - |

- **语义**：头像**相对路径**（如 `/assets/avatars/avatar-3-20260923...png`）；空串 = 未上传 → 前端回落内置占位图（不写"默认头像"，避免给每个存量员工写假数据）。
- **不存二进制**：文件本体落盘 `server/data/assets/avatars/`，符合 ADR-008（DB 只存索引）。**无新增外键、无新增索引**（头像不参与任何查询条件）。
- 存量数据：`ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT ''` → 既有员工自动得空串，**不需要数据回填**，迁移不重写 `users` 表。

## 2. 数据源归属表

| 字段 | 唯一写入口（表+接口） | 消费方（只读） | 是否冗余 | 冗余同步时机 |
|---|---|---|---|---|
| users.avatar | `POST /api/auth/avatar`（**本人**） | 顶栏头像（前端 `store.avatar`）、员工管理页列表、登录返回体、`GET /api/auth/info` | 否 | - |
| users.name / users.phone | `PUT /api/auth/profile`（本人）与 `PUT /api/users/:id`（admin 改他人） | 顶栏昵称、员工列表、班级联系人 | 否 | - |
| users.password_hash | `PUT /api/auth/password`（本人，**校验原密码**）与 `PUT /api/users/:id/password`（admin 重置他人） | 登录校验 | 否 | - |
| users.token_version | `revokeTokens()`（登出/改密/改角色调用） | `middleware/auth.js` 鉴权比对 | 否 | - |

> **关于「两个写入口」**：上表三行各有两个写入口，但**都不构成双数据源** —— 写的是**同一张表的同一列**，不存在副本与同步问题；区别仅在**谁能写谁**（本人 vs admin），由 `requireRole` 与"只取 `req.user.id`"共同保证边界（自助端点不接受任何 `id` 参数）。冲突面仅剩"同一账号并发写同一列"（后写胜出），属可接受。

## 3. 跨模块联动清单

| 触发方（接口+动作） | 目标方（表+字段） | 方向 | 反向补偿 | 幂等性 | 事务边界 |
|---|---|---|---|---|---|
| `PUT /api/auth/password` 自助改密 | users.password_hash + **users.token_version 递增**（`revokeTokens`） | 单向 → | **无（刻意的）**：安全性变更不需要"撤销改密"；改回原密码即等价反向 | 天然幂等：改后原密码失效，「新旧不得相同」拦截原地重复 | 两条 UPDATE 连续执行（同一请求内，`node:sqlite` 单连接串行） |
| `PUT /api/auth/profile` 自助改资料 | users.name / users.phone | 双向（可反复改） | 再改一次即恢复 | 幂等（同值 UPDATE 无副作用）；手机号 UNIQUE 冲突 → 400 且不落库 | 单条 UPDATE |
| `POST /api/auth/avatar` 上传头像 | users.avatar + **磁盘** `data/assets/avatars/avatar-{id}-*.ext` | 单向 → | **有**：`saveImage({cleanup:true})` 删除**同一用户前缀**的旧文件 → 磁盘上该用户恒为 1 张 | 幂等：重复上传生成新文件名并清旧，最终仍 1 张 | ★ **非跨事务（声明取舍）**：文件系统不参与 DB 事务 → 采用「**先落盘、后写库**」；极端情况下 DB 写失败会留 1 个孤儿文件，但**不指向、不影响读**，且**下一次上传必被同前缀清理**兜住 |
| 删除员工 `DELETE /api/users/:id` | 磁盘头像文件 | — | ⚠ **本次未做**：现有删除保护（班主任 / 审计 / 公告）仍在，但删号时**不清理**其头像文件 → 已识别为遗留项（见下方「未通过项」外的改进项） | - | - |

## 4. 删除影响矩阵

| 删除对象 | 级联清理（表） | 应保护（RESTRICT，原因） | 断言 |
|---|---|---|---|
| users | user_oauth（CASCADE）；磁盘头像文件 ⚠ **待补** | 班主任 / 审计记录 / 发布过公告（既有，防止留痕断链） | `verify-profile.mjs` 覆盖"上传后旧文件被清理" |
| 头像文件（同一用户重新上传） | 同前缀旧的 `avatar-{id}-*` 文件 | - | `verify-profile.mjs`：目录内该用户文件数 = 1 |

## Gate 检查结果

| Gate | 结果 | 说明 |
|---|---|---|
| G1 唯一数据源 | ✅ | 三个字段均单一来源（无副本、无冗余同步）；"两个写入口"写同一列，边界由 `requireRole` + 只取 `req.user.id` 保证 |
| G2 单事务 | ✅ | 改密两条 UPDATE 在同一请求内串行；改资料单条 UPDATE；头像为「文件 + DB」两步，**已显式声明非事务 + 补偿路径**（先落盘后写库 + 同前缀清理），不掩盖 |
| G3 状态机成对 | ✅ | 头像上传有反向补偿（删旧文件）；改密为单向安全操作，**刻意不设反向**并说明理由 |
| G4 删除影响矩阵 | ✅ | users 删除路径已列明；**新识别出"头像文件孤儿"一项**，记为遗留项而非隐瞒 |
| G5 联动幂等 | ✅ | 上传幂等（恒 1 文件）、改密幂等（原密码校验 + 新旧相同拦截）、改资料幂等 |
| G6 版本化迁移 + 文档 | ✅ | `server/src/migrations/020-user-avatar.js`（**版本连续** v19 → v20，含 `foreign_key_check` 收尾）；`server/database.md` 已加字段行与 v20 版本行 |
| G7 e2e 覆盖 | ✅ | 本次**不涉及业务联动 / 统计口径 / 收入口径**，故 `e2e-lifecycle.mjs` 无需新增阶段；新增专项验证 `_verify_test/verify-profile.mjs`（**双角色对照**：26 项）+ `_verify_test/ui-profile.py`（23 项） |

## 未通过项与修复要求

无（G1–G6 全通过）。

## 改进项（已识别，未纳入本次范围）

| # | 事项 | 说明 | 归属 |
|---|---|---|---|
| I1 | 删除员工时清理其头像文件 | `DELETE /api/users/:id` 目前只删库行，磁盘 `avatar-{id}-*` 留存（≤2MB/人）。影响面小（删号本身已被审计/公告/班主任保护拦住多数场景），但属真实的孤儿文件来源 | 待用户拍板 → `docs/07-架构与决策/ROADMAP.md` |
| I2 | 头像"恢复默认"（清空） | 本次边界明确不做；若要支持，需新增"清空头像 + 删文件"端点 | 待用户拍板 → ROADMAP |

## 实现记录

- 迁移版本：**v20**（`020-user-avatar.js`），本地统一入口启动日志实测 `[migrate] 数据库已升级到 v20（员工头像（users.avatar））`
- 公共实现抽取：`server/src/utils/image.js`（魔数判型 + 落盘 + 清旧文件），`routes/site-info.js` 改为复用（消除两处判型逻辑漂移）
- 验证脚本与结果：
  - `_verify_test/verify-profile.mjs` → **PASS 26 / FAIL 0 / SKIP 1**（双角色：teacher 自助可用 + teacher 被拒 admin 端点）
  - `_verify_test/ui-profile.py` → **PASS 23 / FAIL 0**（admin 与 teacher 各走一遍：入口→页面→改名顶栏联动→头像顶栏联动→改密错误原密码被拒→无 JS 报错；另测员工管理页头像列）
  - `_verify_test/check-openapi.mjs` → 契约 59 路径 / 93 个 `$ref` 全解析（并修正该脚本的路径漂移：`docs/openapi.yaml` → `docs/04-API/openapi.yaml`）
- 关联：`docs/07-架构与决策/ROADMAP.md` §七之二 · `docs/04-API/API.md` · `docs/04-API/openapi.yaml` · `server/database.md`
