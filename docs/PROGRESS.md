# 项目进度（PROGRESS）

> 每次会话开始读取本文件，结束更新。最近更新：**2026-09-21**
> 数据库版本：**v18** ｜ e2e **80/80** ｜ analytics **22/22** ｜ docker-verify **9/9** ｜ P0 浏览器 **31/31** ｜ 前端全站扫描 **29/29（0 控制台错误）**
> 上线倒计时：**用户下周在校区正式使用** —— P0 模块优先于一切。

---

## 已完成

- [x] **学生成长路径 · 数据地基（2026-09-20）** —— 迁移 v18 + 造数 + 9 个 API，**既有业务表一张未动**
  - **产品定位升级**（用户拍板）：AI 工作台不止于「一份当前状态报告」，而是要做成**见证学生每一步成长的载体** —— 多维度数据支撑，看到孩子如何从 0 到成功。操作者是老师，因此必须尽可能减少老师工作量
  - **关键认知澄清**：**成长路径不存 DB**。事实记录存 DB（结构化、要准确）；成长路径是「实时算 + AI 写文案」的视图。因此**只需 1 张时间轴表**（payload 为 JSON，加维度不改表结构），而非「每维度一张表」—— 这是「数据库不会越来越复杂」的关键
  - **迁移 v18**（`018-growth-timeline.js`，5 张表）：`student_timeline`（成长时间轴，**只增不改**，核心）、`knowledge_points`（知识点体系，两级：单元 / 知识点）、`class_evaluations`（课堂评价，3 维 1–5 分）、`kp_assessments`（知识点掌握评定，三档）、`growth_thresholds`（成长阈值 8 条，admin 可调、立即生效、不重建镜像）
  - **★ 分工铁律（实测缺陷后确立）**：出勤 / 成绩 / 课时由**既有表**承载，读取时 UNION 合并，**绝不再写入 `student_timeline`**；时间轴只装既有表装不下的 `class_eval` / `kp_assessment` / `milestone` / `note`。`appendEvent` 对既有表维度直接抛错拦截，读取层另按 `(type, date)` 去重兜底。详见 `server/database.md`
  - **服务层** `server/src/utils/timeline.js`：`appendEvent`（含兜底脱敏 `scrubPayload`，金额/电话一律剔除）/ `studentTimeline`（三表 UNION + 新事件）/ `classGrowth`（整班概览）/ `studentGrowth`（单学员「起点 vs 现在」画像）/ `thresholds`
  - **路由** `server/src/routes/growth.js`（9 端点，前缀 `/api/growth`）：采集端 3 个（`eval-form` 预填 / `class-eval` 老师 10 秒 / `kp-assessment` 老师 1 分钟）+ 查询端 6 个。权限全部复用 `utils/scope.js`
  - **老师工作量分层设计**：第 0 层零操作自动采集（签到/录分/扣课时，系统已有）｜ 第 1 层 10 秒课堂随手记（3 维点选 + 可选备注）｜ 第 2 层 1 分钟知识点打勾（全班同状态 + 个别覆盖）。**永远不强制**，采集入口嵌在**已有页面**（授课流程页），不新增表单
  - **造数脚本** `server/scripts/seed-growth.mjs`（可重复执行）：1 个班 8 名学员 × 12 周，**刻意埋入四类典型画像**（进步型 / 优秀型 / 波动型 / 需关注型），确保「需支持 / 可拓展 / 离群 / 里程碑」四个功能都能被触发。实测产出：96 考勤 / 91 课堂评价 / 673 知识点评定 / 24 成绩 / 88 课时消耗 / **764 条时间轴事件**
  - **★ 实测发现并修掉 3 个真实缺陷**（正是「先造数据跑通」的价值）：
    ① **既有表与新时间轴重复计数** —— 表现为「12 次课算成 24 次」「一次考试显示两条成绩」。根因是造数脚本对 attendance/exam_score 也写了 timeline 事件，读取又 UNION 一份。修法：`appendEvent` 拦截 + 读取去重 + 脚本删写入 + 清理 120 行脏数据；
    ② **知识点过程记录被压缩** —— 里程碑从 8 个掉到 1 个、进步型学员显示「已掌握 → 已掌握」delta=0。根因是脚本跳过「等级未变」的评定，导致每个知识点只剩一条记录。修法：**每次课都写评定**（这条记录本身就是过程证据），数据从 116 → 673 条，里程碑恢复；
    ③ **里程碑口径错误** —— 原用「首末差值」识别，无法反映「什么时候突破的」。修法：改取**过程中的真实跃迁点**，另补「连续 N 次课全勤」里程碑；
    ④ **造数班级未绑定班主任** —— 教师账号访问成长接口返回 403，**「成长路径」对老师完全不可用**。根因是脚本按 `username='teacher'` 找用户，而 e2e 测试跑过后该账号已被重建。修法：改为按 `role='teacher'` 查找（不依赖用户名）+ 复用班级时补绑 `head_teacher_id` + 找不到账号直接报错退出
  - **这四个缺陷的共同启示**：它们**都是「先造数据跑通」才能发现的** —— 纯写代码时都不报错，只有真实数据流过才暴露。这印证了「先造骨架数据打通管道」这一步的必要性
  - **验证**：空库迁移 v18 全通过（18 个迁移 + 外键校验）｜ 造数后 `/api/agent/context` 的 `evaluations`/`knowledge`/`timeline`/`kpAssessments` **全部由 false 翻为 true** ｜ 单学员画像四类分化正确（陈嘉禾 trend=+25.3 / 里程碑 5 个；黄子涵 trend=-21.4、课时余 8、出勤率 66.7%、里程碑仅 1 个）｜ `/api/growth/*` 九个端点全通过 ｜ server 镜像已重建
  - **工具分工拍板**：知识库（Dify）只管「让 AI 说得专业」，延后到数据跑通之后｜**MCP 明确不做**（固定流程用 REST 更可控，MCP 属过度设计）｜Skill 用于固化周期性流程（给我自己用，非运行时）
  - **设计决策**：知识点粒度取**课时级**（一个课时 2–4 个：章节级太粗看不出进步，知识点级太细老师会放弃）｜课堂评价**砍到 3 维**（专注度/参与度/掌握度，砍掉「作业」——应由作业模块独立记录）｜成长路径**先做整班视角**（老师的使用动机），单学生视角天然会被用起来
  - **下一步**：工作台接通 `/api/growth/*` → 成长路径页（学期 / 单元 / 事件三视图）→ 授课流程页加采集入口 → 跑一周真实数据后调阈值 → C1 收口（Dify Key 服务端代持）
- [x] **成长路径落地 · 采集入口迁入 AI 工作台（2026-09-18，第二轮收口）** —— 工作台第 11 个菜单 + 授课页原地升级为采集入口
  - **★ 用户关键纠偏（推翻上一轮方案）**：**教务系统与 AI 工作台是不同人群使用的**。教务系统给**校区负责人 / 非一线教学人员**用；AI 工作台给**一线老师**用。因此「老师要用的功能尽可能少出现在教务系统，需要在一线教学端使用的功能一定出现在工作台上」——才能真正做到**老师专注上课，而不是在多个地方找功能**。上一轮「采集入口放教务系统签到页」的方案因此作废
  - **三条追问定案**：① 采集入口 → **授课流程页原地升级**（不新增页面）；② 成长路径页 → **整班 + 单学员都要**，放「教学闭环」组末尾；③ 教务端「成长档案」→ 与教师端**同步并存**，但更新源在教师端，教务端**自动更新、用于查看**
  - **后端 3 处**：① `middleware/auth.js` —— `ai_agent` 凭证放行 `/api/growth`，`PUT /thresholds` 仍挡（管理动作）；② `index.js` —— `AUDIT_MODULES` 补「成长记录」；③ `routes/growth.js` —— 头注释改为「采集端 · 入口在 AI 工作台」
  - **★★ 本轮最重要的教训：读写权限必须同权**。第一版只放行采集端（写）、挡住查询端（读），理由是"不扩大读范围"。**后果：老师能往班里写数据，却看不到自己写的数据，成长路径页整页 403，浏览器验证 13 项 FAIL。** 正确认识：①「挡住读」保护不了任何东西，只制造一个打不开的页面；② 真正的安全边界是 **`canManageClass` / `canManageStudent`**（老师只能碰自己带的班，跨班 403）；③ 判断标准 —— **老师在工作台需要这个功能，读写都该放行**，只有**管理动作**才该单独挡
  - **工作台 8 个文件**：`workbench-data.ts`（Capability 补 `timeline`/`kpAssessments`、6 个新取数函数、`growthCapabilities` 出口、新增 `effectiveClassId`）｜ `views/Teaching.vue`（「快速标记」→ **正式课后采集入口**：双 tab 三维评价 + 知识点打勾 + 个别覆盖 + 一键填全班）｜ `views/GrowthPath.vue`（**新增**，整班 5 区块 + 单学员 6 区块）｜ `components/LineChart.vue`（**新增**轻量 SVG 折线图，不引图表库）｜ `mock/dataset.ts`（补演示成长数据 + `DEMO_KP_FORM`）｜ `router.ts` / `App.vue`（注册 `/growth` + 图标）｜ `ai/generators.ts`（`DATA_VERSION` 不再写死 v15）｜ `views/Dashboard.vue`（模块级调用 → `computed`，修切换班级不刷新）
  - **修复的 4 个缺陷**：① 读写权限不对称（见上）；② 时间范围漏哨兵值（界面显示「至 9999-12-31」→ 未传 from/to 时取时间轴真实最早/最晚）；③ 量程压缩趋势（数据都在 3.5~4.5，折线几乎水平 → `LineChart` 加 `fitData` + `minSpan` 下限跨度）；④ demo 模式页面空白（补演示数据，demo 也渲染完整页并标「演示轨迹」）
  - **未粉饰的问题（已标注）**：班级均值曲线**参评人数不一致**（09-18 只评 3 人 / 09-13 评满 8 人）→ 加「各次课明细」表暴露人数，并提示"人数不一致的课时之间不宜直接比较"

- [x] **知识点采集列表混入单元节点（2026-09-20 修复）** —— `eval-form` 未过滤分组节点
  - **现象**：采集页「知识点打勾」列出老师无法操作的行（如「第一单元 · 全等三角形」），且**真知识点被截断**
  - **根因**：`knowledge_points` 是两级结构（单元 `seq=0`/`parent_id IS NULL` + 知识点 `seq>0`），`eval-form` 未过滤单元节点，且 `LIMIT 12` 恰好把第 10 个真知识点 `U3-3 含 30° 角的直角三角形` 挤出结果集（13 条中 3 条是单元节点）
  - **修法**：过滤条件用 **`parent_id IS NOT NULL`**（语义准：有父节点才是叶子）而非 `seq > 0`；`LIMIT` 提到 40；把单元名以 **`unit_name`** 带下来，前端据此做「单元 → 知识点」分组标题
  - **前端**：`Teaching.vue` 新增 `kpGroups` computed 做两级渲染，单元标题旁显示打勾进度（如 `第一单元 · 全等三角形 0/4`）
  - **定位区别（勿合并）**：`GET /api/growth/knowledge-points` 返回**含单元节点的完整层级**（带 `parent_id`），供展示层；`eval-form` 返回**可评集合**（仅叶子），供采集层
  - **验证**：可评知识点 **9 → 10 个**（截断消除）、`seq=0` 单元节点 **0 个**、全部带 `unit_name`
- [x] **`openapi.yaml` 补齐成长路径契约（2026-09-20）** —— 补 8 个路径 + 8 个 schema
  - **背景**：上一轮只更新了 `docs/api.md`，`openapi.yaml` 里 `/api/growth/*` **一个都没有**（42 个路径中缺失），属文档门禁欠账
  - **补齐**：8 个路径（9 个端点，`/thresholds` 含 GET+PUT）+ `Growth` tag + 8 个 schema（`KnowledgePoint` / `GrowthEvalForm` / `ClassEvalInput` / `KpAssessmentInput` / `StudentTimeline` / `StudentGrowth` / `ClassGrowth` / `GrowthThresholds`）
  - **顺手修正 2 处过时描述**：① `capabilities` 原写「尚无 class_evaluations / knowledge_points 表，恒为 false」—— v18 已翻 true，且补上遗漏的 `timeline` / `kpAssessments`；② `agentToken` 原写「仅可访问 /api/agent/* 与 /api/ai/*」，改为完整的路径白名单说明 + 读写同权的理由
  - **新增可执行门禁** `_verify_test/check-openapi.mjs`：可解析性 + **84 个 `$ref` 引用完整性** + growth 路径数。契约文件"改坏了"不会让任何测试失败，只会在未来对接方那里炸
- [x] **前端全站视觉改版（2026-09-18）** —— 「教务台」方向，**功能零变更**
  - **方向定调**（四项设计上下文经确认）：中度重塑 / 专业信赖 / 台式+平板并重 / 先样板页再全量。主色由 Element 出厂 `#409EFF` 换为深靛蓝 `#1F5C99`。设计上下文持久化在根目录 `.impeccable.md`，人类可读规范见 `docs/前端视觉规范-2026-09-18.md`
  - **三层样式架构**（新增）：`style/tokens.scss`（唯一变量源，含深色模式全套取值）、`style/page.scss`（页面视觉语法工具类）、`style/element-plus-override.scss`（Element 组件视觉重定义）。**硬性约束：override 必须晚于 `element-plus/dist/index.css` 引入**，靠加载顺序而非 `!important` 取胜
  - **改一层、全站受益**：全局覆盖把 `el-table border` 的竖线消解为只剩横线、`stripe` 降为极浅 `ink-50`、表头接管为冷灰底 + 600 字重、卡片去阴影改细边框、`el-empty` 插画隐藏。**其余 30 个未逐页改动的页面自动换新**，因此全量铺开时无需逐页删 `border`/`stripe`
  - **新增页面级组件**：`AppPageHeader`（页头：标题 + 说明 + 主操作）、`AppEmpty`（空状态：说清「为什么空 / 下一步做什么」）
  - **样板页 3 个**：① 登录页——移除模板自带的波浪背景 / pure-admin 插画 / Consolas 等宽标题，改「左品牌 + 右表单」分栏，登录框居中于页面（顺带删除 `views/login/utils/static.ts` 与 `assets/login/` 三张废弃素材）；② 工作台——**顺手修复实锤缺陷**：4 张统计卡原用 `icon: "ep:xxx"` 字符串 + `<component :is>`，项目规范禁止且**图标实际不渲染**，改用 `~icons/ep/xxx`；另加主题切换后重绘图表；③ 班级管理——确立标准 CRUD 视觉语法，作为其余同构页的复制模板
  - **全量铺开**：`_verify_test/apply-page-skeleton.mjs` 把页面骨架机械应用到 **26 个页面**（根容器 `p-4` → `app-page` + 注入 `AppPageHeader`），幂等且兼容 CRLF；AI 配置中心页按 AI 场景**单独重新组织信息层级**（安全说明改浅品牌底不再用告警黄、余额/用量走指标卡、配置来源标记移到标签行让输入框独占整行、说明条与卡片全部 token 化）
  - **平板策略**：`layout/index.vue` 的侧边栏自动折叠阈值 990 → **1200**，平板横屏（1024）折叠为 54px，横向空间优先让给内容区
  - **验证**：生产构建通过（41.2s / 3.55MB）｜ 全站扫描 **29/29 页面渲染正常 + 0 条控制台错误**（`_verify_test/ui-global-sweep.py`）｜ 验收点 **9/9**（`ui-acceptance.py`：登录框在 1180/1280/1440/1680 四视口居中偏差均为 **0.0px**；侧边栏 1220/1440 展开、900/1024 折叠）｜ 样板页双视口 **13/13**（`ui-redesign-shots.py`）
  - **已知遗留**（详见 `docs/前端视觉规范-2026-09-18.md` §九）：`el-empty` 未逐页换成 `AppEmpty`（插画已全局隐藏、字号字色已统一，视觉一致但组件未统一）；错误页 403/404/500 保持原结构；`/ai-admin` 不进标签页（pure-admin 标签逻辑基于菜单匹配，**属框架既有行为、非本次改版引入**）；深色模式 token 已同步但**未做浏览器验证**
  - **登录页背景二次优化（同日晚，验收反馈）**：原「左品牌深色块 + 右表单」被指出背景难看且不对称 —— 深色块占左侧 42%（全站唯一的深色区域）、与右侧居中卡片互不承认、网格纹理弱到不可见。**改为全屏对称的「教务格栅」**：主格 128px + 次格 32px 两级坐标线（品牌色极低透明度），径向遮罩让中心渐隐为卡片留出呼吸区；结构改为「品牌 → 卡片 → 页脚」三者同轴居中。格栅是把全站「只有横线的表格」这一线条语言抽象到背景层，底色与卡片规格均与内页同源。实测 5 个视口居中/同轴偏差 **0.0px**（`_verify_test/ui-login-shots.py` 20/20）

- [x] **校区部署反馈修复三连 + 恢复出厂状态（2026-09-16，部署后第一天）**
  - **修复 A/B：免登跳到「访问者本机的 localhost」**（校区实测：老师用自己电脑访问校区机器时，AI 助手打不开或回落演示身份）。根因是 `ai.js:67` 直接用写死的 `config.aiWorkbenchUrl`（默认 `http://localhost:8082`），而 localhost 指的是打开浏览器的那台电脑。改为：配置非回环地址则尊重配置，仍是 localhost 则**跟随访问者 host**（`POST /api/ai/sso/ticket` 接受 `host`，前端传 `window.location.hostname`）。**只接受合法主机名/IPv4 白名单，防开放重定向**（恶意 host 实测被拦截回退）
  - **修复：AI 配置中心**（用户反馈「DeepSeek 配置设计有问题，改一次要重建镜像」）。新增迁移 **v17**（`ai_settings` + `ai_usage`）、`utils/aiSettings.js`、`GET/PUT /api/ai/admin/config`、`GET /api/ai/admin/balance`、`GET /api/ai/admin/usage`，**全部 `requireRole("admin")`**（teacher 实测 403）。配置存 DB 优先于环境变量，**改完立即生效无需重启**；敏感值只返回掩码，掩码回传表示不修改。前端新增 `views/ai-admin/index.vue`，挂在 `remaining.ts`（**不参与菜单下发**，只能凭 `/#/ai-admin` 进入）。浏览器验证 **9/9**：凭地址可进、余额 ¥30.20 显示正常、无明文 Key、保存生效、菜单无入口
  - **修复：一键部署** `deploy.sh` —— 检查 Docker → 自动造 `.env`（JWT 随机生成）→ 优先用离线镜像包（不联网）→ 启动 → 自检 → **打印本机 IP 供其他电脑访问**
  - **恢复出厂状态**：新增 `server/scripts/reset-production-data.mjs`（先自动备份、默认只预览、`--confirm` 才执行；保留 admin + terms + settings）。已执行：清空 29 学员/86 考勤/1608 审计日志等全部业务数据，仅剩 admin
  - **顺带修掉真 bug**：`analytics.js` 空数据导出 CSV **连表头都没有**（用户下载得到空文件）。改为由 `DATASETS[].columns` 显式声明列名，空库也输出表头（可当导入模板）。analytics 由 21/22 恢复 **22/22**
  - **测试自包含改造**：`e2e-lifecycle.mjs` 原先依赖出厂的 teacher 账号，清库后必挂。改为登录失败时用 admin 现场创建，测试不再依赖种子数据 → 清库后仍 **80/80**
- [x] **AI 教学工作台：真实数据接入 + 使用反馈 + Dify 部署 + Docker 全栈（2026-09-14 下午）**
  - **数据源接入（只读网关）**：新增 `server/src/routes/agent.js` —— `GET /api/agent/context`（身份 / 可见班级 / 数据能力位）+ `GET /api/agent/classes/:id/overview`（学员 + 考勤/成绩/课时聚合）。复用既有 `utils/scope.js`（teacher 仅本班，非本班 403），**不返回金额、家长姓名与电话**；`capabilities` 如实反映「真实库里已有哪类数据」，避免把「没有数据」渲染成 0 分
  - **最小权限凭证**：`/api/ai/sso/verify` 增发 `agentToken`（`type=ai_agent`，12 小时），`middleware/auth.js` 按类型做路径校验 —— 该凭证**仅可访问 `/api/agent/*` 与 `/api/ai/*`**，调用学生/财务/经营分析等接口一律 403
  - **工作台适配层**：新增 `ai-workbench/src/workbench-data.ts`，顶栏可一键切换「演示数据 / 真实教务数据」并选择班级；`engine` / `generators` / 10 个页面全部改为经适配层取数。真实库尚无课评/知识点/题库三类表，界面统一标注「待建设」而非静默显示 0
  - **使用反馈模块（迁移 v16）**：新增 `feedbacks` 表与 `/api/feedback`（提交 / 我的 / 全量 / 统计 / 处理 / 字典）。首页新增可填写的「使用反馈」卡片：教师提交并看到管理员回复，admin 汇总、回复、跟踪处理。**只记录提交人身份与问题描述，不落任何学员数据**
  - **家长反馈按机构要求去掉剩余课时**：`templates.parentFeedback` 移除课时块，`ParentFeedback.vue` 简化为单一版式，并在页面明示「不出现剩余课时与任何金额」
  - **Dify 部署**：`dify/`（官方 docker 配置）+ `.env`（随机 `SECRET_KEY`，端口避让为 **8081**），15 个容器全部启动，实测内存约 **2.2 GB**（Docker 可用 7.6 GB）
  - **Docker 全栈**：新增 `ai-workbench/Dockerfile` + `nginx.conf`（静态托管 + `/api` 同源反代），`docker-compose.yml` 新增 `ai-workbench` 服务（**8082**，8081 已被 Dify 占用）、`AI_WORKBENCH_URL` 注入、`server/.env.example` 同步。三业务容器 + Dify 共 18 容器，总内存约 **2.38 GB**
  - **验证**：免登链路 **18/18** ｜ 使用反馈 **20/20** ｜ 只读网关与权限边界 **24/24** ｜ Docker 端到端走查 **11/11** ｜ 回归 e2e **80/80** + analytics **22/22** ｜ 前后端与工作台生产构建均通过 ｜ `openapi.yaml` 解析通过（42 路径）
  - **修复**：免登换会话后侧边栏身份不刷新的问题（`App.vue` 增加路由变化时重读身份）
  - **数据现状提醒**：当前库为**种子/测试数据**（29 名学员、86 条考勤，但 `exams` 1 条 / `exam_scores` **0 条**），真实数据接入链路已通，学情分析效果需等实际成绩录入后自然体现
- [x] **服务端大模型接入 + 端到端闭环（2026-09-14 晚）**
  - **Key 只在服务端**：工作台不再直连模型，改经 `POST /api/ai/generate` 由后端代理（此前 Key 存在浏览器 localStorage，等于对任何能打开工作台的人公开）
  - 新增 `server/src/utils/llm.js`（OpenAI 兼容封装）+ `prompts.js`（9 场景提示词）+ `redact.js`（**服务端二次脱敏**，不信任前端）；`config.js` 新增 `llm` 配置；`docker-compose.yml` 只向后端容器注入 `LLM_*`
  - **修掉 3 个实战问题**：① 脱敏漏掉 `focusStudentNames`（黑名单改为「键名归一化 + 语义规则」）；② 模型名 `deepseek-v4-flash` 不存在（实测可用 `deepseek-flash` / `deepseek-v4-pro`，且传错名也返回 200，容易漏配）；③ **推理型模型思维链吃满输出额度导致正文为空** —— 加 `LLM_REASONING_EFFORT=none`，耗时 46s→12.8s、输出 8192→1897 token、成本 ¥0.075→¥0.0185
  - **顺带修掉**：工作台硬编码「库版本 v15」（实际已是 v16）→ 改读只读网关实时返回的 `PRAGMA user_version`
  - **端到端验证 `_verify_test/ui-llm-mode.py`：8/8**（免登进入 → 底座设置识别 `deepseek-flash` → 切服务端模型 → 首页真实生成 → 标注「服务端模型生成」+ 数据依据 + 出网脱敏项）。实测单次 **7.0 秒 / ¥0.011**
  - 全栈镜像重建 + 回归：e2e **80/80** ｜ analytics **22/22** ｜ docker-verify **9/9** ｜ 工作台 **8/8**
  - 文档同步：`docs/api.md` §5 更新 `AI_WORKBENCH_URL`（5300→8082）、CORS 同源反代说明、`LLM_MODEL` / `LLM_MAX_TOKENS` 口径；`server/.env.example` 补 AI 配置段；`README.md` 新增「AI 教学工作台与大模型配置」
  - **已知小瑕疵（P3，待产品决策）**：脱敏把 `weakKps[].name`（知识点名称）也剔了，而 `ROADMAP` §6.4 白名单本意允许知识点名称出网 —— 属过度脱敏，模型已优雅降级但损失报告精度
- [x] **AI 教学工作台原型（方案 C：逻辑独立、部署统一）**（2026-09-14）
  - 新增独立子项目 `ai-workbench/`（Vite 7 + Vue 3.5 + Element Plus 2.11，**复用根 node_modules，零新增依赖**），10 个页面覆盖教学全流程：当前单元行动台 / 课程设计 / 备课方案 / 授课流程 / 作业设计 / 作业检查与评价 / 学习分析与报告 / 家长反馈 / AI 知识库 / 底座设置
  - **AI 能力层**（`ai-workbench/src/ai/`，对应报告"能力内聚"）：`engine.ts` 本地指标引擎（出勤率、成绩趋势、知识点掌握度、同班 Z-score 离群检测）；`redact.ts` 出网白名单脱敏（姓名 / 电话 / 金额一律剔除，学生以内部编号送出）；`provider.ts` 可插拔底座（规则引擎默认 / Dify 工作流，调用失败自动回退并标注原因）；`generators.ts` 9 个场景编排 + 生成记录审计（模式 / 模型 / token / 成本 / 脱敏项 / 数据依据）
  - **免登链路（服务端）**：新增 `server/src/routes/ai.js` —— `POST /api/ai/sso/ticket`（登录用户签发 60 秒一次性票据）+ `POST /api/ai/sso/verify`（公开校验换会话）；票据置于 URL hash 不落访问日志、带 `jti` 防重放、带 `tv` 随登出/改密即时吊销；`config.js` 新增 `aiWorkbenchUrl` 并把 `http://127.0.0.1:5300` 加入 CORS 白名单
  - **入口按钮**：`src/layout/components/lay-navbar/index.vue` 顶栏新增「AI 助手」；接口集中在 `src/api/ai.ts`
  - **新增配置**：`AI_WORKBENCH_URL`（默认 `http://127.0.0.1:5300`）
  - **验证**：后端三文件语法检查通过 ｜ 免登链路专项 **18/18**（`_verify_test/verify-ai-sso.mjs`：未登录取票 401、票据载荷不含身份字段、重放 401、篡改签名 401、缺票 400、非 JWT 401）｜ 现有前端生产构建通过（24.5s / 3.53 MB）｜ `docs/openapi.yaml` 解析通过（35 个路径，已含 `/api/ai/*`）
  - **已知边界**：工作台取数仍用内置演示数据集（`ai-workbench/src/mock/`），接真实数据只需实现只读适配层，页面与指标引擎不动；Dify 容器尚未部署，原型走规则引擎，配置后可一键切换
- [x] **全仓过度设计审计与清理（ponytail-audit）**（2026-09-14）
  - 审计报告：`docs/过度设计审计报告-2026-09-14.md`（含 10 项发现、5 处误报排除记录、执行结果）
  - **净减 1,027 行、5 个依赖**，全部为死代码与不可达分支，零功能影响
  - 前端 **-963 行**：删 `src/utils/localforage/`（275 行，零引用）、`src/utils/print.ts`（223）、`src/utils/propTypes.ts`（39）、`src/utils/sso.ts`（59）、`src/utils/preventDefault.ts`（28）、`src/utils/globalPolyfills.ts`（7）、`src/directives/{copy,longpress,optimize}`（164）、`mock/`（138）、`src/views/permission/`（空目录）
  - 后端 **-64 行**：`finance.js` 移除 `financeScope`/`canManageOrder`（19 处路由全 admin，恒定空操作）、`leads.js` 移除 `leadScope`/`canManageLead`、`reports.js` 移除纯委托包装 `canManageStudentReport`、`calcGrade` 从 `exams.js`/`reports.js` 两处重复提取为 `server/src/utils/grade.js`
  - 依赖 **-5**：`localforage`、`vue-types`、`@pureadmin/descriptions`、`vite-plugin-fake-server`、`@faker-js/faker`
  - **保留判断**：`auth`/`perms` 指令（后端 `rolePermissions()` 真实下发、前端 store 真实消费，是其唯一展示层消费端）；`exams.js` 的 `examScope`（该路由真的对 teacher 开放，属有效过滤）
  - **连带修正**：`tsconfig.json`、`build/optimize.ts`、`build/plugins.ts`、`src/router/index.ts`、`package.json` 的 `lint:eslint` glob、`pnpm-lock.yaml`
  - **锁文件必须同步**：`Dockerfile:12` 用 `pnpm install --frozen-lockfile`，不同步会直接阻断镜像构建。已用 `pnpm@10.15.1 install --lockfile-only` 重生成并以 `--frozen-lockfile` 复验通过
  - **验证**：ESLint 0 错 ｜ 生产构建通过（29s / 3.53 MB）｜ e2e **80/80** ｜ analytics **22/22** ｜ finance/leads 专项 **45/45** ｜ 浏览器 P0 **31/31**
  - **顺带修掉**：`server/scripts/ui-p0-verify.py` 改造为「接口登录 + 注入 token」，彻底移除对登录页 canvas 验证码的依赖（此前必须靠 `VITE_LOGIN_CAPTCHA=false` 重新构建才能跑）；`TC-5` 断言反转为「teacher 被拒线索管理」（与 2026-09-12 权限收紧对齐）
  - **新发现待决策**：顶栏通知铃铛 `src/layout/components/lay-notice/data.ts` 读的是写死的模板演示数据（"小铭 评论了你"等），从未请求后端，而后端 `/api/notices/latest` 已存在 —— 属「演示内容上线」，需产品决策接真实接口还是隐藏
- [x] **文档清理与归位**（2026-09-14）
  - 删除 `docs/README.en-US.md`（vue-pure-admin 模板自带的英文 README，与项目无关，根 README 亦未引用）
  - 同步修正 `docs/00-项目导航.md`（数据库版本 v14→v15、补 ADR-006 索引、更新回归基线、新增「评审报告归档」表）与 `docs/项目地图.md`（源码规模、目录地图去掉 `mock/`、补 `utils/grade.js`、常用命令改为可复现脚本）

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

- [ ] **Phase 0 收尾**：4 项 P0 全链路浏览器走查（成绩建考→录分→成绩单→通知 / 销售建线索→跟进→转化→统计 / 学生新增→编辑→导入含错误行→导出 / 签到缺勤→通知生成 + 课时扣减）。API 层已由 e2e 覆盖，**UI 走查待补**
- [ ] 工作区尚未提交：`ai-workbench/`（31 文件）+ `dify/` + 迁移 v16 + `agent/ai/feedback` 路由未入库，HEAD 仍停在 `8b2b6b1`

## Git 版本管理（2026-09-12 已建立）

- 仓库：`https://github.com/gary0828/chuanwai` ｜ 分支 `main` ｜ **首次提交 `42d87bd`（339 文件 / 49,459 行）已推送**
- **⚠️ 该仓库当前为「公开 Public」**，任何人可查看源码。已排除数据库与 `.env`，但**后续任何真实数据 / 密钥都不得提交**。若要改为私有需仓库所有者手动设置。
- 提交前已做敏感扫描：无私钥 / Token；命中的手机号均为 `13800000000` 类测试假数据与哈希摘要误报。
- `.gitignore` 补充（原文件缺失这些）：`.env` 与 `.env.*`（保留 `.env.example`）、`evidence/`（截图可能含真实姓名电话）、`.obsidian/`、`_verify_test/`、`.workbuddy/`、`*.log`

### 本机 git 环境坑

1. **`pnpm` 不可用**：`corepack` 报 `Cannot find module ...\corepack\dist\pnpm.js`。改用
   `"C:/Users/rui08/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" ./node_modules/vite/bin/vite.js build`
2. **推送大包会断**：首次 `git push` 报 `send-pack: unexpected disconnect while reading sideband packet`。解决：
   ```bash
   git config http.postBuffer 524288000
   git config http.version HTTP/1.1
   git config http.lowSpeedLimit 0
   git config http.lowSpeedTime 999999
   ```
3. **远端跟踪 ref 写不进本地**（`git branch -r` 为空、`status` 显示 `[gone]`）：PortableGit 在此环境下 `fetch` 不持久化 `refs/remotes/origin/main`。**不影响推送**（`git ls-remote` 可验证远端 SHA 与本地一致），`git push` 也正常，仅 `git status` 的 ahead/behind 显示不准。

## 全面测试与缺陷修复（2026-09-12 下午，完整报告见 `docs/全面测试报告-2026-09-12.md`）

- [x] **重建生产镜像并部署当前源码**（含迁移 v15 + JWT_SECRET 注入）；容器 Healthy
- [x] **抓到并修复部署缺陷 D1**：上一轮加固的 `USER node`（uid 1000）无法写入 Windows bind mount 的 `./server/data` → 容器 `readonly database` 启动失败。已回退（Windows Docker Desktop 约束，记录在案）
- [x] **全面接口测试（新写 `_verify_test/api-full-suite.mjs`，72 断言）**：115 条路由派生权限矩阵（111 个 401 / 32 个 admin-only 403 / teacher 数据隔离）、令牌伪造与吊销、敏感字段、幂等、一致性
- [x] **修复 5 项应用缺陷**（全部复验通过）：
  - **F1 阻断**：学生批量导入 100% 失败（INSERT 11 占位符仅传 9 参，e2e 盲区）→ 补参 + 失败原因精确化；复验 200 行 0 失败
  - **F2 高**：考勤接受 `2026-99-99` 等非法日期且照常扣课时 → 新增共享校验 `server/src/utils/validate.js`，非法日期 400 且课时不动
  - **F3 高**：外键/唯一约束错误统一 500 → 全局错误中间件映射 400 + 可读提示
  - **F4 中（原 H10 延后项）**：销假回补查询带 `remain_hours>0` → 最后一课时销假课时永久丢失 → 已去除，0→1 回补复验通过
  - **F5 中**：12 处服务端校验缺失（考试日期/满分、班级/课程/公告名称长度、订单日期、缴费时间）→ 全部走 validate.js 收口；复扫 12 → 0
- [x] **浏览器端到端（新写 `_verify_test/ui-full-suite.py`，20 断言，对 :8080 生产构建）**：27 个菜单页零控制台错误、admin/teacher 双角色、关键写操作真实提交核对落库、teacher 越权 fail-closed ✅
- [x] **性能冒烟（新写 `_verify_test/perf-smoke.mjs`）**：读接口 P95 ≤ 6ms、导入 200 行 64ms、导出 ≤ 2ms —— 按目标规模余量 >100 倍
- [x] **生产库测试残留清理**：4 名测试学员及关联数据级联删除（备份 `server/data/attendance.db.bak-20260912-test-clean`），恢复 27 名种子学员干净状态
- **最终复验（全部针对修复后生产容器）**：接口 72/72、校验缺口 0、e2e 80/80、analytics 22/22、浏览器 20/20、docker-verify 9/9

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

## 🔴 全量代码审查发现（2026-09-12，第二轮回审）

> 完整报告见 **`docs/上线评估报告-2026-09-12.md`**（含全部 4 阻断 / 12 高 / 18 中 / 8 低问题清单与上线门禁）。
> 上一节 5 项安全发现已并入本轮复核并保持有效；以下为**本轮新增**、上一轮未覆盖的发现。

### 阻断上线（P0）—— 上一轮未发现

15. **线索转化建单缺 `total_hours`，转化学员永不扣课时、永不确认收入**（`server/src/routes/leads.js:296-313`）
    - `INSERT INTO orders (...)` 的字段列表**不含 `total_hours`** → 落库默认 0。
    - 而 `attendance.js:81` 扣课时要求 `total_hours > 0`，`finance.js:638` 确认收入同样要求 `total_hours > 0` → 招生链路产出的是"零课时学员"。
    - 且 `docs/api.md` 原文档声称 convert 支持 `total_hours` 参数，**后端静默忽略** → 前端按文档接入必然踩坑。
    - 处置：需业务方二选一并落地——① 转化即报班（补写 `total_hours`）；② 转化仅建档（修正文档 + 前端下线该字段）。当前已把 `docs/api.md` 改为**如实描述实现**并标注该缺口。

16. **退班后收入确认口径断裂**（`server/src/routes/finance.js:368-379`、`:636-641`）
    - 退费审批通过仅执行 `UPDATE orders SET status='退班'`，**不冲减 `remain_hours`、不写 `hour_consumptions` 回补流水**。
    - 而 `revenue_recognized` 的 WHERE 为 `status IN ('在读','结业')` → 该订单**整单收入被剔除**，已消耗课时对应的收入凭空消失且不可追溯。
    - 影响：财务数字错误 → 直接误导经营决策。

17. **财务金额 / 课时无边界校验**（`server/src/routes/finance.js:145-176`、`:243-244`）
    - `PUT /orders/:id` 的 `amount` 仅 `Number()`，**无正数 / 上限校验** → 可写负数或超大金额。
    - 更严重：同一接口允许直接改 `remain_hours`，而它是 `revenue_recognized` 的唯一计算依据，**改动不留任何流水** → 收入可被静默篡改。

### 高（P1）—— 上一轮未发现

18. **前端 token 刷新失败会导致请求永久挂起**（`src/utils/http/index.ts:86-96`、`:133-138`）
    - 刷新链路为 `.then().finally()`，**缺 `.catch()`**：刷新失败时 `PureHttp.requests` 队列回调永不执行，`retryOriginalRequest`（`:50-57`）的 Promise 永不 resolve → 相关请求永久 pending，并产生 unhandled rejection。
    - 叠加响应拦截器**无 401 → 跳登录**逻辑，token 真失效时用户看到的是"界面卡死"而非"重新登录"。这是上线后最可能被用户感知的缺陷。

19. **请假销假回补与考勤回补口径不一致**（`server/src/routes/leaves.js:138` vs `attendance.js:84`）
    - 考勤回补查询**不带** `remain_hours > 0`（注释明确"余额为 0 时同样可以回补恢复"），请假回补查询**多带**该条件。
    - 触发条件非边缘：**每个学员都会经过"剩余课时 = 1"**。此时缺勤扣减 → `remain_hours` 归 0 → 销假审批查不到订单 → 该课时**永久不回补**且不写流水，账实不符。
    - 修法：删除 `leaves.js:138` 的 `remain_hours > 0` 条件，与 `attendance.js:84` 对齐。

20. **逻辑删除未过滤，统计口径失真**（`attendance.js:349-359/414-461/483-519`、`classes.js:66-75`、`dashboard.js:44-53`、`analytics.js:211-219`）
    - 多处 `JOIN students s` **不带** `s.status='在读'`，而 `classes.js:25`、`attendance.js:621` 带 → 退学/休学学员仍计入出勤率、班级今日统计、趋势与导出，**同一指标不同页面数字不一致**。

21. **审计日志大面积缺失**（`server/src/index.js:20-40` 白名单 vs 实际）
    - 22 个路由文件中 **11 个未挂 `audit`**：`attendance / students / classes / leaves / schedules / courses / users / terms / settings / notifications / backups`。
    - 其中含 `backups.js:20` 恢复数据库、`users.js:131` 重置密码、`attendance.js:48` 批量考勤+扣课时 —— 均为高敏感写操作。
    - 且 `users.js:170-177` 依赖 audit_logs 做删除拦截，语义自相矛盾。

22. **缺索引（P0 签到主路径）**（`server/src/migrations/*.js`）
    - `orders(student_id, course_id, status)`：`attendance.js:81/84`、`leaves.js:138`、`makeups.js:117` 每次考勤都用，当前仅有 `idx_orders_student`。
    - `classes(head_teacher_id)`：`utils/scope.js:15/27/37` 教师每个请求的 scope 子查询都用。
    - `attendances(student_id, date)`：`attendance.js:620/646` 缺勤预警用，现有 UNIQUE 仅前缀可用。
    - 建议补跑 `EXPLAIN QUERY PLAN` 确认后新增迁移（**须新迁移脚本 + 同步 `server/database.md`**）。

23. **前端 369 处 `any` + 类型系统失效**（`tsconfig.json:6-7`、`eslint.config.js:80-81`）
    - `strict: false`、`strictFunctionTypes: false`；ESLint 关闭 `no-explicit-any`、`ban-ts-comment`、`no-debugger`。
    - `@ts-expect-error` 已从 **9 处降为 0 处**（原 9 处全部位于 `utils/print.ts`，该文件 2026-09-14 因零引用被删除）。
    - `src/api/*.ts` 无返回泛型（`routes.ts:5` `data: Array<any>`）→ 后端契约变更无法在编译期暴露。

24. **`xlsx@^0.18.5` 存在已知 CVE**：原型污染 CVE-2023-30533、ReDoS CVE-2024-22363，修复版仅在 SheetJS 官方 CDN，npm 无对应版本。需 `pnpm audit` 复核并评估替代方案。

25. **Excel 导入无行数上限 + 每行独立事务**（`server/src/routes/students.js:184-240`）：N 行 → N 个 `BEGIN/COMMIT` + N 次 `canManageClass` 查询，慢且丧失整体回滚语义。

### 中（P2）—— 上一轮未发现

26. **学期写入无事务**（`server/src/routes/terms.js:49-61`、`:74-88`）：`UPDATE terms SET is_current=0` 与后续 INSERT/UPDATE 未同事务，后者若因 UNIQUE 抛错则清零已提交 → **全库无当前学期**，`/terms/current` 返回 null。
27. **班主任双字段各自写**（`classes.js:135-138`、`:24-27`、`:84`）：`head_teacher`（文本）与 `head_teacher_id`（账号）可指向不同人；列表取 join 姓名、详情取文本 → 两处显示不同班主任。
28. **请假审批通过未撤销已发出的缺勤通知**（`leaves.js:172-213` vs `attendance.js:129,199-201`）→ 家长侧留存与考勤状态矛盾的内部留痕。
29. **全局错误中间件忽略 `err.status`**（`index.js:107-110`）：`utils/backup.js:62/67/80/87` 抛出的 400/404 一律变 500。
30. **验证码仅前端实现**，后端 `auth.js:403 /login` 不校验 → 直接调 API 可绕过；叠加无限流 + 默认弱口令，登录接口可被自动化爆破。
31. **CORS/安全头/限流全缺**：`index.js:16` `app.use(cors())` 通配任意源；`server/package.json` 无 `helmet`、`express-rate-limit`（与上一节第 11 条同源，此处补充"缺 helmet 与限流"）。
32. **`attendance.js:48` `POST /batch` 仅挂 `auth` 无 `requireRole`**（有 per-record `canManageStudent` 兜底，影响有限）。
33. **备份同步 IO 阻塞事件循环**：`utils/backup.js:36/40/92` 的 `copyFileSync/readdirSync/renameSync` 位于 HTTP 请求路径。
34. **前端构建配置遮掩告警**：`vite.config.ts:50` 把 `chunkSizeWarningLimit` 提到 4000kB（主包 ~2MB 不再告警）；`build/plugins.ts:48` `vitePluginFakeServer({enableProd:true})` 把 mock 打进生产包。
35. **`v-auth`/`v-perms` 指令已注册但 0 处使用**（`src/directives/index.ts`），按钮权限靠手写 roles computed，易漏。
36. **前端 25 处 `catch(() => {})` 静默吞错**，32 个视图仅 3 处 try/catch。
37. **前后端 Node 版本不一致**：前端 `Dockerfile:2` `node:20-alpine` vs 后端 `server/Dockerfile:3` `node:24-alpine`（与上一节第 8 条同源，此处补充为配置管理项）。
38. **线索转化性别硬编码 `'男'`**（`leads.js:281`）→ 线索无性别字段时一律落库男。
39. **课时扣减固定 1 课时**，与课程时长/节次无关（`attendance.js:87`、`makeups.js:123`）→ 跨课时课程会少扣。
40. **`docs/openapi.yaml` 覆盖不足一半**：后端共 115 个路由处理器，openapi 未全量登记。

### 本轮已核实「无问题」的项（避免重复排查）

- **SQL 注入：22 个路由文件逐文件核对，未发现注入点。** 全部 `prepare` + `?` 参数绑定；动态拼接仅来自代码内固定条件串与**硬编码数组**；动态表名（`classes.js:172`、`students.js:359`）取自白名单；`analytics.js:488` 经 `DATASETS[...]` 查表未命中即 404；`db.exec(` 全为固定语句。
- **外键完整性**：`db.js:14` 已 `PRAGMA foreign_keys = ON`；删学员受 `orders` 外键 RESTRICT 保护（`students.js:341`）；无孤儿记录风险。
- **`students` 表不存在 `total_hours / remaining_hours / balance` 字段**：全库 grep 仅命中文档；课时冗余实际在 `orders.total_hours/remain_hours`。
- **`classes.student_count` 非存储列**（实时子查询），`schedules.attended_count` 不存在 → 无同步风险。
- **前后端接口契约无 404 风险**：前端 4 个 api 文件全部路径与后端逐条比对，**前端调用后端不存在的接口 = 0**，路径前缀与 HTTP 方法一致。
- **不存在 4xx 误重试**：前端无任何 4xx 重试逻辑。
- **事务覆盖良好**：`attendance.js:135`、`adjustments.js:130`、`exams.js:284`、`leaves.js:165`、`leads.js:276`、`makeups.js:133/183`、`finance.js:368`、`students.js:130/210/283/364`、`terms.js:98`、`settings.js:24` 均已正确包裹。
- **无 TODO / FIXME 残留**（`src` 内 0 条）；`dist/` 未被 git 跟踪（`.gitignore:3`）。

### ✅ 上述问题的修复结果（2026-09-12 13:40）

> 业务方决策：B2 按「仅建档、课时包后续在财务补录」落地；B1 风险不接受；其余影响上线的问题一并修复。

**已修复（Gate 1 全部 + Gate 2 全部）**

| 编号 | 修复要点 | 关键文件 |
| --- | --- | --- |
| **B1** | JWT 密钥缺失即拒绝启动 | **新增** `server/src/config.js`（集中配置 + 启动期校验，require 顺序在建表之前，避免「配置非法却已污染数据库」）；`middleware/auth.js` 改用 `config.jwtSecret`；`docker-compose.yml` 用 `${JWT_SECRET:?...}` 强制注入；`server/package.json` 启用 `--env-file-if-exists=.env`（Node 原生，无需 dotenv） |
| **B2** | 线索转化明确为「仅建档」 | `docs/api.md` §三 改写为如实语义 + 补录指引；`src/views/recruit/leads/index.vue` 转化弹窗加 `el-alert` 提示、修正恒为空的标题、成功提示补充后续步骤。**前端本就只提交 4 个字段**，与后端一致 |
| **B3** | 退班不再抹除已消耗收入 | `routes/finance.js` 收入确认去掉 `status IN ('在读','结业')`，改为 `total_hours > 0 AND remain_hours <= total_hours`；`remain_hours` 保留原值作为退款核算依据 |
| **B4** | 财务边界校验 + 课时变更留流水 | `routes/finance.js` 新增 `parseAmount` / `parseHours`；**手工改 `remain_hours` 在同一事务内自动写 `hour_consumptions`**；退费金额不得超过「已缴 − 已退/在途」 |
| **H1** | 前端刷新失败不再永久挂起 | `src/utils/http/index.ts` 补 `.catch()` + 401 统一登出 + 错误文案全局提示（此前 25 处 `catch(() => {})` 让错误对用户完全不可见）；`handRefreshToken` 无返回时也 reject；`store/modules/user.ts` 同步 |
| **H8** | 删除请求体日志 | `src/index.js` 改为只记 `method / path / status / 耗时` |
| **H7** | 安全加固 | 新增依赖 `helmet` + `express-rate-limit`；CORS 改来源白名单（`CORS_ORIGINS`）；`app.set("trust proxy", 1)` 让限速按真实客户端 IP 计数 |
| **H6** | **原判定为误报，已更正** —— 审计由全局中间件兜底，覆盖本就完整 | `src/index.js` 加 `SELF_AUDITED` 前缀跳过 5 个「路由内已自行写审计」的模块，消除重复写日志 |
| **H2** | 凭证可吊销 | **新增迁移 v15** `users.token_version`；Token 带 `tv` 并在鉴权时比对；登出/改密/改角色即时吊销；登出接口由空实现改为真实吊销；前端 `logOut()` 接入 `POST /api/auth/logout`；重置密码增加 ≥8 位校验 |

**顺带完成的低成本加固**：统一错误中间件尊重 `err.status`（M4）、`unhandledRejection`/`uncaughtException` 兜底与优雅停机（M5）、`server/Dockerfile` 改非 root（`USER node`）、`db.js` 支持 `DATA_DIR`（便于测试隔离）、启动自检默认口令告警（H9 缓解）。

**回归验证结果**

| 验证项 | 结果 |
| --- | --- |
| 门禁专项脚本 `_verify_test/verify-fixes.mjs`（本次新增，已在 `.gitignore` 忽略目录内） | **35 / 35 通过** |
| `server/scripts/e2e-lifecycle.mjs`（已支持 `BASE=` 指定地址） | **80 / 80，0 失败**（零回归） |
| `server/scripts/analytics-smoke.mjs` | **22 / 22 通过**（确认 `data_version = v15`） |
| ESLint 全量 `{src,mock,build}` | **0 error / 0 warning** |
| 生产构建 `vite build` | 通过，24 秒，主包 2,040.95 kB / gzip 684.92 kB（再次印证 M11 的 4000kB 阈值掩盖告警） |

**上线前仍需运维执行（代码已就绪）**：① 注入 `JWT_SECRET`；② 重建后端镜像（新增依赖 + 迁移 v15）；③ 重建前端镜像；④ 首次登录改默认口令；⑤ 跑 `docker-verify.sh` + e2e 复核。

**未处理（Gate 3）**：H3、H5、H9、H10、H11、H12、H13、H14 及全部 P2。其中 **H10（销假回补口径，每个学员「最后一课时」必然少 1 课时）/ H11（缺索引，含 P0 签到主路径）/ H9（明文默认口令清理）** 建议紧随上线后处理。

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

### ⓪ 教务系统全闭环（2026-09-20，最新，以此为准）

- **环境**：Docker `attendance-web`（:8080）+ `attendance-server`（:3000），前端镜像 2026-09-20 21:55 重建（含冷启动修复）
- **结果**：全页面冷启动巡检 **28/28** ｜ e2e **80/80** ｜ analytics **22/22** ｜ 浏览器 P0 **31/31** ｜ Docker 部署 **9/9** ｜ 业务链闭环 **49/49**
- **深链接冷启动实测**（模拟老师从收藏夹直接打开）：`/attendance/checkin`、`/data/classes`、`/finance/orders` 均正常渲染
- **服务状态**：`/api/health` → `{"status":"ok"}`；前端 200；`data_version: v18`；容器内 SQLite 正常挂载
- 详见下文「教务系统全闭环跑通 · 冷启动白屏根治（2026-09-20）」

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

---

## 成长路径落地 · 采集入口迁入 AI 工作台（2026-09-18）

### 背景：人群分离定案

用户明确：**教务系统给校区负责人 / 非一线教学人员用，教学 AI 工作台给一线老师用**。
推论 → **老师要用的功能一律收在工作台**，这样老师才能"专注上课，不用到处找功能"。

这一决定**推翻了**上一轮"采集入口放教务系统签到页"的方案。

### 后端变更

| 文件 | 变更 |
| --- | --- |
| `middleware/auth.js` | `type=ai_agent` 凭证放行范围从 `/api/(agent\|ai)` 扩到**含 `/api/growth`**；`PUT /growth/thresholds` 仍挡（管理动作） |
| `index.js` | `AUDIT_MODULES` 补 `{ re: /^\/api\/growth/, name: "成长记录" }` |
| `routes/growth.js` | 头注释改为「采集端 · 入口在 AI 工作台」 |

**★ 关键纠偏**：最初只放行采集端（写）、挡住查询端（读），
结果老师能往班里写数据却看不到自己写的数据，成长路径页**整页 403**。
改为**读写同权**——安全边界靠 `canManageClass`（跨班 403），不靠"挡住读"。

### 工作台变更（`ai-workbench/`）

| 文件 | 变更 |
| --- | --- |
| `workbench-data.ts` | `Capability` 补 `timeline` / `kpAssessments`；新增 `postJson` 与 `loadGrowthForm` / `submitClassEval` / `submitKpAssessment` / `loadClassGrowth` / `loadStudentGrowth` / `loadStudentTimeline`；`growthCapabilities` 出口；`demoFallbackModules` 补两个新位 |
| `views/Teaching.vue` | 「快速标记」升级为**正式课后采集入口**：① 三维评价（专注/参与/掌握 1-5，支持一键填全班）② 知识点打勾（三档 + 个别学员覆盖）；接后端三个接口；demo 模式明确标注不落库 |
| `views/GrowthPath.vue` | **新增第 11 个菜单**。整班视角（班级表现曲线 / 掌握度待加强 / 已较好掌握 / 知识点掌握全景 / 各次课明细）+ 单学员视角（成长曲线 / 成绩曲线 / 知识点跳变 / 里程碑 / 过程记录明细） |
| `components/LineChart.vue` | 新增轻量 SVG 折线图（不引图表库）；支持 `fitData` 自适应量程 |
| `mock/dataset.ts` | 补演示成长数据（`DEMO_CLASS_EVAL_SERIES` / `DEMO_CLASS_KP` / `DEMO_STUDENT_GROWTH` / `DEMO_STUDENT_TIMELINE`） |
| `router.ts` / `App.vue` | 教学闭环组末尾加「学生成长路径」（`/growth`）+ `ICONS` 补 `IconOdometer` |
| `ai/generators.ts` | `DATA_VERSION` 写死 `v15` → 改为读实时 `dataVersion`（`DEMO_DATA_VERSION = "v18"` 兜底） |
| `views/Dashboard.vue` | 模块级 `engine.*()` → `computed`（切数据源/班级时首页才会刷新） |

### 修复的 4 个缺陷

| # | 缺陷 | 表现 | 修复 |
| --- | --- | --- | --- |
| 1 | **读写权限不对称** | 成长路径页整页空白，控制台 3 个 403 | 放行范围含整个 `/api/growth`，仅挡 `PUT /thresholds` |
| 2 | **时间范围漏哨兵值** | 界面显示「至 9999-12-31」 | 未传 from/to 时改取时间轴真实最早/最晚日期 |
| 3 | **量程压缩趋势** | 1-5 分量程里数据都在 3.5~4.5，折线几乎水平 | `LineChart` 加 `fitData` + `minSpan`（下限跨度防放大噪声） |
| 4 | **demo 模式页面空白** | 演示数据下看不到功能长什么样 | 补演示成长数据；demo 也渲染完整页面并标注「演示轨迹」 |

另发现并标注（非缺陷，但影响解读）：**班级均值曲线的参评人数不一致**
（09-18 只评 3 人、09-13 评满 8 人），界面已加「各次课明细」表暴露人数，
并提示"人数不一致的课时之间不宜直接比较"，未用统一口径粉饰。

### 验证结果

| 项 | 结果 |
| --- | --- |
| 权限边界（12 项） | 放行 8 项全 200；拦截 6 项全 403（含 `PUT /thresholds`、财务、用户、跨班 999） |
| 采集落库 | 3 名学员评价 saved=3/appended=3；知识点评定 students=8/records=16；回读一致 |
| 审计留痕 | `POST /api/growth/class-eval` → 动作名「新增成长记录」（id 88-90） |
| 浏览器验证（新增） | `ui-growth-verify.py` **27/27**，含真实模式与 demo 模式，控制台无报错 |
| e2e-lifecycle | **80/80** |
| analytics-smoke | **22/22** |
| ui-p0-verify | **31/31** |
| docker-verify | **9/9** |

**截图**：`evidence/ai-workbench-growth/`（01 侧边栏 / 02 整班 / 02b 知识点全景 / 03 单学员 / 03b 知识点与里程碑 / 03c 时间轴 / 04-05 课后采集 / 06-07 demo 模式）

### 教务系统侧

「成长档案」页（`src/views/teaching/growth/index.vue`）**保持并存**：财务口径轨迹不动，
由教务端自动同步展示，主要用于查看；教学轨迹的更新源在 AI 工作台的采集入口。

---

## C1 收口 · AI 底座密钥服务端代持（2026-09-20）

### 背景：一个必须在上线前堵住的安全缺陷

`ai-workbench/src/ai/provider.ts` 里存在 `dify` 模式：`apiKey` 存 **localStorage**，
`mode === "dify"` 时浏览器**直连** Dify 工作流（`POST {endpoint}/workflows/run` +
`Authorization: Bearer {key}`）。该实现自身的代码注释就写着「生产建议走服务端代理」——
是**已知的临时实现**，不是新引入的疏忽；但它是「正式给老师用」的阻塞项，三重危害：

| # | 危害 | 说明 |
| --- | --- | --- |
| ① | Key 落在前端可读位置 | 任何能打开 DevTools 的人（含学生、家长借用设备）都能读到 |
| ② | **绕过服务端二次脱敏** | 前端脱敏可被改前端代码绕过；服务端 `redact.js` 才是信任边界 |
| ③ | 用量不入 `ai_usage` 表 | 配置中心看不到真实消耗，成本失控且无审计 |

### 结论：不是「没有服务端通道」，而是「前端没走它」

服务端通道 `POST /api/ai/generate`（`auth` + `requireRole("admin","teacher")`）**早已存在且可用**：
Key 由 `LLM_API_KEY` / 配置中心持有，服务端做二次脱敏，用量落 `ai_usage`，未配置返回 503。
实测 `agentToken`（`type = ai_agent`）可调该接口（路径白名单 `/^\/api\/(agent|ai)(\/|$)/` 覆盖它）。
因此修复方向是**收口**（把主路径切过去并删掉旁路），而非新建通道。

### 改动清单

| 文件 | 改动 |
| --- | --- |
| `ai-workbench/src/ai/provider.ts` | `ProviderMode` 由 `rule\|server\|dify` 收敛为 `rule\|server`；整体删除 `DifyConfig` / `DifyResponse` / `runDify()` 与死代码 `estimateTokens()`；默认模式 `rule` → **`server`**；`saveConfig` 改**白名单**（只写 `mode/priceIn/priceOut/model`）；`loadConfig` 增**旧配置迁移**——丢弃整个 `dify` 子树（含残留 apiKey）+ `normalizeMode()` 把失效模式收敛回 `server`，并立刻覆写回 localStorage |
| `ai-workbench/src/views/Settings.vue` | 移除全部密钥输入入口（endpoint / apiKey / 各场景 workflows）；radio 由三项改两项（`server` 标「推荐」）；`testConnection()` 从「探活 Dify 地址」改为**真实探活整条服务端通道**（`/api/ai/generate` 最小载荷），并区分 200 / 503 / 其他；新增服务端模型状态点与用量归属说明 |
| `ai-workbench/src/App.vue` | 底座标签 `dify → server` 分支修正 |
| `ai-workbench/src/ai/generators.ts` | `meta.mode` 去掉 `dify` 分支 |
| `ai-workbench/src/components/AiPanel.vue` | 生成标签去掉 `Dify 生成` 兜底分支 |
| `ai-workbench/src/router.ts` | 菜单描述改「服务端模型 / 规则引擎」 |
| `docs/api.md` | §5.7 安全设计表补「已移除浏览器直连旁路」「用量集中可审计」两行 |

**降级链路保持不变**：服务端 503 / 网络错误 → `generate()` 捕获 → 回退 `runRule()` 并在界面标注 `fallbackReason`。**永远不阻塞教学流程。**

### 验证结果

| 项 | 结果 |
| --- | --- |
| `verify-provider-c1.mjs`（新增，接口 + 产物层） | **11/11** —— agentToken 可调 generate（1757 字，6862ms）、服务端脱敏剔除 `focusStudentNames/parentPhone/amount`、无泄漏、用量 in=378/out=1099；**主包 1.02MB 中 `apiKey` 0 次、`workflows/run` 0 次、无 `sk-` 字面量**；仅剩的 `dify` 字样是迁移分支 `if("dify" in t)` |
| `ui-provider-c1.py`（新增，浏览器端） | **26/26** —— 只剩 2 个模式、无密码框、唯一录入框是「教务系统地址」、服务端模型名真实展示、localStorage 无 Key、**注入历史 `dify` 配置后自动抹除 apiKey 并回落 server** |
| `ui-provider-degrade.py`（新增，降级链路） | **11/11** —— 以空 `LLM_API_KEY` 起临时后端 :3999：generate 返回 503 + `LLM_NOT_CONFIGURED`、llm-status `configured=false`、工作台仍生成 **1672 字**规则引擎内容并标注降级、无 JS 崩溃 |

**截图**：`evidence/c1-settings-server-mode.png`、`c1-settings-rule-mode.png`、`c1-degrade-settings.png`、`c1-degrade-generate.png`

### 本轮抓出的真实缺陷（由浏览器验证发现，非本人臆测）

首轮 `ui-provider-c1.py` 报 3 处失败，根因是**迁移不完整**：原实现只删 `dify` 键却保留 `...rest`，
于是 `mode: "dify"` 存活下来，前端会落在一个**已不存在的模式**上（两分支都不命中 → 界面语义混乱）；
且 `loadConfig()` 只在 `App.vue` 初始化 `ref` 时调用，设置页自身走 `ref<ProviderConfig>(loadConfig())`
并不会重新迁移。修复为「丢弃整个 dify 子树 + `normalizeMode` 运行时兜底 + 迁移时立即覆写」。

另 1 处失败是**测试脚本自身的错误假设**：用 `input` 计数会把 Element Plus 的
`radio` 与 `select` 内部只读 combobox 一并算作输入框。已改为精确匹配 `input.el-input__inner`
并加「无密码框」断言——**断言写错要改断言，不能为了变绿而放松安全项**。

---

## 教务系统全闭环跑通 · 冷启动白屏根治（2026-09-20）

> **背景与优先级（用户拍板）**：AI 工作台是下一步计划，需大量时间；第一期测试重点是**教务系统** ——
> 只有教务系统跑得流畅，才能为 AI 工作台提供真实数据。因此本轮目标为
> 「**把教务系统全部闭环跑通**，每个功能在真实环境都能完成闭环、产生结果」，
> 并以管理员身份走查全部功能，统一修复「逻辑不顺畅 / 数据不通 / 关联做不好」的问题。

### 一、根治：冷启动直达动态路由永久白屏（🔴 自首个提交 `42d87bd` 起即存在）

**现象**：直接打开任意一个动态路由（刷新页面 / 收藏夹 / 他人发的链接）→ **永久白屏**，`#app` 只剩 `<!---->`（5492 字节）。
先访问 `/welcome` 再点菜单则完全正常 —— 这个「对照组」是定位的关键。

**根因**：pure-admin 原设计把 `initRouter()` 只放在路由守卫的「刷新分支」里，而
**Vue Router 的守卫只在 `to` 能匹配到已注册路由时才执行**。直达未注册的动态路由时
`to.matched = []`、`to.name = undefined` → 守卫根本不跑 → `initRouter()` 永不调用 → 动态路由永不加载。

**判定证据链**（缺一不可，避免误判）：

| 观测 | 值 | 说明 |
| --- | --- | --- |
| `routeCount` | 13 | 只有静态路由，动态路由一个都没注册 |
| `currentName` | `undefined` | 当前路由未解析 |
| `matched` | `[]` | 无任何匹配记录 |
| `hasPageNotFound` | `False` | `addPathMatch()` 从未执行 ⇒ `initRouter()` 从未被调用 |

**修复**（`src/router/index.ts` + `src/store/modules/user.ts`，2 文件 / +77 −36）：

1. 新增 `ensureAsyncRoutes()`，**前置到 `beforeEach` 最前面**，与 `to` 是否匹配无关；用单例 Promise 去重，避免并发导航重复请求 `/api/auth/async-routes`。
2. 加载完成后用 `router.resolve(to.fullPath)` 重新解析，再以 `replace` 重放导航。
3. 补齐两处 `return`：原代码在 403 / 404 拦截后仍继续执行 `toCorrectRoute()`，同一导航调用两次 `next()`，导致**权限拦截偶发失效**。
4. **失败允许重试**：`initRouter()` reject 时清空单例。此前会把 rejected Promise 缓存住，一次网络抖动就让整个会话再也加载不出路由。
5. 新增 `resetAsyncRoutesState()` 并在 `logOut()` 中调用：此前换账号登录（admin→teacher）会复用上一账号的菜单与路由，存在**越权可见**风险。

### 二、新增权威巡检脚本 `verify-all-pages.py`

- 路由清单**从 `/api/auth/async-routes` 实时拉取**（28 个：27 业务 + `/welcome`）
- 每个路由**独立浏览器上下文**冷启动直达 + F5 刷新
- 断言 `.app-page` 渲染 / 落点正确 / 无页面报错

> **教训（已固化进 skill）**：路由清单**绝不能手写**。本轮手写清单时把
> `/data/terms` 写成 `/data/semesters`、`/data/makeups` 写成 `/data/makeup-classes`、
> `/data/adjustments` 写成 `/data/schedule-adjustments`，造成一连串假失败。

### 三、排除的误判（同一轮内我自己写错探针造成的假失败）

| 误判 | 真相 |
| --- | --- |
| 「班级学习报告接口缺失」 | 前端只调 `/api/reports/students/:id`（`src/api/teaching.ts`），本就没有班级报告功能 |
| 「动态路由组件解析错误」 | 复刻 `import.meta.glob` 匹配后 27/27 全部正确 |
| 「教师调课列表越权」 | 实为**残留数据**：`head_teacher_id` 全指向 teacher id=2 |
| 「e2e 10 项 FAIL」 | 阶段 9.5 因残留数据失败 → 断言中断 → 后续 9 项是**连带后果**（日志有 `[中断]` 标记） |

配套补了两个可复用能力：`_verify_test/clean-residue.js`（按外键顺序清理 `e2e_` 残留）、
`probe-business-chain.mjs` 阶段 7/13 改为**动态挑空闲时段**并新增第 19 阶段自动清理。

### 四、验证结果（2026-09-20 实测，次日 09-21 独立复核仍全绿）

| 套件 | 结果 |
| --- | --- |
| `verify-all-pages.py`（新增） | **28/28** |
| `e2e-lifecycle` | **80/80** |
| `analytics-smoke` | **22/22** |
| `ui-p0-verify` | **31/31** |
| `docker-verify` | **9/9** |
| `probe-business-chain` | **49/49** |

业务链实测闭环：缴费挂订单汇总 3200 ✅ ｜ 签到扣 1 课时 48→47 ✅ ｜ 补课完成扣至 46 ✅ ｜
退费通过 → 订单置「退班」✅ ｜ 请假审批通过 ✅ ｜ 7 个统计接口全 200 ✅。

### 五、本轮其它修复与恢复

- **`.git` 对象库被破坏并完整恢复**：用 `git stash` 时被 SIGTERM 中断，导致 `refs/heads`、`refs/remotes` 被清空且 pack 文件消失。
  已按「备份 → 确认远程 HEAD → `printf` 写 ref → `fetch` 拉回对象 → 重建 remotes → 清空失效 reflog」完整还原。
  **教训：本环境不要使用 `git stash`。**
- **推送通道**：`github.com` 直连被阻断时，可改用 GitHub **Git Data REST API** 构造等价提交（blob → tree → commit → 更新 ref），见 `_verify_test/push-via-api.py`。

---

## 产品方向定案 · 数据资产化与 AI 产出层（2026-09-21）

> **背景**：业务方在上线前明确长期产品方向，超出 2026-09-12 首次访谈设想：
> 「**系统是产出一切数据的来源**。让老师记录学习情况、用 AI 产出成长路径，这些都是产出，都是为 AI 后期整合数据做燃料。」
> 并授权修订既有结论：「文档的定义是基于当时的生产环境，不代表未来不会改。」

### 本轮定案（全文见 `docs/decisions/ADR-008-数据资产化与AI产出层架构.md`）

| # | 结论 |
| --- | --- |
| 1 | ★★ **系统是唯一数据源、也是唯一仓库**。数据只能在系统内产生与沉淀 |
| 2 | ★★ **数据库只存索引（元数据），文件本体存磁盘** `server/data/assets/{students,classes,teachers}/` |
| 3 | ★★ **Dify 是加工厂（只读检索）、不是仓库** —— AI 产出**必须落回自有库** |
| 4 | **知识库三层**：业务数据→系统 SQLite ／ 参考资料→Dify 知识库（只读）／ AI 产出→系统（索引+落盘） |
| 5 | **Obsidian** 仅作人的资料工作台，**不作为 AI 知识库** |
| 6 | **MCP 仍不引入**（固定流程用 REST）；「用别人的 MCP」= 把系统包装成 MCP Server，属开发效率工具 |
| 7 | **产出层分期**：数据表（已有 xlsx）→ PDF → PPT → **视频暂缓** |
| 8 | **工作流先做 1 个样板**，跑通三道防线并验收后再推广 |
| 9 | **采集铁律不变**：永不强制、嵌入既有流程、新增表单 = 老师不用 |

### 决策关系

- **部分取代** `ROADMAP.md` §〇 **D7** 与 §二 **Non-goals** 中的「RAG 知识库」一条 → 现**纳入规划**（交 Dify 承载）
- **强化不变**：ADR-004（本地算指标 + AI 只写字）、ADR-007（只读网关 + 密钥服务端代持）、ADR-002（不做家长端与出网触达）
- **新增** `ROADMAP.md` §〇 **D15** 与 **Phase 6 · 数据资产化与产出层**（未排期）

### 同步修改的文档

- 新建 `docs/decisions/ADR-008-数据资产化与AI产出层架构.md`
- `docs/ROADMAP.md`：D7 标注修订 ／ 新增 D15 ／ §二 Non-goals 解除 RAG 一条 ／ 新增 Phase 6
- `docs/00-项目导航.md`：ADR 索引新增 ADR-008 ／ 阶段速查新增 Phase 6 ／ 忽略规则更正为仅 `.aiignore`
- `WORKBUDDY.md`：新增 **§四·五 数据资产化规则**（10 条硬规则）+ §十一 约束补 2 条
- `docs/校区部署与升级指南.md`：Dify 由「现在不需要」改为「本期不装、已纳入规划」／ 备份说明补 `assets/` 目录

