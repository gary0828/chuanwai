#!/usr/bin/env node
/**
 * 一键本地工程门禁（run-gates）—— ★ 2026-10-18 新增
 * ===========================================================================
 * 为什么要有这个脚本：
 *   2026-10-18 深度测试报告（工程线）结论是「质量门禁没有一条自动化链路真正生效」——
 *   preflight / memory check / openapi / 指南体检 / 类型检查 五个脚本都写好了，
 *   但**没有人把它们串起来**，所以「跑过」全靠记性；记性一失效，文档里就出现
 *   照抄必挂的死命令（如 `_verify_test/probe-business-chain.mjs`，该文件从未入库）。
 *
 *   本脚本做三件事：
 *     ① 依次跑 5 个门禁，逐项打印**耗时 + 结果**，失败不中断（一次看全）。
 *     ② 汇总退出码：任一硬门禁失败 → 1，全绿 → 0（可直接给 CI / pre-commit 用）。
 *     ③ **文档死命令自检**：扫描现行文档里 `_verify_test/*.mjs|py` 引用，
 *        文件不存在即 FAIL —— 让「文档写了不存在的命令」这一类问题不能悄悄复发。
 *
 * 用法：
 *   node _verify_test/run-gates.mjs                      # 全部（约 1–2 分钟，大头是 vue-tsc）
 *   node _verify_test/run-gates.mjs --quick              # 快速：preflight + 文档自检（约 2 秒，pre-commit 用）
 *   node _verify_test/run-gates.mjs --only=preflight,memory,openapi   # 只跑指定项（CI 硬门禁用）
 *   node _verify_test/run-gates.mjs --list               # 看有哪些项
 *   node _verify_test/run-gates.mjs --verbose            # 打印子进程完整输出（默认只打印尾部）
 *   node _verify_test/run-gates.mjs --strict             # 把「观察项」也当失败（基线修平后用）
 *
 * 退出码：0 = 硬门禁全部通过（观察项失败不阻塞）；1 = 有硬门禁失败 / 超时；2 = 参数错误。
 *
 * 观察项：vue-tsc 目前基线仍有历史类型错误（与 CI 的 continue-on-error 一致），
 *        默认只打 [WARN] 不计入失败；加 --strict 才卡门。
 *
 * 注意：本脚本不修改任何文件、不连数据库、不需要后端在跑 —— 纯静态检查。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const getArg = (name, def = "") => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const VERBOSE = has("verbose");
const QUICK = has("quick");
const STRICT = has("strict");
const ONLY = getArg("only")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// 子进程输出默认只打印尾部，避免 vue-tsc 的几十行错误刷屏
const TAIL_OK = 12;
const TAIL_FAIL = 60;

/** 当前 Node 版本自带的 --experimental-strip-types 是否可用（Node ≥ 22.6） */
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
const NODE_MINOR = Number(process.versions.node.split(".")[1]);
const HAS_STRIP_TYPES = NODE_MAJOR > 22 || (NODE_MAJOR === 22 && NODE_MINOR >= 6);

/* ══════════════════════════════════════════════════════════════════════════
   0. 门禁清单
   ═════════════════════════════════════════════════════════════════════════ */

const GATES = [
  {
    id: "preflight",
    title: "preflight —— 提交前铁律 / 过时表述 / 敏感数据",
    cmd: [process.execPath, "_verify_test/preflight.mjs"],
    timeoutMs: 60_000
  },
  {
    id: "memory",
    title: "memory check —— 记忆系统结构体检（死链 / 孤儿知识 / 敏感数据）",
    cmd: [process.execPath, "memory/check.mjs"],
    timeoutMs: 60_000
  },
  {
    id: "openapi",
    title: "check-openapi —— 契约可解析性 + $ref 完整性 + growth 覆盖",
    cmd: [process.execPath, "_verify_test/check-openapi.mjs"],
    timeoutMs: 60_000
  },
  {
    id: "guide",
    title: "check-guide —— 《使用指南》一致性 / 可读性",
    // 指南正文是 content.ts，普通 node 会 ERR_UNKNOWN_FILE_EXTENSION .ts
    cmd: HAS_STRIP_TYPES
      ? [process.execPath, "--experimental-strip-types", "_verify_test/check-guide.mjs"]
      : null,
    timeoutMs: 120_000,
    prereq: () =>
      HAS_STRIP_TYPES ? null : `需要 Node ≥ 22.6（--experimental-strip-types），当前 ${process.versions.node}`
  },
  {
    id: "docs",
    title: "文档死命令自检 —— 现行文档引用的 _verify_test/*.mjs|py 是否存在",
    // 内置检查，不需要子进程
    fn: checkDocRefs,
    timeoutMs: 30_000
  },
  {
    id: "typecheck",
    title: "vue-tsc —— 前端类型检查（基线仍有历史错误，见 CI 观察项）",
    cmd: [process.execPath, "node_modules/vue-tsc/bin/vue-tsc.js", "--noEmit", "--skipLibCheck"],
    timeoutMs: 600_000,
    // 观察项：基线未清零前只提示不卡门（CI 里同样是 continue-on-error）；--strict 可升级为硬门禁
    observe: true,
    prereq: () =>
      fs.existsSync(path.join(ROOT, "node_modules/vue-tsc/bin/vue-tsc.js"))
        ? null
        : "未安装 vue-tsc（先 pnpm install）"
  }
];

/* ══════════════════════════════════════════════════════════════════════════
   1. 文档死命令自检
   ──────────────────────────────────────────────────────────────────────────
   扫描范围＝「现行文档」，不含历史记录：
     · README.md / CONTRIBUTING.md / .husky/pre-commit（入口与钩子）
     · docs 下全部 .md       （排除 docs/archive、docs/08-参考 —— 历史流水，写的是当时的事）
     · memory 下全部 .md     （排除 memory/archive、memory/logs —— 同上）
   口径：正文（含代码块 / 反引号）里出现 `_verify_test/<name>.mjs|py|js` 即视为命令引用，
        文件必须真的存在。允许 KNOWN_DEAD 里登记「归属别人、本轮无权改」的历史残留（打 WARN）。
   ═════════════════════════════════════════════════════════════════════════ */

// 已知死引用（只登记本仓库里「确实没人负责 / 本轮范围外」的，且必须写清归属）
const KNOWN_DEAD = new Map([
  [
    "gen-png.mjs",
    "docs/03-开发指南/环境坑与工具.md 的历史残留（P2-09 文档漂移；该文件不在 2026-10-18 工程门禁修复范围内，已在 _tmp/reports/fix-engdocs.md 登记）"
  ]
]);

const DOC_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "_tmp", "archive", "08-参考", "logs"]);
const DOC_REF_RE = /_verify_test\/([A-Za-z0-9._-]+\.(?:mjs|py|js))/g;

function walkDocs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!DOC_SKIP_DIRS.has(name)) walkDocs(p, out);
    } else if (name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

function collectDocTargets() {
  const targets = [];
  for (const rel of ["README.md", "CONTRIBUTING.md", ".husky/pre-commit"]) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) targets.push(p);
  }
  targets.push(...walkDocs(path.join(ROOT, "docs")));
  targets.push(...walkDocs(path.join(ROOT, "memory")));
  return targets;
}

function checkDocRefs() {
  const files = collectDocTargets();
  const missing = [];
  const knownDead = [];
  let refCount = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DOC_REF_RE)) {
        const name = m[1];
        refCount++;
        const target = path.join(ROOT, "_verify_test", name);
        if (fs.existsSync(target)) continue;
        const loc = `${rel}:${i + 1}`;
        if (KNOWN_DEAD.has(name)) knownDead.push(`${loc} → _verify_test/${name}（${KNOWN_DEAD.get(name)}）`);
        else missing.push(`${loc} → _verify_test/${name}`);
      }
    });
  }

  const lines = [
    `扫描 ${files.length} 个文档文件，${refCount} 处 _verify_test 引用`,
    `存在的脚本：${refCount - missing.length - knownDead.length} 处 OK`
  ];
  if (knownDead.length) {
    lines.push(`已知死引用（WARN，已登记归属）：${knownDead.length} 处`);
    for (const k of knownDead) lines.push(`  ! ${k}`);
  }
  if (missing.length) {
    lines.push(`FAIL：${missing.length} 处引用了不存在的脚本 —— 文档里写了就跑不起来的命令`);
    for (const m of missing) lines.push(`  x ${m}`);
    lines.push('  修法：改成现存命令（如 `node _verify_test/run-gates.mjs` / `node _verify_test/api-full-suite.mjs <base>`），或把脚本补进仓库。');
    return { ok: false, out: lines.join("\n") };
  }
  lines.push("OK：文档引用的 _verify_test 脚本全部存在");
  return { ok: true, out: lines.join("\n") };
}

/* ══════════════════════════════════════════════════════════════════════════
   2. 子进程执行（带超时、失败不中断）
   ═════════════════════════════════════════════════════════════════════════ */

function runCommand(cmd, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    let out = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: process.env.CI || "" },
      windowsHide: true
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, out, elapsedMs: Date.now() - started, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
      // 兜底：kill 无效时 5 秒后按超时收尾（不阻塞后面的门禁）
      setTimeout(() => finish({ code: 124 }), 5_000).unref?.();
    }, timeoutMs);

    child.stdout.on("data", d => (out += d.toString()));
    child.stderr.on("data", d => (out += d.toString()));
    child.on("error", err => finish({ code: -1, spawnError: err.message }));
    child.on("close", code => finish({ code: timedOut ? 124 : code ?? -1 }));
  });
}

function tail(text, n) {
  const lines = text.replace(/\s+$/, "").split(/\r?\n/);
  if (lines.length <= n) return lines.join("\n");
  return [`…（前 ${lines.length - n} 行已省略，加 --verbose 看全部）`, ...lines.slice(-n)].join("\n");
}

/* ══════════════════════════════════════════════════════════════════════════
   3. 主流程
   ═════════════════════════════════════════════════════════════════════════ */

if (has("help") || has("h")) {
  console.log(
    [
      "用法：node _verify_test/run-gates.mjs [--quick] [--only=id1,id2] [--list] [--verbose] [--strict]",
      "  --quick        只跑 preflight + 文档死命令自检（pre-commit 快速门禁）",
      "  --only=a,b     只跑指定项；CI 硬门禁用 --only=preflight,memory,openapi",
      "  --list         列出全部门禁 id",
      "  --verbose      打印子进程完整输出",
      "  --strict       把观察项（vue-tsc）也当失败；基线修平后使用"
    ].join("\n")
  );
  process.exit(0);
}

if (has("list")) {
  for (const g of GATES) console.log(`${g.id.padEnd(10)} ${g.title}`);
  process.exit(0);
}

let selected = GATES;
if (QUICK) selected = GATES.filter(g => g.id === "preflight" || g.id === "docs");
if (ONLY.length) {
  const known = new Set(GATES.map(g => g.id));
  const bad = ONLY.filter(id => !known.has(id));
  if (bad.length) {
    console.error(`未知门禁 id：${bad.join(", ")}（可用：${[...known].join(", ")}）`);
    process.exit(2);
  }
  selected = GATES.filter(g => ONLY.includes(g.id));
}

const totalStarted = Date.now();
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  工程门禁 run-gates ｜ Node ${process.versions.node} ｜ ${QUICK ? "快速模式" : "全量模式"} ｜ 共 ${selected.length} 项`);
console.log(`  工作目录：${ROOT}`);
console.log("════════════════════════════════════════════════════════════════════");

const results = [];

for (const [i, gate] of selected.entries()) {
  console.log("");
  console.log(`────────────────────────────────────────────────────────────────────`);
  console.log(`[${i + 1}/${selected.length}] ${gate.title}`);
  console.log(`────────────────────────────────────────────────────────────────────`);

  const skipReason = gate.prereq ? gate.prereq() : null;
  if (skipReason) {
    console.log(`  [SKIP] ${skipReason}`);
    results.push({ id: gate.id, title: gate.title, status: "skip", elapsedMs: 0, code: null, out: skipReason });
    continue;
  }

  let result;
  if (gate.fn) {
    const started = Date.now();
    try {
      const checked = gate.fn();
      result = { ...checked, code: checked.ok ? 0 : 1 };
    } catch (e) {
      result = { ok: false, out: `检查器自身异常：${e.message}`, code: 1 };
    }
    result.elapsedMs = Date.now() - started;
  } else {
    const raw = await runCommand(gate.cmd, gate.timeoutMs);
    result = {
      ok: raw.code === 0,
      code: raw.code,
      out: raw.spawnError ? `${raw.out}\n[spawn error] ${raw.spawnError}` : raw.out,
      elapsedMs: raw.elapsedMs,
      timedOut: raw.timedOut
    };
  }

  const seconds = `${(result.elapsedMs / 1000).toFixed(1)}s`;
  if (result.ok) {
    console.log(tail(result.out, VERBOSE ? Number.MAX_SAFE_INTEGER : TAIL_OK));
    console.log(`  [OK] ${seconds}`);
    results.push({ id: gate.id, title: gate.title, status: "pass", elapsedMs: result.elapsedMs, code: result.code });
  } else if (gate.observe && !STRICT) {
    console.log(tail(result.out, VERBOSE ? Number.MAX_SAFE_INTEGER : TAIL_FAIL));
    console.log(`  [WARN] 观察项（基线修复中，不计入失败；加 --strict 可让它卡门）｜ 退出码 ${result.code} ｜ ${seconds}`);
    results.push({ id: gate.id, title: gate.title, status: "warn", elapsedMs: result.elapsedMs, code: result.code });
  } else {
    console.log(tail(result.out, VERBOSE ? Number.MAX_SAFE_INTEGER : TAIL_FAIL));
    const label = result.timedOut ? "TIMEOUT" : "FAIL";
    console.log(`  [${label}] 退出码 ${result.code} ｜ ${seconds}`);
    results.push({ id: gate.id, title: gate.title, status: result.timedOut ? "timeout" : "fail", elapsedMs: result.elapsedMs, code: result.code });
  }
}

/* ── 汇总 ────────────────────────────────────────────────────────────── */
const passed = results.filter(r => r.status === "pass");
const failed = results.filter(r => r.status === "fail" || r.status === "timeout");
const skipped = results.filter(r => r.status === "skip");
const observed = results.filter(r => r.status === "warn");
const totalSeconds = ((Date.now() - totalStarted) / 1000).toFixed(1);

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  汇总");
console.log("════════════════════════════════════════════════════════════════════");
for (const r of results) {
  const mark =
    r.status === "pass" ? "OK  " : r.status === "skip" ? "SKIP" : r.status === "warn" ? "WARN" : "FAIL";
  const time = r.elapsedMs ? `${(r.elapsedMs / 1000).toFixed(1)}s`.padStart(7) : "      -";
  console.log(`  [${mark}] ${time}  ${r.id}`);
}
console.log(
  `\n  通过 ${passed.length} 项 ｜ 失败 ${failed.length} 项 ｜ 观察 ${observed.length} 项 ｜ 跳过 ${skipped.length} 项 ｜ 总耗时 ${totalSeconds}s`
);
if (observed.length) {
  console.log(`  观察项（基线修复中，不阻塞）：${observed.map(r => `${r.id}（退出码 ${r.code}）`).join("、")} —— 加 --strict 可升级为硬门禁`);
}
if (failed.length) {
  console.log(`  失败项：${failed.map(r => `${r.id}（${r.code === 124 ? "超时" : `退出码 ${r.code}`}）`).join("、")}`);
  console.log("  提示：失败项的输出见上方各项尾部；加 --verbose 可打印完整输出。");
}
console.log("════════════════════════════════════════════════════════════════════\n");

process.exit(failed.length ? 1 : 0);
