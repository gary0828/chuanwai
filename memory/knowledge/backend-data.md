---
inclusion: fileMatch
fileMatchPattern: ["server/**", "docs/04-API/**"]
---

# 后端与数据（L2 · 主题）

> 深读：`docs/03-开发指南/后端与数据.md`、`server/database.md`（schema 权威）、
> `docs/04-API/API.md`（契约权威）。

## 技术底座

- Express 4 + **`node:sqlite`**（Node 内置，零原生编译）+ JWT 双 Token + bcryptjs
- 数据库版本 **v25**（2026-10-03；`feature-dev-flow` §4.1 写基线 v25，注：`docs/00-导航.md` §6 仍写 v21是陈旧表述）；迁移是**单向**的（新代码可能依赖新列 → 降级必须同时还原程序与数据）
- ★ **`node:sqlite` 支持 FTS5**（2026-10-07 核实）→ 题库全文检索用 FTS5 虚拟表，
  **不引向量库**（遵 K-030：<1 万条时文件/SQL 方案更准且零基础设施）
- 迁移文件 `server/src/migrations/0NN-*.js`，**版本号连续递增，跳号会导致启动终止**
  > 执行器实现：`if (m.version !== current+1) throw` —— 跳号直接拒绝启动，不是警告。
  > 题库系统规划占用 **026–030**（questions / question_chapters / papers+paper_questions / attempts+attempt_answers / question_kp_stats）
- ★ 新增迁移必须先做**数据模型评审**（`.trae/skills/data-model-review`），
  产出 `server/docs/<版本号>-<功能名>-model-review.md` 且含「结论：通过」——
  否则 **pre-commit 钩子会拦住提交**
  （★ 注意：钩子只查**本次新加**的迁移文件是否配套评审；`015`–`019` 在 `server/docs/` 下**没有**对应评审文档，
  属历史欠账，**别拿它们当"不用写"的先例**。）

### 大模型调用（`server/src/utils/llm.js` · 2026-10-07 核实）

- **模型名无白名单**：`llm.js:79` 直接透传 `cfg.model`；`src/views/ai-admin/index.vue` 的模型名是**自由输入框**
  → **换模型（如切到 vision 模型）零代码改动**，只需在 AI 配置中心改一次
- 现役模型 `deepseek-v4-flash`（`ai-workbench/src/ai/provider.ts:51` 默认值）
- ★ **DeepSeek 于 2026-08-21 上线 `deepseek-v4-flash-vision-exp`**（官方标注为实验版）→
  **本项目从此具备图片识别能力**，支持 base64 / 外部URL / Files API 三种传图方式，
  单图 ≤384 tokens，与 V4-Flash **同价**（1 元/百万输入）。参考官方 `api-docs.deepseek.com/zh-cn/guides/vision/`
- **成本估算表** `PRICE_PER_MILLION` 只有 `deepseek-flash` 与 `deepseek-v4-pro` 两项，
  vision 模型会**落到默认值**（按 flash 计）—— 用vision 前需确认这个口径对不对
- Key 代持铁律（ADR-007）：Key 存`settings` 表 · 服务端调用 · **永不下发前端**

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

## ★ K-060 · 拿竞品参考时「别抓最亮眼的单个功能当系统骨架」（2026-10-07 真实连错两次）

**问题模式**：拿到一个竞品系统的截图/参考后，**抓它最显眼的那一个功能**当需求核心，
于是把「系统的入口」当成了「系统的目标」，越做越偏，用户连说两次方向错了。

本题实例（题库系统）：

| 版 | 我抓的 | 为什么错 |
| --- | --- | --- |
| v1 | Excel 批量导入 | 那是手工活，参考系统的价值恰恰是**不用手工** |
| v2 | **智能录题 / 录题效率** | 「智能录题」只是系统菜单里的**一个入口**，不是骨架 |
| v3 | ✅ **系统本身**（六子系统 + 闭环） | 按业务链重建后才看清全貌 |

**正确姿势**：
1. **先把竞品的菜单按业务链重排**，看它到底覆盖了哪条完整链路。
   本题真骨架：`录题 → 题库管理 → 组卷 → 试卷 → 作答 → 阅卷 → 错题 → 学情 → 沉淀回题库`
2. 区分**「手段」与「目的」**：录题效率是手段，「系统越用越准」才是目的（闭环）。
3. 识别「智能」的真正落点 = **数据回流**，不是某个 AI 功能。

**推广判据**：用户说「方向还是错了」而你只改了实现细节 → **大概率抽象层级错了**，
立刻回到「目的」层重问，**不要在手段层打转**（这是连续犯错的信号）。

**配套判据**：现有资产盘点要先做 —— 本项目 `ai-workbench/src/ai/engine.ts` 早已有 10 个分析函数
（含 `kpMasteryRanking` / `errorRanking`），只因**缺 `questions` 表**而无法回溯到具体题目。
→ 「缺一张表」比「缺一个功能」更常是真根因。

## ★ K-061 · 大模型「换模型」零代码改动（`llm.js` 透传 · 2026-10-07 核实）

- `server/src/utils/llm.js:79` **直接透传 `cfg.model`，没有模型白名单**；
  `src/views/ai-admin/index.vue` 的模型名是**自由输入框**。
  → **要接新模型（如多模态 vision）只需在 AI 配置中心改一次，不动代码。**
- 现役默认 `deepseek-v4-flash`（`ai-workbench/src/ai/provider.ts:51`）。
- ★ **DeepSeek 已于 2026-08-21 上线 `deepseek-v4-flash-vision-exp`**（官方标注实验版）→
  本项目从此具备图片识别能力，支持 base64 / 外部 URL / Files API 三种传图，
  单图 ≤384 tokens，与 V4-Flash **同价**（1 元/百万输入）。
- ⚠ `llm.js` 的 `PRICE_PER_MILLION` 只有 `deepseek-flash` 与 `deepseek-v4-pro` 两项，
  **vision 模型会落到默认值**（按 flash 计）—— 用前需确认这个成本口径是否符合预期。

## ★★ K-062 · LaTeX 与 JSON 打架：**降级式容错解析对「静默损坏」完全失效**（2026-10-07 返工 3 次）

**症状**：模型输出 `{"stem":"求 \frac{1}{2}"}`，代码 `JSON.parse` **成功返回**，但题干变成 `rac{1}{2}`（反斜杠消失）。

**根因**：`\f` / `\b` / `\t` 在字符层面**确实是合法的 JSON 转义**（form feed / 退格符 / 制表符）。
所以：
| LaTeX 命令 | JSON 解读 | 解析后 |
|---|---|---|
| `\frac` | `\f` + `rac` | `rac` ❌ |
| `\beta` | `\b` + `eta` | `eta` ❌ |
| `\times` | `\t` + `imes` | `imes` ❌ |

**★ 最关键的一层**：写「先试原样、失败再修复」的容错链**在这里完全无效** ——
原样那次就会**解析成功**，永远不会走到修复分支。
**判据：凡「解析成功但内容被静默改写」，就不能靠 fallback，必须在解析前无条件修一次。**

**正解**（`server/src/utils/qbank-ai-parse.js` 的 `fixBackslashes`）：
逐字符扫描，`\` 一律补一层，但保留 `\"` `\\` `\/` `\uXXXX` 四种已合法转义。
★ 扫描时**不要 `i += 1` 跳过 next** —— 早期版本跳了，导致 `\frac` → `\rac`（吞掉 f）。

**验证脚本**：`node server/scripts/test-ai-parse.mjs`（PASS 22 / FAIL 0，含「真JSON 转义不被破坏」反向用例）

**推广判据**：
1. 写任何「模型输出 → 结构化」的解析器，先问一句：**会不会解析成功但内容变错？**
2. 反向验证不能省：只测「正常输入」会漏，必须专门喂「合法但语义错」的输入。
3. 这是 **K-038（Vue 属性插值）、K-050（静默即缺陷）的同型病**：不报错，只在运行时表现为「东西不见了」。

## ★★ K-063 · KaTeX 的 `renderToString` **不认** `$...$` 分隔符（2026-10-07 UI 实证才发现）

**症状**：题干里写了 `$\alpha \in (0,\pi)$`，页面上显示**红色错误框或裸源码**，`.katex` 节点数 = 0。

**根因**：`katex.renderToString("$\\alpha$")` 报
`Can't use function '$' in math mode at position 1` ——
`$...$` 分隔符是 **katex/contrib/auto-render 扩展**的职责，`renderToString` 只吃**裸公式体**。
且 `throwOnError:false` 会把它渲染成 `.katex-error`（红框），**不抛异常** → 极易误判成「CSS 没生效」。

**正解**（`question-bank/src/katex.ts` 的 `renderLatex`）：
按 `/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g` 切片，**偶数段转义拼接、奇数段剥掉分隔符再渲染**。

**配套三条**：
1. `stemPreview()` 截断时**必须保留 `$`** —— 剥掉就再也渲染不出来了（会露出裸`\vec`）。
2. 「无裸露 LaTeX」断言**只能测 `.qb-question` 范围内**，
   不能测 `document.body` —— 输入框 textarea 里本来就有 LaTeX 源码（那是对的），会误报。
3. 用 Playwright 断言「**有 `.katex` 节点 + 全部非 0 宽高 + 内部 HTML 以 `<` 开头**」三重，
   单看「没泄漏源码」可能被「全被转义掉了」骗过。

★ **本项目最隐蔽的一类 bug 的又一次实例**：数据契约层 85 项全绿（含「LaTeX 原样存取」），
UI 层却一个公式都没渲染出来 —— **接口正确 ≠ 界面正确**（同K-038「只缺 UI 覆盖」的反面）。

## ★ K-064 · `parseText`/`parseNumber` 返回 `{ok, value}`，不是裸值

**踩坑**：直接 `parseText(body.stem, {...})` 的返回值绑进SQL →
`Provided value cannot be bound to SQLite parameter 2` → **接口 500，且错误信息完全指不到真因**（看起来像 SQL 问题）。

**正解**：项目既有范式是「先判 `ok` 再取 `.value`」（见 `routes/exams.js`）。
题库路由里包了一层 `text()` / `num()`（`routes/qbank.js`）省掉 13 处重复判断。

## ★★★ K-065 · JSON 列存了字符串后，**直接 `JSON.stringify` 回写 = 双重编码**（P0 数据损坏）

**症状**：老师只是「改一下难度」，却收到 `400 选择题至少需要 2 个选项`；重启后再改又报别的错。

**根因**：`row.options` 从 DB 读出来是 JSON **字符串** `'["甲","乙"]'`，
我直接 `JSON.stringify()` 写回 → `'"[\\"甲\\",\\"乙\\"]"'`。
**每 PUT 一次多包一层**，选项文本被污染且**不可逆**。

**正解**：`routes/qbank.js` 的 `normalizeOptions(stored, incoming, type)`
—— 先把「DB 字符串」与「请求数组」**统一成数组**，校验，最后一次性 stringify。
POST / PUT **共用同一个函数**（避免两套清洗逻辑漂移）。

**推广判据**：任何「表里存 JSON 列」的字段，
**读出来用之前必须先 parse、且只在一个地方 stringify**。
**回归断言**：连续 PUT 三次无关字段后，该列必须**逐字节不变**。

## ★★ K-066 · 相似度粗筛的探针**不能取归一化后的串**

**症状**：L2 近似查重永远返回 0 条（形同虚设），但算法单测是过的。

**根因**：粗筛用 `stem LIKE '%探针%'`，而探针取自 `normalizeStem(stem).slice(0,6)`。
归一化会**去掉空格与标点**，得到的串**不是原始 stem 列的子串** → 一条都匹配不到。

**正解**：`rawProbe(stem)` —— 取**原文**片段，且回退到最后一个非标点位置（`routes/qbank.js` 与 `routes/qbank-ocr.js` 各一份，**同款 bug 修了两处**）。

★ 这就是 `feature-dev-flow` 「横向同类扫描五问」的价值：修一处必然要 grep 找同类。

## ★★ K-069 · `el-dialog` 遮罩会拦截所有点击：Escape 也不是可靠关闭（2026-10-07 折腾11 轮）

**症状**：Playwright 点任何按钮都超时，报
`el-overlay-dialog subtree intercepts pointer events`。

**根因与三个错误尝试**：
| 尝试 | 为什么不行 |
|---|---|
| `keyboard.press("Escape")` |焦点不在对话框内时，Esc **不是**关闭语义 |
| 点遮罩关闭 | `.el-overlay` 自己会拦自己的点击 |
| 无条件 `document.querySelectorAll('.el-overlay').forEach(n=>n.remove())` | 会把**紧接着打开的新对话框**也删掉 → 下一步填表时 textarea 找不到 |

**正解**（`_verify_test/ui-full-qbank.py` 的 `_ensure_no_dialog`）：
1. 先对**可见**的 `.el-dialog` 点它自己的「取消」按钮（JS click）；
2. 等动画；
3. 兜底**只移除仍有可见对话框的** overlay：
   ```js
   const vis = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent !== null);
   vis.forEach(d => (d.closest('.el-overlay') || d).remove());
   ```
4. ★ 必须在**打开新对话框之前**调用（它是「清场」，不是「关对话框」）。

**推广**：任何「上一个 modal 可能还开着」的测试步骤前，都要先清场 —— 否则后续全部断言都会被这一个问题污染成假失败。

## ★★ K-070 · Element Plus 的 `el-select` 在无头浏览器里面板始终 `offsetParent === null`

**症状**：`.el-select-dropdown` 的 `offsetParent` 全是 `null` → Playwright 判定「不可见」→拒绝对选项 `click()`。
另外**非 filterable 的 select，其 `input` 是 `readonly`，不能 `type()`**。

**正解**：不点选项，改用 **JS 直接点面板里的选项**（按选项文本特征定位面板，避开同名项）：
```js
const panels = [...document.querySelectorAll('.el-select-dropdown')];
const hit = panels.find(p => {
  const items = [...p.querySelectorAll('.el-select-dropdown__item')].map(n => n.innerText.trim());
  return items.includes('自编') && items.includes('授权题库');  // ★ 用特征集，别用单项
});
const opt = [...hit.querySelectorAll('.el-select-dropdown__item')].find(n => n.innerText.trim() === '自编');
opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
```
★ **必须用「特征集」而不是单个文本**：页面里有多个 select，选项文本会重名（如「自编」在来源与自定义里都有）。

★ **取值要按 label 精确定位**：`document.querySelector('.el-dialog .el-select input')` 拿到的是**第一个** select（可能是「状态」而不是「来源」）→ 读出来永远是「草稿」，看起来像"没选中"。正确写法：
```js
const hit = [...document.querySelectorAll('.el-form-item')].find(el =>
  el.querySelector('.el-form-item__label')?.innerText.trim() === '来源');
```

## ★★ K-071 · 跨语言嵌代码的转义地狱只有解法：别在一个语言里嵌另一个语言

**症状**：Python 脚本里的 JS 字符串报 `SyntaxError: Invalid regular expression: missing /`。
根因：想写 JS 正则 `/\s+/g`，在 Python 三引号字符串里需写成 `/\\s+/g`，再经 JS 解析…

**正解**：把 JS 抽成**独立 `.js` 文件**，用 `page.add_script_tag(path=...)` 注入。
（`_verify_test/toast-capture.js` 就是这么做的，且已加上 rAF 轮询兜底 —— MutationObserver 单独用会漏掉 toast。）

**推广判据**：只要在测试脚本里出现 `evaluate("""...正则...JS...""")`，就该立刻抽文件。

## ★★ K-072 · 过滤「正整数」不等于「校验存在性」

**症状**：`POST /questions { kp_ids: [99999] }` 返回成功，且 `99999` 被原样存进 `questions.kp_ids`。

**后果**：这道题**永远不出现在任何知识点视角里**（`json_each` 反查找不到这个 id），老师以为题丢了；库里还躺着指向不存在实体的脏数据。
**对照**：`chapter_id` 有真外键约束 → 不存在直接 400。**两处口径本该一致，前端却一个拦一个不拦。**

**正解**（`routes/qbank.js` 的 `filterExistingKpIds`）：先洗成去重的正整数，再查 `knowledge_points` 实际存在的 id，最后只保留存在的。
★ POST 与 PUT **两处都要改**（横向同类扫描）。

## ★★ K-077 · 多学科：`course_id` 的横向覆盖 + 三个易漏点（2026-10-07）

**背景**：用户要求「不能只有一个学科」→ 建 **23 门学段学科**（小学5 / 初中9 / 高中9）+ 126 个知识板块。
架构决策：**复用教务的 `courses` 表**（已被 15 张表引用），不新建题库专属学科表 —— 否则两套学科必然分叉。

### 三个易漏点（都是实测踩到的）

**① 列表 SELECT 要返回 `course_id`**
   加了过滤条件但忘了在 SELECT 里带上该字段 → 前端无法标记题目归属、
   验证脚本也读不到（`undefined`）。**过滤与返回是两件事，都要做。**

**② 查重有**两处独立实现**
   `routes/qbank.js`（录入前查重）与 `routes/qbank-ocr.js`（识别后顺手查重）。
   我只改了前者 → 物理题会被告知"与数学题重复"。
   **横向扫描（grep 所有 `FROM questions`）才发现。**

**③ 校验顺序：先入参、后依赖**
   OCR 端点的学科校验原来在 `llm.isConfigured()` **之后** → 没配 Key 时返回 **503**，
   把「你没选学科」这个更基础的错误盖掉，老师会去翻 AI 配置。
   **入参错误（400）必须先于依赖检查（503）** —— 这条在 generate 端点已修过一次，
   recognize 端点又犯（同型问题的横向遗漏）。

### 参数顺序陷阱
`buildQuestionFilter` 里条件的**追加顺序**决定了 `?` 与 `.all(...)` 的对应关系。
查重 L2 的学科条件插在 `stem LIKE ?` **之前** → 参数也要插在 LIKE 参数之前，
写错会静默匹配错列（不报错，只是查得不对）。

