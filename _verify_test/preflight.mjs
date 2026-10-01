// 提交前自动检查（preflight）—— ★ 2026-10-01 新增
//
// 存在的理由（一次真实教训）：
//   2026-10-01 的"文档全面扫描"用了 **shell `grep -r`**，而本环境的 shell grep 会**静默漏返回**，
//   结果漏掉 7 处待改内容，还把 ADR 里的出处写错了。事后用 ripgrep 复扫才发现。
//   （项目 `testing-and-verification` skill 第 ⑤ 条铁律早就写了这条，但"写在文档里的规则会被遗忘"。）
//
// 所以本脚本的原则：
//   ① **不调用任何外部 grep** —— 用 node 自己遍历 + 正则，从根本上不受"某个工具静默失败"影响
//   ② 把几条**易被遗忘的铁律**变成可执行断言（跑一次就知道，不靠记性）
//
// 用法：node _verify_test/preflight.mjs
//   退出码 0 = 通过；1 = 有必须处理的问题
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errs = [];
const warns = [];

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "evidence", ".workbuddy", "dify",
  "build", "public", "_tmp", "archive"
]);
const TEXT_EXT = new Set([".md", ".js", ".mjs", ".ts", ".vue", ".yaml", ".yml", ".json", ".scss"]);
// 生成的/第三方的跳过
// preflight 自身含规则文本（"节次固定 1–8"等），必须排除，否则自己报自己
const SKIP_FILES = /(package-lock|pnpm-lock|openapi\.yaml|preflight\.mjs)$/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, out);
    } else if (TEXT_EXT.has(path.extname(name)) && !SKIP_FILES.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// ── ① 过时表述扫描（可扩展的清单）───────────────────────────────
// 每条：{ 说明, 正则, 允许出现的文件（这些文件里出现是"在解释这件事"）}
const STALE = [
  {
    desc: "「节次固定 1–8」的过时表述（★ v24 已改为可配置，见 ADR-013）",
    re: /(固定\s*1[–-]8|1[–-]8\s*节|仅\s*1[–-]8|保持\s*1[–-]8)/,
    allow: [/ADR-013/, /migrations\/02[45]-/, /utils\/period\.js/, /period-times(\.js|\/)/,
            /021-课次实体/, /database\.md$/, /memory\//, /logs\//, /API\.md$/]
  },
  {
    desc: "「全页面巡检 28 项」的过时数字（脚本已改为动态取路由）",
    re: /28\s*\/\s*28|28\s*项|28\s*个路由/,
    allow: [/PROGRESS\.md$/, /memory\//, /archive\//, /logs\//, /ROADMAP\.md$/]
  }
];

for (const f of files) {
  let s;
  try { s = fs.readFileSync(f, "utf8"); } catch { continue; }
  const lines = s.split(/\r?\n/);
  for (const item of STALE) {
    if (item.allow.some((re) => re.test(rel(f)))) continue;
    lines.forEach((ln, i) => {
      if (!item.re.test(ln)) return;
      // ★ 排除「在解释这件事」的上下文 —— 例如代码注释里写"不再固定 1–8"是在说明改动，
      //   本身是正确内容；不排除就会把自己的说明当成过时表述（初版就误报了 4 处）
      if (/不再固定|已改为|已修订|改为可配置|已部分修订|ADR-013|v2[345]/.test(ln)) return;
      errs.push(`${item.desc}\n     ${rel(f)}:${i + 1}  ${ln.trim().slice(0, 90)}`);
    });
  }
}

// ── ② SQL 模板注入（铁律：参数必须绑定，不能拼接）──────────────
for (const f of files.filter((p) => /^server\/src\/.*\.js$/.test(rel(p)))) {
  const s = fs.readFileSync(f, "utf8");
  const lines = s.split(/\r?\n/);
  lines.forEach((ln, i) => {
    // 反引号 SQL 里出现 ${...}（排除我们已知的"拼接表名/占位符"白名单写法）
    if (/prepare\(\s*`/.test(ln) && /\$\{/.test(ln) && !/\$\{statuses|\$\{ph\}|\$\{excludeClause|\$\{where|\$\{scope|\$\{SESSION|\$\{L\(|IN \(\$\{/.test(ln)) {
      warns.push(`SQL 模板里有 \${} 插值，确认是"拼接标识符/占位符"而非用户输入：${rel(f)}:${i + 1}`);
    }
  });
}

// ── ③ 迁移版本连续性（启动时执行器会拦，这里提前发现）──────────
const migDir = path.join(ROOT, "server/src/migrations");
if (fs.existsSync(migDir)) {
  const nums = fs.readdirSync(migDir)
    .filter((x) => /^\d{3}-.*\.js$/.test(x)).map((x) => Number(x.slice(0, 3))).sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) {
      errs.push(`迁移版本不连续：v${nums[i - 1]} 之后是 v${nums[i]}（缺 v${nums[i - 1] + 1}）—— 会导致启动即失败`);
    }
  }
  const idx = fs.readFileSync(path.join(migDir, "index.js"), "utf8");
  for (const n of nums) {
    const file = fs.readdirSync(migDir).find((x) => x.startsWith(String(n).padStart(3, "0")));
    if (file && !idx.includes(file.replace(/\.js$/, ""))) {
      errs.push(`迁移 ${file} 未注册到 migrations/index.js（写了但不会执行）`);
    }
  }
}

// ── ④ 行尾一致性（本仓两种混存，改文件时最容易踩）──────────────
const crlfFiles = [];
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  if (s.includes("\r\n")) crlfFiles.push(rel(f));
}
if (crlfFiles.length > 0) {
  warns.push(
    `本仓有 ${crlfFiles.length} 个文件用 CRLF（其余为 LF）—— 用脚本改文件前先确认行尾，` +
      `否则会产生"整文件重写"的假 diff。例：${crlfFiles.slice(0, 3).join(", ")}`
  );
}

// ── ⑤ 调试残留（后端 console.log 过多）────────────────────────
for (const f of files.filter((p) => /^server\/src\/(routes|utils)\/.*\.js$/.test(rel(p)))) {
  const s = fs.readFileSync(f, "utf8");
  const n = (s.match(/console\.log\(/g) || []).length;
  if (n > 3) warns.push(`${rel(f)} 有 ${n} 处 console.log（疑似调试残留，确认是否需要）`);
}

// ── 输出 ──────────────────────────────────────────────────────
console.log(`· 扫描 ${files.length} 个文件（node 自己读，不依赖外部 grep）`);
console.log("");
for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errs) console.log(`ERROR ${e}`);
console.log("");
if (errs.length) {
  console.log(`preflight 未通过：${errs.length} 个必须处理 / ${warns.length} 个提醒`);
  process.exit(1);
}
console.log(`preflight 通过${warns.length ? `（${warns.length} 个提醒）` : "，全部达标"}`);
