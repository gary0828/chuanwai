#!/usr/bin/env node
/**
 * 记忆路由（零依赖）—— 按「本次改动的文件」算出「该读哪几份记忆 / 文档」。
 *
 * 用法：
 *   node memory/route.mjs --list                      打印完整路由表
 *   node memory/route.mjs src/views/Home.vue          按给定文件算
 *   node memory/route.mjs --changed                   自动取 git 改动文件
 *   node memory/route.mjs --changed --quiet           只输出该读的文件路径（便于脚本拼装）
 *
 * 设计：这是**唯一**的机器可读路由源（INDEX.md 只给用法，不重复维护表）。
 * 改路由 → 改本文件。新增知识主题文件时，记得把它加进对应 route 的 read[]。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => relative(ROOT, p).replace(/\\/g, "/");

/** 每个会话都必须读的（很小，几 KB） */
const ALWAYS = [
  "memory/CURSOR.md",
  "memory/knowledge/process.md",
  "memory/knowledge/git-local.md",
  "memory/knowledge/preferences.md",
];

/** 按改动文件触发的路由 */
const ROUTES = [
  {
    label: "前端（教务端 / 工作台）",
    patterns: ["src/**", "ai-workbench/**", ".env.*", "vite.config.ts", "build/**", "public/**"],
    read: [
      "memory/knowledge/frontend.md",
      "docs/03-开发指南/前端两端差异.md",
      "docs/03-开发指南/前端视觉规范.md",
    ],
  },
  {
    label: "后端与数据",
    patterns: ["server/**", "docs/04-API/**"],
    read: [
      "memory/knowledge/backend-data.md",
      "docs/03-开发指南/后端与数据.md",
      "server/database.md",
      "docs/04-API/API.md",
    ],
  },
  {
    label: "部署与运维",
    patterns: [
      "docker-compose*.yml",
      "deploy/**",
      "Dockerfile*",
      "server/scripts/*.sh",
      ".dockerignore",
      ".env",
    ],
    read: [
      "memory/knowledge/deploy.md",
      "docs/06-部署/运维约定.md",
      "docs/06-部署/校区部署与升级.md",
    ],
  },
  {
    label: "本地↔服务器同步 / 数据",
    patterns: ["server/data/**", "deploy.sh", "server/scripts/restore-db.sh", "server/scripts/backup-db.sh"],
    read: ["docs/06-部署/本地与服务器同步.md"],
  },
  {
    label: "文档",
    patterns: ["docs/**", "*.md", "CHANGELOG.md"],
    read: ["docs/01-文档规范.md", "docs/00-导航.md"],
  },
  {
    label: "记忆系统自身",
    patterns: ["memory/**", "WORKBUDDY.md"],
    read: ["memory/PROTOCOL.md", "memory/knowledge/process.md"],
  },
];

/** 极简 glob → RegExp：支持 ** / * / ? */
function globToRe(g) {
  let s = "^";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++; // 吃掉第二个 *
        if (g[i + 1] === "/") {
          i++; // 吃掉紧跟的斜杠
          s += "(?:.*/)?"; // **/ → 零个或多个目录
        } else {
          s += ".*"; // 结尾的 ** → 任意剩余路径（含文件名）
        }
      } else {
        s += "[^/]*";
      }
    } else if (c === "?") s += "[^/]";
    else if ("\\^$.|+()[]{}".includes(c)) s += "\\" + c;
    else s += c;
  }
  return new RegExp(s + "$");
}

const compiled = ROUTES.map((r) => ({ ...r, res: r.patterns.map(globToRe) }));

function match(file) {
  const f = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return compiled.filter((r) => r.res.some((re) => re.test(f)));
}

function changedFiles() {
  const opts = { cwd: ROOT, encoding: "utf8" };
  const out = new Set();
  for (const args of [
    ["diff", "--name-only", "HEAD"],
    ["diff", "--name-only", "--cached"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    try {
      for (const l of execFileSync("git", args, opts).split("\n")) {
        const t = l.trim();
        if (t) out.add(t);
      }
    } catch {
      /* git 不可用就忽略 */
    }
  }
  return [...out];
}

const argv = process.argv.slice(2);
const quiet = argv.includes("--quiet");
const args = argv.filter((a) => !a.startsWith("--"));

if (argv.includes("--list")) {
  console.log("=== 每会话必读 ===\n  " + ALWAYS.join("\n  "));
  console.log("\n=== 按改动文件触发 ===");
  for (const r of ROUTES) {
    console.log(`\n[${r.label}]`);
    console.log("  触发：" + r.patterns.join(" · "));
    console.log("  读  ：" + r.read.join("\n        "));
  }
  process.exit(0);
}

const files = argv.includes("--changed") ? changedFiles() : args;
if (!files.length) {
  console.error("用法：node memory/route.mjs <改动的文件…> | --changed | --list");
  process.exit(2);
}

const hit = new Map(); // route → 命中的文件
for (const f of files) {
  for (const r of match(f)) {
    if (!hit.has(r)) hit.set(r, []);
    hit.get(r).push(f);
  }
}

const reads = [...ALWAYS];
for (const [r, fs] of hit) reads.push(...r.read);
const uniq = [...new Set(reads)];

if (quiet) {
  console.log(uniq.join("\n"));
  process.exit(0);
}

console.log(`本次改动 ${files.length} 个文件\n`);
console.log("=== 每会话必读 ===");
for (const f of ALWAYS) console.log(`  ${existsSync(join(ROOT, f)) ? " " : "!"} ${f}`);
if (hit.size) {
  console.log("\n=== 命中路由 ===");
  for (const [r, fs] of hit) {
    console.log(`\n[${r.label}]  ← ${fs.slice(0, 4).join(", ")}${fs.length > 4 ? ` 等 ${fs.length} 个` : ""}`);
    for (const f of r.read) console.log(`  ${existsSync(join(ROOT, f)) ? " " : "!"} ${f}`);
  }
} else {
  console.log("\n（未命中任何路由：只读必读项即可，不要顺手多读）");
}

const missing = uniq.filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) {
  console.log("\n⚠ 以下被引用的文件不存在（路由表或项目结构已漂移）：");
  for (const m of missing) console.log("  ! " + m);
}
console.log(`\n合计 ${uniq.length} 份，约 ${(uniq.join("").length / 1024).toFixed(1)} KB 路径清单`);
