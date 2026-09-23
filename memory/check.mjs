#!/usr/bin/env node
/**
 * 记忆系统体检脚本（零依赖）
 *   node memory/check.mjs
 *
 * 检查项：
 *   1. 必备文件是否齐全
 *   2. 各文件是否超出体积 / 行数上限（见 PROTOCOL.md §7）
 *   3. knowledge/_index.md 条目是否合规（字段数、id 重复、主题重复、详情文件是否存在）
 *   4. logs/ 里是否有超过 30 天未归档的日志
 * 退出码：0 = 全绿；1 = 有 ERROR
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEM = join(ROOT, "memory");
const R = (p) => relative(ROOT, p).replace(/\\/g, "/");
const KB = (n) => (n / 1024).toFixed(1) + "KB";

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ── 1. 必备文件 ───────────────────────────────────────────────
const REQUIRED = [
  "memory/INDEX.md",
  "memory/CURSOR.md",
  "memory/PROTOCOL.md",
  "memory/knowledge/_index.md",
  "memory/tasks/active.md",
  "memory/tasks/backlog.md",
];
for (const f of REQUIRED) {
  if (!existsSync(join(ROOT, f))) err(`缺少必备文件：${f}`);
}

// ── 2. 体积上限 ───────────────────────────────────────────────
const LIMITS = [
  ["memory/INDEX.md", 80, 4],
  ["memory/CURSOR.md", 40, 2],
  ["memory/PROTOCOL.md", 220, 12],
  ["memory/knowledge/_index.md", 120, 6],
  ["memory/knowledge/preferences.md", 120, 4],
  ["memory/tasks/active.md", 45, 3],
  ["memory/tasks/backlog.md", 80, 6],
];
for (const [file, maxLines, maxKB] of LIMITS) {
  const p = join(ROOT, file);
  if (!existsSync(p)) continue;
  const txt = readFileSync(p, "utf8");
  const lines = txt.split("\n").length;
  const size = statSync(p).size / 1024;
  if (lines > maxLines) err(`${file} 超行数：${lines} > ${maxLines}`);
  if (size > maxKB) err(`${file} 超体积：${KB(statSync(p).size)} > ${maxKB}KB`);
}

// ── 3. 知识索引条目 ────────────────────────────────────────────
const idxPath = join(MEM, "knowledge", "_index.md");
if (existsSync(idxPath)) {
  const txt = readFileSync(idxPath, "utf8");
  const block = txt.split("```")[1] ?? "";
  const rows = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const seenId = new Map();
  const seenTopic = new Map();
  let count = 0;

  for (const row of rows) {
    const f = row.split("|").map((s) => s.trim());
    if (f.length < 8) {
      err(`_index 条目字段不足 8 个（${f.length}）：${row.slice(0, 40)}…`);
      continue;
    }
    const [id, type, topic, , detail] = f;
    count++;
    if (seenId.has(id)) err(`_index 重复 id：${id}`);
    seenId.set(id, 1);
    const key = `${type}|${topic}`;
    if (seenTopic.has(key)) warn(`_index 同主题多条（应合并）：${key}`);
    seenTopic.set(key, 1);

    const detailPath = (detail || "").split("#")[0].trim();
    if (detailPath && !detailPath.startsWith("http") && !existsSync(join(ROOT, detailPath))) {
      err(`_index 条目指向的文件不存在：${detailPath}（id=${id}）`);
    }
  }
  console.log(`· 知识索引条目：${count} 条`);
}

// ── 4. 日志归档 ────────────────────────────────────────────────
const logsDir = join(MEM, "logs");
if (existsSync(logsDir)) {
  const now = Date.now();
  for (const f of readdirSync(logsDir).filter((x) => x.endsWith(".md"))) {
    const p = join(logsDir, f);
    const age = (now - statSync(p).mtimeMs) / 86400000;
    const size = statSync(p).size / 1024;
    if (age > 30) warn(`日志 ${f} 已 ${Math.floor(age)} 天未归档 → memory/archive/`);
    if (size > 6) warn(`日志 ${f} 超 6KB（${KB(statSync(p).size)}）→ Promote 高信号条目`);
  }
}

// ── 5. 部署排除护栏 ───────────────────────────────────────────
// 记忆系统是开发期工具，不允许出现在任何部署产物 / 配置文件中。
const DEPLOY_FILES = [
  "server/Dockerfile",
  "deploy/Dockerfile.unified",
  "docker-compose.yml",
  "docker-compose.verify.yml",
  "deploy/nginx-unified.conf",
  ".dockerignore",
];
const dockerIgnore = existsSync(join(ROOT, ".dockerignore"))
  ? readFileSync(join(ROOT, ".dockerignore"), "utf8")
  : "";
if (!/^memory\s*$/m.test(dockerIgnore)) {
  err(".dockerignore 未排除 memory/ —— 记忆系统可能进入构建上下文");
}
for (const f of DEPLOY_FILES) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const t = readFileSync(p, "utf8");
  // 只报「把 memory 作为产物/路径引用」，.dockerignore 的排除行已单独校验
  if (f !== ".dockerignore" && /COPY[^\n]*\bmemory\b|memory\/|:\/.*memory/i.test(t)) {
    err(`${f} 引用了 memory/ —— 记忆系统不应出现在部署配置中`);
  }
}

// ── 6. INDEX 只许三种内容（粗查：禁止出现代码块） ────────────────
const indexP = join(MEM, "INDEX.md");
if (existsSync(indexP)) {
  const t = readFileSync(indexP, "utf8");
  if (t.includes("```")) warn("INDEX.md 出现代码块 → 正文应移出索引层");
}

// ── 输出 ──────────────────────────────────────────────────────
console.log("");
for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log("");
if (errors.length) {
  console.log(`体检未通过：${errors.length} 个错误 / ${warns.length} 个提醒`);
  process.exit(1);
}
console.log(`体检通过${warns.length ? `（${warns.length} 个提醒）` : "，全部达标"}`);
