// 全量铺开：把「班级管理」页确立的页面骨架机械应用到其余业务页面。
//
// 只做两件事 —— 其余视觉统一由全局样式层承担
// （tokens.scss / page.scss / element-plus-override.scss 已覆盖表格、卡片、
//   表单、按钮、弹窗、空状态，因此不需要逐页改这些）：
//   1. 根容器 class="p-4" → class="app-page"（统一页面留白节奏与响应式内边距）
//   2. 注入 AppPageHeader（标题 + 一句话说明），补齐页面信息层级
//
// 注意：这些 .vue 文件是 CRLF 行尾，插入内容必须跟随文件自身的行尾，否则
// 整个文件会被 git 视为重写。脚本按文件检测并沿用其换行符。
// 幂等：已含 AppPageHeader 的页面直接跳过。
//
// 用法：node _verify_test/apply-page-skeleton.mjs
import fs from "node:fs";

// [相对路径, 页面标题, 一句话说明]
// 说明文案只回答「这页解决什么问题」，不复述界面上已能看到的信息。
const PAGES = [
  [
    "src/views/attendance/checkin/index.vue",
    "考勤登记",
    "按当日课表点名，记录正常、迟到、早退、缺勤与请假"
  ],
  ["src/views/attendance/records/index.vue", "考勤记录", "查询与订正历史考勤；缺勤不扣课时"],
  ["src/views/attendance/leaves/index.vue", "请假管理", "登记请假与销假，回补相应课时"],
  ["src/views/attendance/statistics/index.vue", "统计报表", "出勤与课时的多维统计"],
  ["src/views/attendance/students/index.vue", "学生管理", "学员档案、分班与批量导入"],
  ["src/views/attendance/courses/index.vue", "课程管理", "课程与课时单价维护"],
  ["src/views/attendance/schedules/index.vue", "课程表", "按班级与星期编排上课时段"],
  ["src/views/attendance/terms/index.vue", "学期管理", "学期起止与当前学期"],
  [
    "src/views/attendance/adjustments/index.vue",
    "调课审批",
    "教师提交调课申请，管理员审批"
  ],
  ["src/views/attendance/makeups/index.vue", "补课管理", "缺课的补课安排与销课"],
  [
    "src/views/attendance/users/index.vue",
    "员工账号",
    "教务管理员与任课教师的账号、角色与数据权限"
  ],
  ["src/views/recruit/leads/index.vue", "线索管理", "招生线索跟进与转化"],
  ["src/views/family/notifications/index.vue", "通知记录", "已发送的家校通知存档"],
  ["src/views/teaching/exams/index.vue", "成绩管理", "成绩录入、等级换算与导出"],
  ["src/views/teaching/reports/index.vue", "学习报告", "按学员生成阶段性学习报告"],
  ["src/views/teaching/growth/index.vue", "成长档案", "学员在校期间的成绩、出勤与课时轨迹"],
  ["src/views/finance/orders/index.vue", "报班管理", "报名订单与学员账户余额"],
  ["src/views/finance/payments/index.vue", "缴费记录", "收款流水与导出"],
  ["src/views/finance/refunds/index.vue", "退费管理", "退费申请与审批；通过后退班"],
  ["src/views/finance/statistics/index.vue", "财务统计", "收入确认与欠费概览"],
  ["src/views/finance/business/index.vue", "经营报表", "营收、招生与课消的经营口径汇总"],
  ["src/views/finance/consumption/index.vue", "课消统计", "课时消耗明细与汇总"],
  ["src/views/system/settings/index.vue", "系统参数", "机构信息与业务参数维护"],
  ["src/views/system/notices/index.vue", "通知公告", "面向员工的通知发布与置顶"],
  ["src/views/system/backups/index.vue", "数据备份", "数据库备份、下载与恢复"],
  ["src/views/system/audit-logs/index.vue", "审计日志", "关键操作的留痕记录"]
];

const HEADER_IMPORT = 'import { AppPageHeader } from "@/components/AppPageHeader";';

let written = 0;
const report = [];

for (const [file, title, desc] of PAGES) {
  if (!fs.existsSync(file)) {
    report.push(`MISS   ${file}`);
    continue;
  }

  const before = fs.readFileSync(file, "utf8");
  let src = before;
  const eol = src.includes("\r\n") ? "\r\n" : "\n";

  // ── 1) 根容器 ────────────────────────────────────────────────────────────
  const rootRe = /^([ \t]*)<div class="p-4">/m;
  if (!rootRe.test(src)) {
    report.push(`WARN   ${title}  未找到根容器 <div class="p-4">，跳过`);
    continue;
  }
  src = src.replace(rootRe, '$1<div class="app-page">');

  // ── 2) 页头 ──────────────────────────────────────────────────────────────
  if (!src.includes("AppPageHeader")) {
    // 2a) import：插到最后一个 import 语句之后（兼容多行 import 的收尾行）
    const lines = src.split(eol);
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^import\s/.test(t) || /^}\s*from\s+["']/.test(t)) lastImport = i;
    }
    if (lastImport < 0) {
      report.push(`WARN   ${title}  未找到 import 位置，跳过页头注入`);
      continue;
    }
    lines.splice(lastImport + 1, 0, HEADER_IMPORT);
    src = lines.join(eol);

    // 2b) 组件：插到根容器之后（用 indexOf 而非正则，避免行尾差异踩坑）
    const anchor = `<div class="app-page">${eol}`;
    const at = src.indexOf(anchor);
    if (at < 0) {
      report.push(`WARN   ${title}  根容器锚点未命中，页头未注入`);
      continue;
    }
    const header = `    <AppPageHeader title="${title}" description="${desc}" />${eol}`;
    const cut = at + anchor.length;
    src = src.slice(0, cut) + header + src.slice(cut);
  }

  if (src !== before) {
    fs.writeFileSync(file, src);
    written++;
    report.push(`OK     ${title}   ${file}`);
  } else {
    report.push(`SKIP   ${title}  （无变化）`);
  }
}

console.log(report.join("\n"));
console.log(`\n共 ${PAGES.length} 个页面，写入 ${written} 个`);
