# CURSOR · 当前进度（L0）

> ★ 每次会话必读，每次会话**整体覆写**。只留「主线 + 阻塞 + 下一步」，细节去 `logs/` 与 `knowledge/`。
> 覆写时间：2026-10-21（10-20 无会话；10-18 曾有两个会话并行改同一工作区，10-19 版为合并版，本版在其基础上更新推送状态）

## ⏸ 主线 A（10-18 第一场）· 业务逻辑审查 → v30 实现 —— **✅ 代码完成并已提交/推送，⛔ 等实测**

报告 `docs/08-参考/业务逻辑关联性审查-2026-10-18.md`（P0×2/P1×3/P2×3）→ 全部修复 + 新增 v30：
课次多课时 `class_sessions.hours`｜学员软删除 `students.deleted_at`｜课时单位常量化；DB v28→v30（生产库已迁移，备份 `server/data/attendance-before-v30-20261018132603.db`）。
**实测入口**：Docker `http://127.0.0.1:18080`（v30 构建）；待验：软删/恢复/有订单拦截、课次改课时数后点名扣 2、删有课次班级被拒、转班后历史课消归属。

## ⏸ 主线 B（10-18 第二场 → 10-19）· 业务逻辑深测 + 修复 —— **✅ 修复完成并已提交/推送，⛔ 等用户实测**

- 业务逻辑深测：`_verify_test/_tmp/reports/bizlogic-deep-2026-10-18.md`（新增 P0×2/P1×6：考勤 oldStatus 丢状态致重复扣/不回补、补课绕课次 hours 护栏、余额截断台账发散、legacy 多课时只扣 1、软删写入口/计数未封堵…）
- 修复报告：`_verify_test/_tmp/reports/fix-summary-2026-10-19.md`（P0 2/2、P1 10/10、业务相关 P2 17/19）
- 验证：Lead 回归 29/29｜api-full-suite 89/0/1WARN｜vue-tsc 0 错｜eslint 0 错｜run-gates 6/6｜UI 回归 A–E 全 PASS｜`pnpm audit --prod` high 26→0
- **实测入口**：<http://127.0.0.1:8848>（生产构建 + 隔离库 3131；**含本轮全部修复**）；重点：待办失败提示/不假成功、teacher 班级筛选、考勤重复提交、月度报表、备份/Logo、改资料后刷新

## 2026-10-21 · 推送记录（git-local.md K-082 实操）

- 全部改动分三组提交并推送 gitee main：① 代码主体（v30 + 深测修复 + 工程线）② 门禁接线（husky v9 + pre-commit run-gates + CI）③ 文档与记忆。
- 补录 `server/docs/030-session-hours-soft-delete-model-review.md`（pre-commit 迁移门禁要求，结论：通过，注明补录）。
- 「审查报告入 docs/08-参考」此前的待拍板项随本次推送一并落地（入库 + 00-导航 登记）；详见 `logs/2026-10-21.md`。
- 校验判据：远端 SHA == `git rev-parse HEAD`（K-082：不以退出码 / ls-remote 为准）。

## 下一步

1. 请用户实测（K-019）：代码虽已推送，但**v30 + 深测修复未经用户实测**；入口 18080（v30 构建，**不含主线 B 修复**）/ 8848（含全部修复）。通过后再谈服务器同步。
2. **Docker 18080 不含主线 B 修复**；是否重建统一入口 Docker → 待用户拍板（K-020）。
3. 未修项：员工停用（需迁移+产品决策）、refresh 轮换、首屏拆包、导出截断提示、OpenAPI 86 端点、主库测试残留清理、公网 TLS、P3 类；v30 历史 `session_id=NULL` 流水未回填（对账脚本已入库：`server/scripts/reconcile-hours-ledger.mjs`，默认 dry-run）。
4. 其他仍挂：v29 学员档案/对账、使用指南、智能题库、数据可视化（未提交未推送）。

## 原则（用户拍板）

- **K-032** 先教务系统 → 再 AI 工作台 ｜ **K-027** 本地=服务器、只推 gitee
- **K-020** 重建生产 docker 单独问 ｜ **K-018** 需求未澄清不动手
- **K-019** 功能做完先开环境给用户测 ｜ **K-050** **静默即缺陷** ｜ **K-085** 上传/推送排除测试数据
- **K-091** 记账层按实际发生额、回补按原考勤净扣封顶 ｜ **K-092** 软删必须全链路扩散 ｜ **K-093** 门禁一键化（run-gates/husky/CI）

## ⚠ 本机硬红线

- **禁用 `git rm`**（K-028）｜ push 挂死主因是 GCM（K-082）
- 中文目录 → 两步法构建 + `up -d --force-recreate --no-build`（K-040）+ 重建 server 后 `nginx -s reload`
- ★ **不要用宿主机进程在容器运行时写库**（K-053）
- ★ 本地 `vite build` 用 `node node_modules/vite/bin/vite.js build`（`pnpm build`/`npx vite build` 会挂）
- ⚠ `check-guide.mjs` 需 `node --experimental-strip-types`（run-gates 已自动处理）
