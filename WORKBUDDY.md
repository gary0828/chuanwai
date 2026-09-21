# WORKBUDDY.md · 教务管理系统 项目规则（Agent 开发约束）

> 本文件是 Agent 在本仓库工作时的**最高优先级规则**。每次会话开始必须通读本文件 + `docs/项目地图.md`。
> 生成时间：2026-09-11 ｜ **事实基线最后校准：2026-09-21** ｜ 数据库版本：**v18** ｜ 回归基线：全页面巡检 28/28 · e2e 80/80 · analytics 22/22 · 浏览器 P0 31/31 · Docker 9/9 · 业务链 49/49（全绿）
>
> **推进顺序（2026-09-20 用户拍板）：教务系统闭环优先于一切新功能。**
> AI 工作台是下一步计划，开工前须先收集校区老师真实使用意见；教务系统的「逻辑不顺畅 / 数据不通 / 关联做不好」优先修。

---

## 〇、pure-admin 官方规范（最高优先级）

本项目基于 **pure-admin-thin** 官方模板开发。**所有前端开发必须严格遵循 pure-admin 官方文档和代码规范，不得自行发明轮子、不得偏离官方推荐的写法、不得随意修改框架核心文件。** 遇到不确定的写法，先去官方文档查证，再动手写代码。

### 0.1 官方文档入口

| 文档 | 地址 | 用途 |
|------|------|------|
| 官方文档首页 | https://pure-admin.cn/ | 所有指南的入口 |
| 路由和菜单 | https://pure-admin.cn/pages/routerMenu/ | 路由配置、菜单配置规范 |
| RBAC 权限 | https://pure-admin.cn/pages/RBAC/ | 页面级 / 按钮级权限配置 |
| HTTP 请求 | https://pure-admin.cn/pages/httpRequest/ | axios 封装、接口调用规范 |
| 目录结构 | https://pure-admin.cn/pages/directoryStructure/ | 项目目录规范 |
| 打包部署 | https://pure-admin.cn/pages/buildDeploy/ | Docker / nginx 部署规范 |

### 0.2 必须遵守的开发规范

#### A. 路由与菜单

- 路由配置必须遵循官方 `RouteConfigsTable` 接口定义，包含 `path`、`name`、`meta` 等字段。
- `name` 必须唯一，且与组件页面中 `defineOptions` 的 `name` 保持一致。
- 菜单权限通过路由的 `roles` 配置项控制，页面级权限通过 `meta.roles`，按钮级权限通过 `meta.auths`。
- 静态路由写在 `src/router/modules/` 下，动态路由由后端返回，前端通过 `filterNoPermissionTree` 自动过滤无权限菜单。
- **禁止**在 template 中使用 `$route` 和 `$router`，必须使用官方推荐的 `useRoute` / `useRouter` 组合式 API。

#### B. 接口封装（src/api/）

- 所有接口必须放在 `src/api/` 目录下，按业务模块分文件。
- 必须使用官方 `http` 封装（`import { http } from "@/utils/http"`），禁止直接使用 axios。
- 每个接口必须定义返回类型（如 `UserResult`），使接口拥有良好的类型推导。
- 接口命名规范：`getXxx` / `addXxx` / `updateXxx` / `deleteXxx`。
- 调用方式：`http.request<返回类型>("方法", "路径", { data/params })`。

```typescript
// 正确写法示例
import { http } from "@/utils/http";

export type StudentResult = {
  success: boolean;
  data: {
    id: number;
    name: string;
    classId: number;
    parentName: string;
    parentPhone: string;
  };
};

export const getStudentList = (params?: object) => {
  return http.request<StudentResult>("get", "/api/students", { params });
};
```

#### C. 状态管理（Pinia）

- 使用 Pinia 进行状态管理，遵循官方模块化设计。
- 已有核心 store：`user`（用户信息/角色/Token）、`app`（应用状态）、`permission`（路由权限）、`multiTags`（标签页）、`epTheme`（主题）、`settings`（配置）。
- 新增业务状态优先考虑放到对应 store 中，或新建独立 store 文件，**禁止**在组件内创建全局状态。
- 持久化使用官方 `storageLocal` 封装，禁止直接操作 localStorage。

#### D. 组件使用

- **优先使用** pure-admin 内置组件（如 `@pureadmin/table`、`ReIcon`、`ReDialog`、`ReAuth` 等），不要重复造轮子。
- 表格统一使用 `@pureadmin/table`，支持 `cellRenderer` / `headerRenderer` 自定义渲染。
- 弹窗 / 抽屉统一使用官方 `ReDialog` / `ReDrawer` 封装，不要直接用 Element Plus 的 `ElDialog`。
- 图标使用 `ReIcon` 组件或 `useRenderIcon` 工具函数。
- 按钮级权限使用 `ReAuth` 组件或 `v-auth` 指令。

#### E. 样式规范

- 使用 **TailwindCSS** 进行样式编写，遵循功能类优先原则。
- 禁止写大段自定义 CSS，优先用 Tailwind 类名。
- 需要覆盖 Element Plus 样式时，使用官方主题变量或 `:deep()`。
- 响应式布局使用 Tailwind 断点类（`sm:` / `md:` / `lg:` / `xl:`）。

**视觉规范（2026-09-18 全站改版后新增，优先级等同于官方规范）**

全站视觉规范见 `docs/前端视觉规范-2026-09-18.md`，设计意图见根目录 `.impeccable.md`。四条硬性约束：

1. **颜色 / 间距 / 圆角 / 阴影 / 动效时长一律引用 `src/style/tokens.scss` 的变量**；页面内禁止出现硬编码色值（`#xxxxxx` 即为缺陷）。
2. **`src/style/element-plus-override.scss` 的引入位置不可挪动** —— 它必须在 `element-plus/dist/index.css` **之后**引入（见 `src/main.ts`）。Element 官方规则与本文件大多同特异性，本文件靠「后加载」取胜；一旦挪到前面就会被覆盖，只能靠堆 `!important` 补救。
3. **变量覆盖统一用 `html:root`**（而非 `:root`），深色覆盖用 `html.dark:root`（特异性更高，不受加载顺序影响）。
4. **页面骨架统一**：`.app-page` 根容器 + `AppPageHeader` 页头 + `.page-card(--flush)` 内容卡 + `.page-toolbar` 筛选条；空状态用 `AppEmpty`（文案须说清「为什么空 / 下一步做什么」）；数字列加 `.num` 并右对齐；弹窗宽度用 `min(480px, calc(100vw - 32px))` 形态，避免窄屏溢出。

#### F. 环境变量

- 所有自定义环境变量必须以 `VITE_` 开头。
- 环境文件放在项目根目录（`.env` / `.env.development` / `.env.production`）。
- 常用变量：`VITE_PORT`（开发端口，默认 8848）、`VITE_CDN`、`VITE_ROUTER_HISTORY`。
- 修改环境变量后必须重启开发服务器。

#### G. 代码质量

- 项目已配置 ESLint + Prettier + Stylelint + commitlint。
- 提交前必须通过 `pnpm lint`（ESLint 检查 + 自动修复）。
- 提交信息遵循 commitlint 规范：`feat:` / `fix:` / `docs:` / `style:` / `refactor:` / `test:` / `chore:`。
- 禁止绕过 lint 检查提交代码。

### 0.3 禁止事项

- **禁止**修改 `src/router/index.ts`、`src/store/modules/user.ts` 等框架核心文件，除非官方文档明确说明可以修改。
- **禁止**删除或覆盖 `src/utils/http/` 下的封装逻辑。
- **禁止**在业务代码中直接引入 axios、直接操作 localStorage、直接使用 `$route` / `$router`。
- **禁止**自行发明新的路由 / 权限 / 接口封装方式，必须使用官方提供的机制。
- **禁止**在未查阅官方文档的情况下凭记忆写 pure-admin 相关代码。

### 0.4 遇到不确定时的处理流程

1. 先查官方文档：https://pure-admin.cn/
2. 查不到 → 查官方 GitHub 仓库的示例代码（`src/views/` 下的官方页面）
3. 还没有 → 查 `@pureadmin/utils` 工具库是否已有现成函数
4. 都没有 → 在 `docs/PROGRESS.md` 中记录问题，选择最接近官方风格的方案实现，**不要自己发明**

### 0.5 本项目的规范落地判定（实测结论，勿重复踩坑）

以下结论来自对官方文档 / 官方仓库源码的实际核查，作为本项目对 §0.2 的**可执行解释**：

| 规范条目 | 官方实际设计意图 | 本项目采用的做法 |
| --- | --- | --- |
| `ReDialog` / `ReDrawer` | ReDialog 是基于 Element Plus Dialog 二次封装的**函数式弹框**（`addDialog({...})` + `contentRenderer`），官方用于「逻辑解耦 / 状态隔离 / 可复用表单」。官方 `src/views/components/dialog/` 是函数式用法示例。 | **函数式弹窗（从 JS 触发、内容由渲染函数生成）必须用 `addDialog` / `ReDialog`**；模板内与 `v-model` 绑定的简单表单弹窗沿用 `<el-dialog>`（Element Plus 原生用法）是允许的，但**新增**的复杂弹窗优先按函数式 `ReDialog` 写。`src/components/ReDialog/index.vue` 框架组件**禁止改动**。 |
| `http` 封装 | 统一走 `src/utils/http`，禁止直接 axios。 | 全部接口集中在 `src/api/*.ts`，`src/views/**` 内**零** axios / 零 `http.request` 直调。 |
| `$route` / `$router` | 组合式 API 优先。 | `src/views/**` 内**零** `$route` / `$router` / `localStorage` 直用。 |
| `@pureadmin/table` | 表格统一用官方表格组件。 | 列表页沿用当前实现；**新增**列表页必须用 `@pureadmin/table`，支持 `cellRenderer`。 |
| 环境变量 | 必须以 `VITE_` 开头。 | 已全部合规（`VITE_PORT` / `VITE_PUBLIC_PATH` / `VITE_ROUTER_HISTORY` / `VITE_CDN` / `VITE_COMPRESSION`）。 |

---

## 一、项目背景

> **功能特性、技术栈、部署方式、默认账号、API 一览 → 见 `README.md`，此处不重复。**
> 本节只保留 AI 干活时高频需要、且 README 里查不到的事实。

- **定位**：培训机构**纯员工端 CRM**（admin / teacher 两种角色；学生、家长无账号、不登录）。
- **数据库**：当前 **v18**（v16 使用反馈 / v17 AI 配置中心 / v18 学生成长时间轴），权威 schema 文档 `server/database.md`，迁移脚本 `server/src/migrations/`。
- **测试**：`server/scripts/e2e-lifecycle.mjs`（**80 项**）；另有 `analytics-smoke.mjs`（22 项）、`ui-p0-verify.py`（31 项）、`docker-verify.sh`（9 项）、`_verify_test/verify-all-pages.py`（**28 项**，改路由/菜单后必跑）、`_verify_test/probe-business-chain.mjs`（49 项）。
- **默认账号**：`admin / admin123456`、`teacher / teacher123456`。

## 二、关键时间约束（最高优先级）

用户**下周将正式在校区使用本系统**。以下四个模块必须在截止日期前达到「可日常使用」状态：

| 优先级 | 模块 | 验收标准 |
|--------|------|----------|
| P0 | 签到系统（考勤登记） | 选择日期+班级+课程 → 加载名单 → 逐人标记 → 批量提交，流程走通无报错 |
| P0 | 学生管理系统 | 增删改查 + Excel 导入导出 + 按班级筛选，教师仅见本班 |
| P0 | 学生成绩管理系统 | 考试创建 → 成绩录入 → 成绩单（排名+等级）→ 家长通知，全链路可用 |
| P0 | 销售管理系统（招生线索） | 线索登记 → 跟进记录 → 状态流转 → 一键转化（自动建档+报班） |

在 P0 模块全部达标之前，**禁止将时间投入到非 P0 的功能开发上**。每天收工前跑一次全量 e2e 回归 + 浏览器冒烟测试。

## 三、跨模块业务联动检查表（改动相关模块后必查）

| 触发操作 | 应联动的模块 | 预期效果 |
|----------|-------------|----------|
| 考勤标记「正常/迟到/早退」 | 课时包 | 自动扣减 1 课时 + 写入消耗流水 |
| 考勤标记「缺勤」 | 通知记录 | 自动生成家长缺勤通知 |
| 考勤状态从「缺勤」改为「正常」 | 通知记录 + 课时包 | 撤销当日通知 + 扣减 1 课时 |
| 考勤标记「请假」 | 请假 | 自动生成待审批同步单（幂等） |
| 补课标记完成 | 课时包 | 自动扣减 1 课时 |
| 线索转化 | 学生 + 订单 | 事务创建学员档案 + 报班订单 |
| 成绩录入（新插入） | 通知记录 | 自动推送成绩发布通知（修改不重复） |
| 订单状态改为「结业」 | 经营报表 | 在读率 / 续班率自动更新 |

## 四、数据库迁移规则（不可违反）

1. **迁移唯一权威**：所有 schema 变更必须通过 `server/src/migrations/` 新增迁移脚本（v15、v16…），**禁止修改历史迁移**。
2. **文档同步**：每次迁移后立即更新 `server/database.md`。
3. **字段命名统一**：表名小写+下划线复数；字段小写下划线；布尔 `is_xxx` / `has_xxx`；时间 `created_at` / `updated_at`；外键 `xxx_id`。
4. **必备字段**：每张业务表至少包含 `id`、`created_at`、`updated_at`。
5. **外键与索引**：所有 `xxx_id` 外键建索引；常用筛选字段（`date`、`status`、`class_id`）建索引。
6. **事务一致性**：跨表写操作必须用事务。
7. **软删除 vs 硬删除**：有业务关联的数据禁止硬删除，改为状态字段；删除前检查外键引用，返回 400 明确提示。
8. 迁移脚本模板见 `server/src/migrations/012-schedule-makeup.js` 等既有脚本，必须导出 `version` / `name` / `up(db)` / `down(db)`。

> 注意：`migrations/index.js` 中迁移版本必须**连续递增**（执行器会校验 `m.version === current + 1`，跳级会抛错终止启动）。

## 五、API 文档同步规则

- 唯一权威文档：`docs/api.md`（结构化 Markdown 表格 + JSON 代码块，可被 AI 解析）。
- 机器可读规范：`docs/openapi.yaml`（OpenAPI 3.0）。
- **每次新增/修改 API 必须同步更新这两份文档**，并在 `docs/PROGRESS.md` 记录。
- 统一响应格式见 `docs/api.md` 顶部「通用约定」。

## 六、浏览器测试要求

**不能只跑 API 测试就认为功能可用**。每个 P0 模块必须在浏览器中实际走通一遍。

- 开发环境前端：`http://localhost:8848`（vite）；Docker 环境前端：`http://localhost:8080`。
- 后端：`http://localhost:3000`，健康检查 `GET /api/health`。
- 浏览器自动化工具：系统 Python 3.14 + Playwright 1.62（`C:\Program Files\Python314\python.exe`），脚本放在 `server/scripts/ui-*.py`，截图输出到 `evidence/`。
- 每次浏览器验证后在 `docs/PROGRESS.md` 的「最近一次浏览器验证」记录：时间、覆盖模块、每个检查项结果、发现的 bug 与修复状态。

## 七、Docker 部署约束

```bash
docker compose up -d --build
curl http://localhost:3000/api/health   # 必须 200
curl -I http://localhost:8080
node server/scripts/e2e-lifecycle.mjs
```

- SQLite 数据持久化在 `server/data/attendance.db`。
- 数据库迁移在容器启动时自动执行。
- 新增环境变量同步更新 `.env.example` 和 `docker-compose.yml`。
- **向用户交付前**，必须用 Docker 完整跑一遍。

## 八、环境注意事项（本机实测）

- 本机 `node_modules` 曾出现 **junction 链接丢失（顶层目录为空）** 的问题，表现是 `Cannot find module '.../node_modules/vite/bin/vite.js'`。
  - 修复：`pnpm install`（会自动 purge 并重建 `node_modules`），必要时 `$env:CI="true"` 跳过交互确认。
- `server/node_modules` 为 npm 安装的真实目录，独立于前端，互不影响。
- 本仓库**已是 git 仓库**（有 `.git`，远程 `origin = https://github.com/gary0828/chuanwai`，分支 `main`）。推送大包前须先配 `http.postBuffer=524288000` + `http.version=HTTP/1.1`。仓库为**公开**，推送前必须扫描敏感数据（真实学员数据 / 密钥）。

## 九、Agent 连续工作协议

1. **初始化**：读 `docs/项目地图.md`（**代码定位**：目录结构 + 按功能找文件）与 `docs/00-项目导航.md`（**文档体系**：权威范围表 + ADR 索引 + 阶段速查），据此决定本次会话要读哪些文件（**不要再全项目扫描**）；启动后端；跑 `node server/scripts/e2e-lifecycle.mjs` 确认基线全绿；确认前端可访问。
2. **任务选择优先级**：P0 缺陷 > 浏览器验证发现的 UI/交互问题 > e2e 失败项 > 跨模块联动不通过项 > API 文档缺失/不一致 > 数据库设计不规范 > pure-admin 规范偏离 > 性能/安全/体验。
3. **执行**：先在 `docs/PROGRESS.md` 记录当前任务；小步修改，每次只做一件事；前端改动前先确认符合第〇节。
4. **验证**：后端改动 → e2e + 浏览器；前端改动 → `pnpm lint` + `pnpm build` + 浏览器。
5. **循环**：完成一个任务后自动进入下一个，不等待用户确认；遇到阻塞记入 `docs/PROGRESS.md` 并跳过。
6. **决策留痕**：任何「三个月后会被重新质疑」的决定，必须在 `docs/decisions/` 新增 ADR（`ADR-00N-简短标题.md`，格式见已有 ADR），并回链到 `docs/00-项目导航.md` 的 ADR 索引表。**ADR 只追加、不修改**（要改就新增一条并标记取代关系）。典型信号：为什么不做 X、为什么选 A 不选 B、某个口径为什么这么定。

## 十、AI 读取预算与 Token 纪律（2026-09-12 新增，2026-09-14 更新）

项目磁盘 **799MB**，但真实源码仅约 **28,500 行 / 4.5MB（0.6%）**。为避免把依赖与产物读进上下文，遵守以下纪律：

### 10.1 禁止整目录读取

**禁止**对以下路径做全量列举 / 递归读取 / Glob 扫描：

| 路径 | 体积 | 原因 |
| --- | --- | --- |
| `node_modules/`、`server/node_modules/` | 775MB | 第三方依赖，与业务逻辑无关 |
| `server/data/` | 7MB | SQLite 二进制 + WAL + 备份，**且含真实学员数据** |
| `dist/` | 3.7MB | 构建产物 |
| `evidence/`、`_verify_test/` | 7MB | 截图 / 测试脚本（需改时按路径显式打开） |
| `*.db*`、`pnpm-lock.yaml`、`package-lock.json` | — | 二进制与超长锁文件 |

已由 `.aiignore` / `.cursorignore` / `.copilotignore` / `.ignore` 四份同内容规则文件覆盖（ripgrep 亦生效，实测搜索不再命中 `node_modules`）。

### 10.2 用搜索代替遍历

- 找"某个功能在哪实现" → 先用 Grep 搜关键词，**不要**先 `Glob` 出全部文件再逐个读。
- 找"某个表/字段被谁写" → 搜索字段名，而不是读完整路由文件。
- 确认"某个接口是否存在" → 搜索路由字符串，不要枚举路由文件。

### 10.3 先读地图，再读代码

会话开始时按序读取，总量控制在 **约 400 行以内**：

1. `.workbuddy/memory/MEMORY.md`（长期约定，约 3,000 字符）
2. **本文档 `WORKBUDDY.md`**（开发约束）
3. **`docs/项目地图.md`**（目录结构 + 按功能定位文件的索引表）← 定位代码靠它，不要扫描
4. 仅当任务涉及时，再读具体源码文件

### 10.4 读取分级

| 场景 | 允许读取范围 |
| --- | --- |
| 明确的小改动 | 目标文件 + 其直接依赖（通常 ≤ 5 个文件） |
| 跨模块改动 | 目标模块的路由/视图 + `utils/scope.js` + `docs/api.md` 对应章节 |
| 全量审查 / 评估 | 允许遍历 `server/src/` 与 `src/`（约 28,500 行），但仍排除依赖与产物 |
| 不确定读什么 | **先读 `docs/项目地图.md` 第二节/第三节**，再决定 |

### 10.5 输出纪律

- 不把读取到的源码大段复述给用户（用户看得到文件）。
- 报错时只贴**关键行 + 根因**，不贴完整堆栈与调试过程。

### 10.6 清理类任务的纪律（2026-09-14 新增）

批量删除文件时，**每批删完立即核对数量**，不要一次性串联多个 `git rm`：

- 一个 Bash 调用里串联 `git rm`，若中途被中断会留下 `.git/index.lock`，且可能造成**远超预期的删除**。
- 稳妥做法：`rm` 指定路径 → 立刻 `find ... | wc -l` 与预期数量比对 → 再继续下一批。
- 一旦发现误删：`rm -f .git/index.lock` 清除残留锁，再 `git restore --source=HEAD --staged --worktree -- .` 整体还原（**未跟踪文件不受影响**）。
- 删除依赖后**必须同步 `pnpm-lock.yaml`**：`Dockerfile` 用的是 `pnpm install --frozen-lockfile`，锁文件不一致会直接阻断镜像构建。本机 `pnpm` 因 corepack 损坏不可用，改用 `npx --yes pnpm@<版本号> install --lockfile-only`（版本号取 `package.json` 的 `packageManager` 字段），最后用 `--frozen-lockfile` 复验。

---

## 十一、约束

- 不破坏现有数据库迁移历史；所有 schema 变更必须通过新迁移。
- 不改变「纯员工端 CRM」定位：学生/家长无账号、不登录。
- 不删除或覆盖未提交的他人工作。
- 所有 API 遵循现有响应格式与错误码，并同步更新 `docs/api.md`。
- Docker 部署配置保持可用，向用户交付前必须用 Docker 完整验证。
- **P0 模块优先于一切。**
- **每个功能都必须经过浏览器验证。**
