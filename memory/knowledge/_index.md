# 知识索引（L1 · 一行一条）

> 格式：`id | 类型 | 主题 | 一句话结论 | 详情文件#锚点 | 状态 | 更新于 | 来源`
> 规则：**同主题只允许一行**。新增前先搜同主题，命中就合并（更新「更新于」，旧来源留在详情里）。
> 上限 6 KB，超限就合并同主题 / 详情外移。状态：`active` / `deprecated`。

```
K-001 | Convention | 前端 | 新增或改动前端页面必读 | docs/03-开发指南/前端两端差异.md | active | 2026-09-21 | 09-21 文档分层
K-002 | Pitfall | 前端·工作台 | CSS 变量是 --c-*，写成 --brand/--line 静默失效 | docs/03-开发指南/前端两端差异.md#工作台 | active | 2026-09-21 | 事故：整页无样式
K-003 | Pitfall | 前端·观感 | 新增页面没照抄同类页面 → 用了原生控件，被质疑像「白板」 | docs/03-开发指南/前端两端差异.md | active | 2026-09-21 | 用户质疑后返工
K-004 | Convention | 后端 | 改后端 / 新建表 / 动数据库必读 | docs/03-开发指南/后端与数据.md | active | 2026-09-21 | 09-21 文档分层
K-005 | Pitfall | 后端·sqlite | node:sqlite 裸封装无 .transaction()，调用报 is not a function | docs/03-开发指南/后端与数据.md | active | 2026-09-21 | 实测踩坑
K-006 | Pitfall | 后端·WAL | 删数据不 wal_checkpoint → 重启后数据复活 | docs/03-开发指南/后端与数据.md | active | 2026-09-21 | 实测踩坑
K-007 | Convention | 部署 | 改 nginx / docker / 部署必读 | docs/06-部署/运维约定.md | active | 2026-09-21 | 09-21 文档分层
K-008 | Pitfall | 部署·nginx | `^~ /assets/` 害工作台整页白屏，应写 /assets/site/ | docs/06-部署/运维约定.md | active | 2026-09-21 | 事故：整页白屏
K-009 | Convention | 权限 | 任何「谁能看到什么」的改动必读 | docs/03-开发指南/权限模型.md | active | 2026-09-21 | 09-21 文档分层
K-010 | Convention | 测试 | 写验证脚本 / 加断言必读 | docs/03-开发指南/测试与验证.md | active | 2026-09-21 | 09-21 文档分层
K-011 | Pitfall | 测试 | 只测 admin 会漏掉整类权限问题，必须双角色对照 | docs/03-开发指南/测试与验证.md | active | 2026-09-21 | 实测踩坑
K-012 | Convention | 环境 | 跑命令 / 推代码 / 环境诡异必读 | docs/03-开发指南/环境坑与工具.md | active | 2026-09-21 | 09-21 文档分层
K-013 | Pitfall | 工具 | grep -r + 通配符会静默返回空 → 据此得出过错误结论 | docs/03-开发指南/环境坑与工具.md | active | 2026-09-21 | 静默失败，最危险
K-014 | Convention | 产品边界 | 判断「该不该做 / 该放哪」必读 | docs/03-开发指南/产品边界与AI.md | active | 2026-09-21 | 09-21 文档分层
K-015 | Decision | 数据资产化 | 系统是唯一数据源与唯一仓库；文件不入库（索引进库 + 文件落盘） | docs/07-架构与决策/ADR/ADR-008-数据资产化与AI产出层架构.md | active | 2026-09-21 | 用户拍板 D15
K-016 | Decision | 推进顺序 | 教务系统闭环优先于一切新功能；AI 工作台须先收集老师意见 | docs/07-架构与决策/ROADMAP.md#D14 | active | 2026-09-20 | 用户拍板 D14
K-017 | Decision | AI 架构 | 独立工作台 + 只读网关 + 最小权限凭证，密钥服务端代持 | docs/07-架构与决策/ADR/ADR-007-AI能力采用独立工作台加只读网关与最小权限凭证.md | active | 2026-09-14 | ADR-007
K-018 | Preference | 工作方式 | ★ 需求未澄清不动手，产出《需求确认》用户点头前不写代码 | memory/knowledge/preferences.md | active | 2026-09-21 | 用户原话
K-019 | Preference | 交付门禁 | ★ 功能做完先开环境给用户测，不通过不得进文档/推送；禁止自己跑完沙箱就宣布完成 | memory/knowledge/preferences.md | active | 2026-09-21 | 教训：沙箱无 nginx 层
K-020 | Preference | 部署 | ★ 重建生产 docker 是最后一步，单独问用户 | memory/knowledge/preferences.md | active | 2026-09-21 | 流程铁律
K-021 | Preference | 待办 | ★ 待办学籍端 + AI 工作台两端都要（用户被质疑后重申） | memory/knowledge/preferences.md | active | 2026-09-21 | 用户重申
K-022 | Fact | 环境 | 前端 dev 8848 / 后端 3000 / docker 前端 8080 / 工作台 8082；默认账号 admin、teacher | memory/INDEX.md#1 | active | 2026-09-21 | 实测
K-023 | Convention | 文档 | 文档体系已按规范重组（00-导航 / 01-规范 / 02~08 分域 + archive）；写或改文档前先读规范 | docs/01-文档规范.md | active | 2026-09-21 | 用户要求全面整理
K-024 | Convention | 推送·公开仓库 | 推公开仓库前必扫 `.env`/`*.db`/`evidence/` 等敏感数据；本机 git 配了失效死代理(127.0.0.1:7890/.env 14564)，直连用 `git -c http.proxy= -c https.proxy=` + 清 `HTTP(S)_PROXY` 绕过 | memory/logs/2026-09-21.md#20:10 | active | 2026-09-21 | 推 gitee 实测
```
