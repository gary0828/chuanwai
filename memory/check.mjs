#!/usr/bin/env node
/**
 * 记忆系统体检（零依赖）  node memory/check.mjs
 *
 * 设计原则（用户 2026-09-23 拍板 K-030）：**有用优先，体积可超**。
 *   → 体积 / 行数超限一律 **WARN（软上限）**，不再算失败；
 *   → 真正报 **ERROR** 的是**结构性**问题（会让人读到错的东西、或丢东西）。
 *
 * ERROR（会 exit 1）
 *   1. 必备记忆文件缺失，或在 **git 中消失**（被误删 / 未提交）
 *   2. 目录里列的主题文件不存在（指针指向空气）
 *   3. 主题文件引用的 *.md 路径不存在（死链）
 *   4. 主题文件里出现未登记的 K-id（孤儿知识）
 *   5. 登记在目录里的 K-id 在它所属文件里找不到（索引撒谎）
 *   6. 敏感数据混进记忆（密钥 / 私钥）
 *   7. 部署配置引用了 memory/（记忆不该进部署产物）
 *
 * WARN
 *   · 文件超软上限 · 日志超 6KB / 超 30 天未归档 · 孤立主题文件（未被目录收录）
 *   · 知识文件超 90 天未更新 · INDEX.md 出现代码块
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEM = join(ROOT, "memory");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const KB = (n) => (n / 1024).toFixed(1) + "KB";
const read = (p) => readFileSync(p, "utf8");

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const KNOW = join(MEM, "knowledge", "_index.md");

// ── 1. 必备文件 ───────────────────────────────────────────────
const REQUIRED = [
  "memory/INDEX.md",
  "memory/CURSOR.md",
  "memory/PROTOCOL.md",
  "memory/HANDOFF.md",
  "memory/knowledge/_index.md",
  "memory/knowledge/deploy.md",
  "memory/knowledge/frontend.md",
  "memory/knowledge/backend-data.md",
  "memory/knowledge/process.md",
  "memory/knowledge/git-local.md",
  "memory/knowledge/preferences.md",
  "memory/tasks/active.md",
  "memory/tasks/backlog.md",
];
for (const f of REQUIRED) if (!existsSync(join(ROOT, f))) err(`缺少必备文件：${f}`);

// ── 2. 在 git 中消失（今天真实发生过：git rm 事故删掉 _index.md）──
//   注意：新建但尚未 `git add` 的文件不该报错 → 只有「曾在 HEAD 里、现在不在索引里」才是事故特征。
try {
  const inIndex = new Set(
    execFileSync("git", ["ls-files", "memory"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean),
  );
  let inHead = new Set();
  try {
    inHead = new Set(
      execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "memory"], {
        cwd: ROOT, encoding: "utf8",
      }).split("\n").map((s) => s.trim()).filter(Boolean),
    );
  } catch { /* 还没有 HEAD 提交 */ }
  for (const f of REQUIRED) {
    if (existsSync(join(ROOT, f)) && inHead.has(f) && !inIndex.has(f)) {
      err(`${f} 曾在 git 中、现在已不在索引里 —— 疑似被误删（见 git-local.md K-028）`);
    }
  }
  const st = execFileSync("git", ["status", "--porcelain", "--", "memory"], {
    cwd: ROOT, encoding: "utf8",
  });
  for (const line of st.split("\n")) {
    if (/^(D|AD|MD)\s/.test(line.trim()) && /memory\/.*\.md/.test(line)) {
      err(`git 工作区里记忆文件被删除未提交：${line.trim()}`);
    }
  }
} catch (e) {
  // ★ 2026-09-23：把失败原因说出来。此前只打印「非仓库？」，而真实原因常见是运行环境限制
  //   （实测某些沙箱里 spawn 子进程一律 EBUSY，连 cmd.exe 都起不来）——
  //   那种情况下**本项检查被静默跳过**，而它正是 K-028（`git rm` 误删记忆）的兜底，必须让人看见。
  warn(
    `拿不到 git 状态（${e?.code || e?.message || "未知原因"}）→ 跳过「记忆文件是否在 git 中」检查` +
      (e?.code === "EBUSY"
        ? "；EBUSY = 当前环境禁止派生子进程，请在普通终端重跑本脚本以完成该检查"
        : "")
  );
}

// ── 3. 体积（软上限：只提醒）────────────────────────────────────
const LIMITS = [
  ["memory/INDEX.md", 90, 5],
  ["memory/CURSOR.md", 45, 2.5],
  ["memory/PROTOCOL.md", 240, 14],
  ["memory/knowledge/_index.md", 120, 6],
  ["memory/knowledge/preferences.md", 120, 5],
  ["memory/HANDOFF.md", 90, 5],
  ["memory/tasks/active.md", 45, 3],
  ["memory/tasks/backlog.md", 80, 6],
];
for (const [file, maxLines, maxKB] of LIMITS) {
  const p = join(ROOT, file);
  if (!existsSync(p)) continue;
  const lines = read(p).split("\n").length;
  const size = statSync(p).size / 1024;
  if (lines > maxLines) warn(`（软）${file} 行数偏多：${lines} > ${maxLines}`);
  if (size > maxKB) warn(`（软）${file} 体积偏大：${KB(statSync(p).size)} > ${maxKB}KB`);
}
// 主题文件单独看
const topicFiles = existsSync(join(MEM, "knowledge"))
  ? readdirSync(join(MEM, "knowledge"))
      .filter((f) => f.endsWith(".md") && f !== "_index.md")
      .map((f) => "memory/knowledge/" + f)
  : [];
for (const f of topicFiles) {
  const size = statSync(join(ROOT, f)).size / 1024;
  if (size > 10) warn(`（软）主题文件偏大：${f} ${KB(statSync(join(ROOT, f)).size)} > 10KB（考虑拆）`);
}

// ── 4. 目录 ↔ 主题文件 一致性 ──────────────────────────────────
let listedFiles = [];
const listedIds = new Map(); // id → 文件
if (existsSync(KNOW)) {
  const txt = read(KNOW);
  for (const line of txt.split("\n")) {
    const m = line.match(/^\|\s*`(memory\/knowledge\/[^`]+\.md)`\s*\|(.*)\|\s*([^|]*)\|\s*([^|]*)\|/);
    if (!m) continue;
    const file = m[1];
    listedFiles.push(file);
    for (const id of (m[3].match(/K-\d{3}/g) || [])) listedIds.set(id, file);
  }
}
if (!listedFiles.length) err("knowledge/_index.md 里没解析到任何主题文件行（目录格式被破坏？）");
for (const f of listedFiles) {
  if (!existsSync(join(ROOT, f))) err(`目录里列了不存在的主题文件：${f}`);
}
for (const f of topicFiles) {
  if (!listedFiles.includes(f)) warn(`孤立主题文件（未被 _index.md 收录）：${f}`);
}
for (const [id, file] of listedIds) {
  const p = join(ROOT, file);
  if (existsSync(p) && !read(p).includes(id)) err(`索引撒谎：${id} 登记在 ${file}，但该文件里找不到它`);
}

// ── 5. K-id 登记情况 + 死链 ────────────────────────────────────
const SCAN = ["memory/INDEX.md", ...listedFiles].filter((f) => existsSync(join(ROOT, f)));
const idOwner = new Map([...listedIds.entries()].map(([id, f]) => [id, f]));
const seenIn = new Map();
for (const f of SCAN) {
  for (const id of (read(join(ROOT, f)).match(/K-\d{3}/g) || [])) {
    if (!seenIn.has(id)) seenIn.set(id, new Set());
    seenIn.get(id).add(f);
  }
}
for (const [id, files] of seenIn) {
  if (!idOwner.has(id)) err(`孤儿知识：${id} 出现在 ${[...files].join(", ")}，但未登记进 _index.md`);
}
for (const [id, files] of seenIn) {
  const owner = idOwner.get(id);
  const others = [...files].filter((f) => f !== owner);
  if (owner && others.length) warn(`${id} 除所属文件外还被引用（正常交叉引用可忽略）：${others.join(", ")}`);
}

// 死链：主题文件 / INDEX 里 `xxx.md` 形式的仓库相对路径
//   · 含 < > * { } 等模板/通配符的跳过（那是示例，不是路径）
//   · 只扫 INDEX + 主题文件；PROTOCOL.md 是协议模板（含 `logs/今天.md` 之类占位），不扫
const checked = new Set();
const resolve = (p) =>
  [
    join(ROOT, p),
    join(MEM, p),
    join(MEM, "knowledge", p),
    join(ROOT, "memory", p),
  ].find((c) => existsSync(c)) || null;
for (const f of SCAN) {
  if (!existsSync(join(ROOT, f))) continue;
  for (const m of read(join(ROOT, f)).matchAll(/`([^`\n]+)`/g)) {
    const p = m[1].trim();
    if (!p.endsWith(".md")) continue;
    if (/[<>*{}[\]$#:?|"']/.test(p)) continue; // 模板 / 通配 / 示例
    if (p.startsWith("http") || checked.has(p)) continue;
    checked.add(p);
    if (!resolve(p)) err(`死链：${f} 引用的 ${p} 不存在`);
  }
}

// ── 6. 敏感数据 ───────────────────────────────────────────────
const SECRETS = [
  [/sk-[A-Za-z0-9]{16,}/, "OpenAI 风格密钥"],
  [/AIza[0-9A-Za-z_-]{20,}/, "Google API Key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "私钥"],
  [/\bJWT_SECRET\s*=\s*[A-Za-z0-9+/=]{24,}/, "JWT_SECRET 明文"],
];
for (const f of [...SCAN, "memory/CURSOR.md", "memory/PROTOCOL.md", "memory/HANDOFF.md"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const t = read(p);
  for (const [re, what] of SECRETS) if (re.test(t)) err(`${f} 里疑似写入了${what} —— 记忆不放密钥，只写「在哪」`);
}

// ── 7. 日志 ───────────────────────────────────────────────────
const logsDir = join(MEM, "logs");
if (existsSync(logsDir)) {
  const now = Date.now();
  for (const f of readdirSync(logsDir).filter((x) => x.endsWith(".md"))) {
    const p = join(logsDir, f);
    const age = (now - statSync(p).mtimeMs) / 86400000;
    const size = statSync(p).size / 1024;
    if (age > 30) warn(`日志 ${f} 已 ${Math.floor(age)} 天未归档 → memory/archive/`);
    if (size > 6)
      warn(`日志 ${f} 超 6KB（${KB(statSync(p).size)}）→ 建议 Promote 高信号条目到主题文件（软上限，不阻塞）`);
  }
}

// ── 8. 僵尸知识文件（90 天没动过）─────────────────────────────
for (const f of topicFiles) {
  const p = join(ROOT, f);
  const days = (Date.now() - statSync(p).mtimeMs) / 86400000;
  if (days > 90) warn(`知识文件 ${f} 已 ${Math.floor(days)} 天未更新 → 复核是否过时（陈旧比没有更危险）`);
}

// ── 9. 部署排除护栏 ───────────────────────────────────────────
const DEPLOY_FILES = [
  "server/Dockerfile",
  "deploy/Dockerfile.unified",
  "docker-compose.yml",
  "docker-compose.verify.yml",
  "deploy/nginx-unified.conf",
  ".dockerignore",
];
const dockerIgnore = existsSync(join(ROOT, ".dockerignore")) ? read(join(ROOT, ".dockerignore")) : "";
if (!/^memory\s*$/m.test(dockerIgnore)) err(".dockerignore 未排除 memory/ —— 记忆系统可能进入构建上下文");
for (const f of DEPLOY_FILES) {
  const p = join(ROOT, f);
  if (!existsSync(p) || f === ".dockerignore") continue;
  if (/COPY[^\n]*\bmemory\b|memory\/|:\/.*memory/i.test(read(p)))
    err(`${f} 引用了 memory/ —— 记忆系统不应出现在部署配置中`);
}

// ── 10. INDEX 只许三种内容（粗查）──────────────────────────────
const indexP = join(MEM, "INDEX.md");
if (existsSync(indexP) && read(indexP).includes("```")) {
  // INDEX §3 的示例命令是允许的：只在出现大段代码（>8 行）时提示
  const blocks = read(indexP).split("```").filter((_, i) => i % 2 === 1);
  for (const b of blocks) if (b.split("\n").length > 8) warn("INDEX.md 出现大段代码块 → 正文应移出索引层");
}

// ── 输出 ──────────────────────────────────────────────────────
console.log(`· 主题文件 ${topicFiles.length} 个；登记 K-id ${listedIds.size} 条；死链检查 ${checked.size} 条路径`);
console.log("");
for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log("");
if (errors.length) {
  console.log(`体检未通过：${errors.length} 个结构性问题 / ${warns.length} 个提醒`);
  process.exit(1);
}
console.log(`体检通过${warns.length ? `（${warns.length} 个提醒，均不阻塞）` : "，全部达标"}`);
