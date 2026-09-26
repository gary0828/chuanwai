---
inclusion: fileMatch
fileMatchPattern: ["server/**", "docs/04-API/**"]
---

# 后端与数据（L2 · 主题）

> 深读：`docs/03-开发指南/后端与数据.md`、`server/database.md`（schema 权威）、
> `docs/04-API/API.md`（契约权威）。

## 技术底座

- Express 4 + **`node:sqlite`**（Node 内置，零原生编译）+ JWT 双 Token + bcryptjs
- 数据库版本 **v22**（2026-09-24 改名迁移后）；迁移是**单向**的（新代码可能依赖新列 → 降级必须同时还原程序与数据）
- 迁移文件 `server/src/migrations/0NN-*.js`，**版本号连续递增，跳号会导致启动终止**
- ★ 新增迁移必须先做**数据模型评审**（`.trae/skills/data-model-review`），
  产出 `server/docs/<版本号>-<功能名>-model-review.md` 且含「结论：通过」——
  否则 **pre-commit 钩子会拦住提交**
  （★ 注意：钩子只查**本次新加**的迁移文件是否配套评审；`015`–`019` 在 `server/docs/` 下**没有**对应评审文档，
  属历史欠账，**别拿它们当"不用写"的先例**。）

## 踩过的坑

- **K-005 · `node:sqlite` 裸封装没有 `.transaction()`**：照 better-sqlite3 的习惯写会报
  `is not a function`。本项目用的是自己封的 helper，别混用两套 API。
- **K-006 · WAL 与「删数据不落盘」**：删完不做 `wal_checkpoint` → **重启后数据复活**。
  改数据的脚本收尾要 checkpoint。

## 数据资产化（K-015 · ADR-008，用户拍板 D15）

> **系统是唯一数据源，也是唯一仓库** —— AI 产出的 PDF / PPT / 试卷等**文件不入库**，
> 只在库里放**索引**，文件落盘到 `server/data/assets/<kind>/`。
> ⇒ 备份与同步**必须整个 `server/data/` 目录**，只备 db 会把文件全丢掉；
> ⇒ nginx 新增 `kind` 时要同步加一条 `/assets/<kind>/` 反代。

## AI 能力架构（K-017 · ADR-007）

> **独立 AI 工作台 + 只读网关 + 最小权限凭证**，模型密钥**服务端代持**（不下发前端）。
> 网关前缀 `/api/agent/*`；大模型 Key 只在「AI 配置中心」页面（`/#/ai-admin`）配置，存库 `settings` 表，
> **不经 `.env` / compose 注入**（工程末位兜底的 `config.js` 环境变量仅作默认）。
> 出网前做二次脱敏。

## 图片上传：唯一判型实现（K-033 · 2026-09-23）

> ★ **`server/src/utils/image.js` 是项目里唯一的上传判型/落盘实现**，提供
> `sniffImage(buf)`（文件头魔数，忽略客户端声明的扩展名/MIME）、
> `saveImage({dir, prefix, buf, cleanup})`、`removeImage(dir, filename)`、`MAX_UPLOAD_BYTES`（2MB）。

- 现状使用者：站点 Logo / favicon（`routes/site-info.js`）、员工头像（`routes/auth.js`）。
  **新增任何上传一律复用它**，不要再写第二份魔数逻辑。
- 为什么抽出来：与 **413 事故同源** —— "同一件事写在多处，改的时候只改一处"。
  判型规则（允许哪些格式、多大、怎么命名、清旧文件）必须**一处定义**。
- 落盘约定：`express.raw()` 直收二进制（**不引 multer**）、文件名 `{prefix}-{时间戳}-{rand8}{ext}`、
  **不保留原名**（防路径穿越 / 中文兼容），写入后清理**同 prefix** 的旧文件。

## ★★ K-043 · 改枚举值：CHECK 对 UPDATE 同样生效，必须先建新表（2026-09-24）

> 场景：把 `class_sessions.status` 的 `'已调课'` 改名为 `'已挪课'`（v22 迁移）。
> 直觉写法「先 `UPDATE` 旧表把旧值改成新值，再重建表改 CHECK」**跑不通** ——
> 第一次 `UPDATE` 就撞上**旧表**的 CHECK：`CHECK constraint failed: status IN (...'已调课'...)`，
> 整个迁移事务回滚。

**正确做法：在 `INSERT INTO <new> SELECT` 时做值映射，建完再断言旧值残留为 0。**

```sql
INSERT INTO class_sessions_new (... status, origin ...)
  SELECT ...,
    CASE status WHEN '已调课' THEN '已挪课' ELSE status END,
    CASE origin  WHEN '调课'   THEN '挪课'   ELSE origin  END
  FROM class_sessions;
-- 建完立刻兜底断言（防 CASE 漏写枚举分支）
SELECT COUNT(*) FROM class_sessions WHERE status = '已调课';  -- 必须为 0
```

- 同理适用于任何「改 CHECK 枚举字面量」的迁移：**顺序永远是 建新表 → 拷贝时映射 → 换名 → 断言**。
- 迁移文件里**必须保留旧值字面量**（CASE 与断言都要用），所以 `grep 旧值` 命中迁移文件属**正常**，
  不要当"改得不干净"去清理 —— 历史迁移（如 004 / 021）同理属于史料，**禁止修改**。

## 员工自助能力（K-034 · v20，2026-09-23）

> ★ **自助端点一律挂在 `/api/auth/*` 下、只取 `req.user.id`** —— 不放在 `/api/users/*`。
> 原因：`/api/users` 整条路由被 `requireRole("admin")` 守着（员工管理），
> 把"改自己"混进去要么放不开权限、要么得给每个 handler 单独开口子；
> 分开放后**"自助"与"管理员代管"两条线天然隔离**，teacher 也能用。

| 端点 | 口径 |
|---|---|
| `PUT /api/auth/password` | 校验 `old_password` + 新密码 ≥8 位 + 新旧不得相同 → 更新后 **`revokeTokens(自己)` 强制重登**（与 H2 一致）；`users.js` 的 admin 重置他人密码**并存不变** |
| `PUT /api/auth/profile` | 只允许 `name` / `phone`；**`username` 与 `role` 一律忽略**（前者登录标识、后者权限边界）→ 已验证传 `role:"admin"` 提权无效 |
| `POST /api/auth/avatar` | 落盘 `data/assets/avatars/`，`users.avatar` **只存相对路径**（ADR-008）；文件名前缀 `avatar-{用户id}` → 清旧文件时**只删本人的** |

- **两处硬编码容易漏**：`avatar` 在 `auth.js` 的 `buildLoginData`（登录返回）与 `GET /info`（刷新后拉取）**各写一次**，
  只改一处会表现为「登录后头像生效、刷新后失效」。改这类"身份字段"必须 `grep` 全量写入点。
- **上传逻辑统一走 `image.js`**（见上方 K-033），不要再写第二份魔数。
- **文件 + DB 不是跨事务**：采用「先落盘、后写库」，失败最多留 1 个孤儿文件（不指向、下次同前缀上传必被清），
  见 `server/docs/020-员工头像-model-review.md` 工件 3。

## ★ K-044 · 菜单不是"一处配置"：`ROUTES` 是**按角色两套**（2026-09-26 重构时固化）

> 位置：`server/src/routes/auth.js` 的 `const ROUTES = { admin: [...], teacher: [...] }`，
> 由 `GET /api/auth/async-routes` 按 `ROUTES[req.user.role]` 下发（`auth.js` 文件末尾）。

**改菜单时必须同时改两套**，否则出现「admin 改了、teacher 没改」的错位。

- ★ **两套是独立内容**，不是"一份 + roles 过滤"：teacher 菜单**根本不含**财务 / 招生与报名 / 系统管理。
  → 因此 **admin 菜单项里写不写 `roles` 标记，跟 teacher 能不能看到毫无关系**（2026-09-26 曾据此误报一个"权限 bug"，见 `docs/08-参考/功能重复扫描与菜单重构方案-2026-09-24.md` §5 的更正）。
- ★ **子项 `path` 绝不能改**（它是路由地址，老师可能收藏）→ 改的是 `meta.title` 与 `children` 归属。
  已验证**父子 path 不需前缀匹配**：`getParentPaths` 存的是父级 path、`addAsyncRoutes` 不做路径拼接、
  子路由按绝对 path 独立注册 → 因此可把 `/data/schedules` 挂到名为 `/schedule` 的新分组下而路由不受影响。
- ★ **`rank` 必须唯一**：前端 `ascending()` 按 `meta.rank` 升序排，重复时顺序不确定（曾把 teacher 的
  考勤管理与新分组都写成 2）。改完用脚本核一遍 rank 集合大小。
- **同级分组控制在 ≤6 项**，超过就要重新想分类（本次重构就是因为「考勤管理 8 项」「数据管理 7 项」两个筐）。
- 单子项分组**不会以分组形态出现**（见 `frontend.md` K-048）。

## ★ K-045 · 出勤率**只有一个口径**（2026-09-26 统一）

> 唯一实现：`server/src/utils/attendance-rate.js` 的 `attendanceRate(total, absent)`。

- **口径**：`出勤率 = (总数 − 缺勤) / 总数`，**请假计入分母、且不计为缺勤**（请假不拉低出勤率）。
- ⚠️ **边界（极易记错）**：因 `总数 = 正常+迟到+早退+缺勤+请假`，故 `总数−缺勤` **含请假**
  → **出勤率 + 缺勤率 = 100%**；**请假率是与之重叠的独立维度，不能与两者相加**（95+5+10≠100）。
- **统一前是两个口径**：`attendance.js` 用上式，`analytics.js` 用 `实到/(总数−请假)` → 同一指标两处数字对不上
  （实测 total=100/absent=5/leave=10 → 95% vs 94.4%）。已统一，AI 工作台 `ai/engine.ts` 本来就与上式一致。
- **收口了 9 处**内联公式：`attendance.js`×6（含缺勤预警）、`reports.js`×1、`analytics.js`×1、`agent.js`×1（工作台出口）。
  **改口径只需改这一个文件**；发现别处又内联 `(total - absent) / total`，就是在重新制造分叉。
- ★ **口径字典也要同步**：`analytics.js` 的 `METRIC_DEFINITIONS` 与 `docs/04-API/API.md` 都描述了公式。
  字典与实现不一致时，**AI 会按错误口径解释数据**（比数字算错更隐蔽）。

## ★ K-052 · 删除保护必须覆盖**所有**外键引用：`CASCADE`/`SET NULL` 会**静默**破坏数据（2026-09-26 审计发现）

**问题模式**：写 `DELETE` 端点时只校验了"显眼"的关联，漏掉一两张表，
而这些表的外键是 `ON DELETE SET NULL` / `ON DELETE CASCADE` →
**删除成功、无任何提示**，但关联数据被改/被删，用户在几天后才发现数字不对。

**本项目实测三处**（详见 `docs/08-参考/功能做精审计-2026-09-26.md`）：

| 删除 | 漏检的表 | 外键行为 | 真实后果 |
|---|---|---|---|
| **课程** | `orders` / `teaching_assignments` | SET NULL / CASCADE | 订单 `course_id` 被置空 → **该订单的学员以后点名永不扣课时** |
| **学期** | `teaching_assignments` / `class_sessions` | CASCADE / SET NULL | 任课关系被级联删除、课次失去学期归属 |
| **订单** | `hour_consumptions` | CASCADE | 课消流水消失 → 课消收入凭空减少且不可追溯 |

**范本**：`server/src/routes/classes.js:164-182` —— 删班前把
学生 / 课表 / 考试 / 调课 / 补课 / 课消 **全查一遍**，命中即拒绝并说明原因。
**新写任何删除端点，照抄这个模式。**

**顺带**：后端已经算好的级联数量要**显示在前端确认框里**
（`students.js:396-417` 返回 `cascade`，但 `students/index.vue:330` 用的是写死文案 → 用户盲确认）。

**检查口诀**：写 `DELETE` 前先列出"谁指向我"——
```bash
grep -n "REFERENCES <表名>" server/src/migrations/*.js   # 或查 server/database.md
```
逐个看 `ON DELETE` 后面的行为：**CASCADE = 会删你数据；SET NULL = 会改你数据**，两者都必须拦或提示。

## 改持久化的自检

- [ ] 是否需要新迁移（版本连续、配套 model-review 文档）
- [ ] 是否触及权限边界（见 `docs/03-开发指南/权限模型.md`）
- [ ] 收入的唯一口径有没有被破坏（见 `docs/04-API/API.md`）
- [ ] 备份是否走 `VACUUM INTO`（见 `deploy.md` K-046；**不要**再用 `wal_checkpoint` + `copyFileSync` 那套）
