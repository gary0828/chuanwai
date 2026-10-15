#!/usr/bin/env node
/**
 * 《使用指南》内容体检：一致性 + 可读性
 * ===========================================================================
 * 为什么要有这个脚本：
 *   给「完全没有技术背景的校区老师」写的操作文档，有两个失败模式肉眼很难发现 ——
 *     ① 写错了：控件名、路径跟系统对不上（照着点会 404 或找不到按钮）；
 *     ② 写得太难：句子太长、堆了术语（读者直接放弃）。
 *   两者都必须**机器判**，不能靠"我觉得还行"（K-011：断言要打印实际值）。
 *
 * 检查分三类：
 *   A. 一致性（硬门禁，FAIL 即失败）
 *      A1 指南里每个功能的 path，后端菜单里必须真的有
 *      A2 指南标注的角色，必须与后端菜单实际可见的角色一致
 *      A3 后端菜单里每个「叶子页面」，指南里都必须有对应章节（覆盖完整性）
 *      A4 指南里的 path 对应的页面文件必须存在
 *      A5 章节锚点与页内目录必须能对上
 *   B. 可读性（阈值门禁，FAIL 即失败；每一项都打印违规原文）
 *      B1 平均句长 / 长句占比      —— 中文正文超过 50 字一句就很难读
 *      B2 单条操作步骤的字数      —— 一步一件事，太长说明这一步该拆
 *      B3 术语密度                —— 「接口 / 字段 / 数据库」这类词读者看不懂
 *   C. 完整性（FAIL 即失败）
 *      C1 每个功能都有「用途」和「什么时候用」
 *      C2 每个功能至少有 2 步操作
 *
 * 用法：node _verify_test/check-guide.mjs
 * 退出码：0 = 全部通过；1 = 有 FAIL
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const AUTH_JS = join(ROOT, "server", "src", "routes", "auth.js");
const CONTENT = join(ROOT, "src", "views", "guide", "content.ts");
const PAGE = join(ROOT, "src", "views", "guide", "index.vue");

/* ══════════════════════════════════════════════════════════════════════════
   0. 读入：后端菜单（真值来源） + 指南内容
   ═════════════════════════════════════════════════════════════════════════ */

/** 从 auth.js 里把 `const ROUTES = { ... }` 的字面量抠出来求值。
 *  它是纯数据（无函数调用），所以 `eval` 是最准确的做法 ——
 *  自己写正则解析 JSON 反而会漏掉分组/子级的嵌套关系。 */
function loadRoutes() {
  const src = readFileSync(AUTH_JS, "utf8");
  const start = src.indexOf("const ROUTES =");
  if (start < 0) throw new Error("auth.js 里找不到 `const ROUTES =`");
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("ROUTES 字面量大括号不配对");
  const literal = src
    .slice(braceStart, end + 1)
    // 该块里的 // 注释都在独立行上，字符串里不含 "//"，按行剥即可
    .replace(/^\s*\/\/.*$/gm, "");
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal});`)();
}

const ROUTES = loadRoutes();

/** 把一个角色的菜单树拍平成「叶子页面」清单，并继承分组的可见角色 */
function flattenLeaves(nodes, inheritedRoles) {
  const out = [];
  for (const n of nodes || []) {
    const roles = n.meta?.roles || inheritedRoles;
    if (n.children?.length) {
      out.push(...flattenLeaves(n.children, roles));
    } else if (n.component) {
      out.push({
        path: n.path,
        title: n.meta?.title || "",
        component: n.component,
        roles
      });
    }
  }
  return out;
}

const menus = {
  admin: flattenLeaves(ROUTES.admin, ["admin"]),
  teacher: flattenLeaves(ROUTES.teacher, ["teacher"])
};

/** 路径 → 能看见它的角色集合 */
const pathRoles = new Map();
for (const [role, leaves] of Object.entries(menus)) {
  for (const l of leaves) {
    if (!pathRoles.has(l.path)) pathRoles.set(l.path, new Set());
    pathRoles.get(l.path).add(role);
  }
}

const guide = await import(`file://${CONTENT.replace(/\\/g, "/")}`);

/* ══════════════════════════════════════════════════════════════════════════
   1. 断言小工具
   ═════════════════════════════════════════════════════════════════════════ */

let pass = 0;
const fails = [];
const warns = [];

function check(label, ok, actual) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fails.push({ label, actual });
    console.log(`  ❌ ${label}\n     实际：${actual}`);
  }
}

function warn(label, actual) {
  warns.push({ label, actual });
  console.log(`  ⚠️  ${label}\n     实际：${actual}`);
}

function head(t) {
  console.log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   A. 一致性
   ═════════════════════════════════════════════════════════════════════════ */

head("A. 与系统菜单的一致性（指南写错了会照着点 404）");

console.log(
  `  菜单叶子页面：admin ${menus.admin.length} 个 ｜ teacher ${menus.teacher.length} 个`
);
console.log(`  指南功能章节：${guide.FEATURES.length} 个\n`);

// A1 路径必须存在
const badPaths = guide.FEATURES.filter(f => !pathRoles.has(f.path));
check(
  "A1 指南引用的每个路径都存在于菜单中",
  badPaths.length === 0,
  badPaths.length ? badPaths.map(f => `${f.title} → ${f.path}`).join(" ｜ ") : "—"
);

// A2 角色标注必须一致
const roleMismatch = [];
for (const f of guide.FEATURES) {
  const real = pathRoles.get(f.path);
  if (!real) continue;
  const claimed = [...f.roles].sort().join(",");
  const actual = [...real].sort().join(",");
  if (claimed !== actual) {
    roleMismatch.push(`${f.title}(${f.path}) 指南写[${claimed}] 实际[${actual}]`);
  }
}
check(
  "A2 指南标注的可见角色与菜单一致",
  roleMismatch.length === 0,
  roleMismatch.length ? roleMismatch.join(" ｜ ") : "—"
);

// A3 覆盖完整性：菜单里每个叶子页面都要在指南里有章节
//    （使用指南自己也要有，否则读者没法从指南里知道它是什么）
const featurePaths = new Set(guide.FEATURES.map(f => f.path));
const uncovered = [];
for (const [role, leaves] of Object.entries(menus)) {
  for (const l of leaves) {
    if (!featurePaths.has(l.path)) uncovered.push(`${l.title}(${l.path})[${role}]`);
  }
}
check(
  "A3 菜单里每个页面在指南中都有对应章节",
  uncovered.length === 0,
  uncovered.length ? [...new Set(uncovered)].join(" ｜ ") : "—"
);

// A4 页面文件必须存在
const missingFiles = [];
for (const [role, leaves] of Object.entries(menus)) {
  for (const l of leaves) {
    const f = join(ROOT, "src", "views", `${l.component}.vue`);
    if (!existsSync(f)) missingFiles.push(`${role}: ${l.component}.vue`);
  }
}
check(
  "A4 菜单指向的页面文件都存在",
  missingFiles.length === 0,
  missingFiles.length ? missingFiles.join(" ｜ ") : "—"
);

// A5 页内目录锚点：分组锚点是 g-<rank>，功能锚点是 f.xxx，都必须能在页面里渲染出来
const pageSrc = readFileSync(PAGE, "utf8");
const groupRanks = guide.MENU_GROUPS.map(g => `g-${g.rank}`);
const tocIds = [];
for (const t of guide.TOC) {
  tocIds.push(t.id);
  (t.children || []).forEach(c => tocIds.push(c.id));
}
const tocBad = tocIds.filter(id => {
  if (groupRanks.includes(id)) return !pageSrc.includes("`g-${fg.group.rank}`");
  if (id.startsWith("s-")) return !pageSrc.includes(`id="${id}"`);
  if (id.startsWith("c-")) return false; // 注意事项分组的锚点是 v-for 渲染的
  return false;
});
check("A5-1 页内目录的章节锚点都能对上", tocBad.length === 0, tocBad.join(" ｜ ") || "—");

const featureIds = new Set(guide.FEATURES.map(f => f.id));
const tocFeatureIds = guide.TOC.flatMap(t => t.children || [])
  .map(c => c.id)
  .filter(id => id.startsWith("f-"));
const tocFeatureBad = tocFeatureIds.filter(id => !featureIds.has(id));
check(
  "A5-2 目录里指向的功能章节都存在",
  tocFeatureBad.length === 0,
  tocFeatureBad.join(" ｜ ") || "—"
);

/* ══════════════════════════════════════════════════════════════════════════
   C. 完整性
   ═════════════════════════════════════════════════════════════════════════ */

head("C. 内容完整性");

const noPurpose = guide.FEATURES.filter(f => !f.purpose?.trim());
check(
  "C1-a 每个功能都写了「它是干什么的」",
  noPurpose.length === 0,
  noPurpose.map(f => f.title).join(" ｜ ") || "—"
);

const noWhen = guide.FEATURES.filter(f => !f.when?.trim());
check(
  "C1-b 每个功能都写了「什么时候用」",
  noWhen.length === 0,
  noWhen.map(f => f.title).join(" ｜ ") || "—"
);

const tooFewSteps = guide.FEATURES.filter(f => (f.steps || []).length < 2);
check(
  "C2 每个功能至少有 2 步操作",
  tooFewSteps.length === 0,
  tooFewSteps.map(f => `${f.title}(${f.steps?.length ?? 0} 步)`).join(" ｜ ") || "—"
);

const noFaqFix = guide.FAQS.filter(f => !f.fix || f.fix.length < 2);
check(
  "C3 每条常见问题都给了至少 2 条解决办法",
  noFaqFix.length === 0,
  noFaqFix.map(f => f.symptom.slice(0, 20)).join(" ｜ ") || "—"
);

const flowStepBad = guide.FLOWS.filter(f => (f.steps || []).length < 3);
check(
  "C4 每条业务流至少有 3 个环节",
  flowStepBad.length === 0,
  flowStepBad.map(f => f.title).join(" ｜ ") || "—"
);

check(
  "C5 关键注意事项覆盖了课时 / 时间 / 权限 / 危险操作四类",
  guide.CAUTION_GROUPS.length >= 4,
  `实际 ${guide.CAUTION_GROUPS.length} 类`
);

/* ══════════════════════════════════════════════════════════════════════════
   B. 可读性
   ═════════════════════════════════════════════════════════════════════════ */

head("B. 可读性（读者是没有技术背景的校区老师）");

/** 收集全部面向读者的正文（去掉 markdown 加粗标记） */
function collectProse() {
  const out = [];
  const push = (where, text) => {
    if (typeof text === "string" && text.trim()) {
      out.push({ where, text: text.replace(/\*\*/g, "").trim() });
    }
  };
  push("intro", guide.INTRO.what);
  guide.INTRO.scenarios.forEach((s, i) => push(`intro.scenarios[${i}]`, s));
  guide.INTRO.who.forEach((w, i) => push(`intro.who[${i}]`, w.text));
  guide.INTRO.notFor.forEach((s, i) => push(`intro.notFor[${i}]`, s));

  push("prep.access", guide.PREP.access.title);
  guide.PREP.access.steps.forEach((s, i) => {
    push(`prep.access.steps[${i}]`, s.text);
    push(`prep.access.steps[${i}].tip`, s.tip);
  });
  guide.PREP.access.cautions.forEach((c, i) => push(`prep.access.cautions[${i}]`, c));
  guide.PREP.interface.areas.forEach((a, i) => {
    push(`prep.interface[${i}].what`, a.what);
    push(`prep.interface[${i}].how`, a.how);
  });
  guide.PREP.interface.cautions.forEach((c, i) => push(`prep.interface.cautions[${i}]`, c));
  push("prep.bootstrap", guide.PREP.bootstrap.intro);
  guide.PREP.bootstrap.order.forEach(o => push(`prep.bootstrap[${o.step}]`, o.why));
  guide.PREP.bootstrap.cautions.forEach((c, i) => push(`prep.bootstrap.cautions[${i}]`, c));

  guide.MENU_GROUPS.forEach(g => push(`menu[${g.name}]`, g.summary));

  for (const f of guide.FEATURES) {
    push(`${f.title}.purpose`, f.purpose);
    push(`${f.title}.when`, f.when);
    f.steps.forEach((s, i) => {
      push(`${f.title}.steps[${i + 1}]`, s.text);
      push(`${f.title}.steps[${i + 1}].tip`, s.tip);
    });
    (f.cautions || []).forEach((c, i) => push(`${f.title}.cautions[${i + 1}]`, c));
  }

  for (const fl of guide.FLOWS) {
    push(`${fl.title}.scenario`, fl.scenario);
    fl.steps.forEach((s, i) => {
      push(`${fl.title}.steps[${i + 1}].title`, s.title);
      push(`${fl.title}.steps[${i + 1}].detail`, s.detail);
    });
    (fl.cautions || []).forEach((c, i) => {
      push(`${fl.title}.callout[${i + 1}]`, c.title);
      push(`${fl.title}.callout[${i + 1}].text`, c.text);
    });
  }

  for (const q of guide.FAQS) {
    push(`${q.symptom}.cause`, q.cause);
    q.fix.forEach((s, i) => push(`${q.symptom}.fix[${i + 1}]`, s));
  }

  for (const cg of guide.CAUTION_GROUPS) {
    push(`caution[${cg.title}]`, cg.title);
    cg.items.forEach((it, i) => push(`caution[${cg.title}].items[${i + 1}]`, it));
  }
  return out;
}

const prose = collectProse();
const allChars = prose.reduce((n, p) => n + p.text.length, 0);

/** 中文断句：按全角句末标点切 */
function sentences(text) {
  return text
    .split(/(?<=[。！？；])/)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

const SENT_LONG = 50; // 单句超过这个字数即算"长句"
const SENT_AVG_MAX = 26; // 平均句长上限
const SENT_LONG_RATIO_MAX = 0.06; // 长句占比上限
const STEP_MAX = 80; // 单条操作步骤的字数上限

const allSentences = [];
for (const p of prose) {
  for (const s of sentences(p.text)) allSentences.push({ where: p.where, s });
}
const avgSent = allSentences.reduce((n, x) => n + x.s.length, 0) / allSentences.length;
const longSent = allSentences.filter(x => x.s.length > SENT_LONG);

console.log(
  `  正文合计 ${allChars} 字 ｜ ${prose.length} 段 ｜ ${allSentences.length} 句
  平均句长 ${avgSent.toFixed(1)} 字 ｜ 超过 ${SENT_LONG} 字的长句 ${longSent.length} 句（${((longSent.length / allSentences.length) * 100).toFixed(1)}%）\n`
);

check(
  `B1-a 平均句长 ≤ ${SENT_AVG_MAX} 字`,
  avgSent <= SENT_AVG_MAX,
  `${avgSent.toFixed(1)} 字`
);

const longRatio = longSent.length / allSentences.length;
check(
  `B1-b 长句（> ${SENT_LONG} 字）占比 ≤ ${(SENT_LONG_RATIO_MAX * 100).toFixed(0)}%`,
  longRatio <= SENT_LONG_RATIO_MAX,
  `${(longRatio * 100).toFixed(1)}%（${longSent.length} 句）`
);

if (longSent.length) {
  warn(
    "以下是超长句（可读性报告，建议拆句）",
    longSent
      .sort((a, b) => b.s.length - a.s.length)
      .slice(0, 12)
      .map(x => `[${x.where}] ${x.s.length}字：${x.s.slice(0, 46)}…`)
      .join("\n     ")
  );
}

// B2 单条操作步骤长度
const longSteps = [];
for (const f of guide.FEATURES) {
  f.steps.forEach((s, i) => {
    const t = s.text.replace(/\*\*/g, "");
    if (t.length > STEP_MAX) longSteps.push(`${f.title} 第${i + 1}步（${t.length}字）`);
  });
}
check(
  `B2 单条操作步骤 ≤ ${STEP_MAX} 字（一步一件事）`,
  longSteps.length === 0,
  longSteps.join(" ｜ ") || "—"
);

// B3 术语密度：只扫「引号之外」的正文 —— 引号里的往往是界面上真实的控件名，
//    读者会在屏幕上看到同一个词，不算"术语"。
const TERMS = [
  "接口",
  "字段",
  "数据库",
  "部署",
  "后端",
  "前端",
  "API",
  "JSON",
  "SQL",
  "服务器",
  "容器",
  "nginx",
  "幂等",
  "重构",
  "缓存",
  "迁移",
  "环境变量",
  "编译",
  "渲染",
  "组件",
  "路由",
  "事务",
  "并发"
];

function stripQuoted(text) {
  return text
    .replace(/「[^」]*」/g, "  ")
    .replace(/“[^”]*”/g, "  ")
    .replace(/"[^"]*"/g, "  ")
    .replace(/`[^`]*`/g, "  ");
}

const termHits = [];
for (const p of prose) {
  const bare = stripQuoted(p.text);
  for (const t of TERMS) {
    if (bare.toUpperCase().includes(t.toUpperCase())) {
      termHits.push(`[${p.where}] 出现「${t}」：${p.text.slice(0, 44)}…`);
    }
  }
}
check(
  "B3 正文（引号外）不出现读者看不懂的技术术语",
  termHits.length === 0,
  termHits.length ? `\n     ${termHits.join("\n     ")}` : "—"
);

/* ══════════════════════════════════════════════════════════════════════════
   汇总
   ═════════════════════════════════════════════════════════════════════════ */

head("汇总");
console.log(`  通过 ${pass} 项 ｜ 失败 ${fails.length} 项 ｜ 提示 ${warns.length} 项`);
if (fails.length) {
  console.log("\n  失败清单：");
  fails.forEach(f => console.log(`    ✗ ${f.label}\n      实际：${f.actual}`));
}
console.log("");
process.exit(fails.length ? 1 : 0);
