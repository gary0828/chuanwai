#!/usr/bin/env node
/**
 * 静态抽取教务端各页面的「真实 UI 元素」事实清单。
 *
 * 为什么需要它：
 *   写《使用指南》这类面向用户的操作文档时，最大的风险是**凭印象编造控件**——
 *   写了"点右上角的新增按钮"，实际页面上根本没有那个按钮。
 *   本脚本用 node 直接读源文件（不依赖任何外部工具，规避 K-013 的 grep 静默漏返回），
 *   把每页的标题、按钮文案、弹窗标题、表格列名、页签名、表单项、空态文案抽出来，
 *   使文档里出现的每一个控件名都**可追溯到源码**。
 *
 * 用法：
 *   node _verify_test/extract-ui-facts.mjs            # 输出到 _verify_test/_tmp/ui-facts.md
 *   node _verify_test/extract-ui-facts.mjs --print    # 直接打印到 stdout
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const VIEWS = join(ROOT, "src", "views");
const OUT_DIR = join(ROOT, "_verify_test", "_tmp");
const OUT = join(OUT_DIR, "ui-facts.md");

/** 递归收集 .vue 文件 */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".vue")) out.push(p);
  }
  return out.sort();
}

/** 去掉标签、折叠空白 */
function text(s) {
  return String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 抓某个标签的属性值（属性值可能是 "x" 或 'x' 或 `x`） */
function attr(openTag, name) {
  const re = new RegExp(`(?:^|\\s):?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = openTag.match(re);
  if (!m) return "";
  return (m[2] ?? m[3] ?? "").trim();
}

/** 收集同名标签的所有出现（含开标签与内部文本） */
function collect(src, tag, withInner = false) {
  const re = new RegExp(`<${tag}\\b([^>]*?)(/?)>([\\s\\S]*?)</${tag}>`, "g");
  const reSelf = new RegExp(`<${tag}\\b([^>]*?)/>`, "g");
  const rows = [];
  let m;
  while ((m = re.exec(src))) rows.push({ open: m[1], inner: text(m[3]) });
  if (!withInner) {
    const seen = new Set(rows.map(r => r.open));
    while ((m = reSelf.exec(src))) {
      if (!seen.has(m[1])) rows.push({ open: m[1], inner: "" });
    }
  }
  return rows;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

const files = walk(VIEWS);
const lines = [];

lines.push("# 教务端页面 UI 事实清单（源码静态抽取）");
lines.push("");
lines.push(`> 由 \`_verify_test/extract-ui-facts.mjs\` 生成，共 ${files.length} 个 .vue。`);
lines.push("> ⚠️ 本文件是**事实来源**：写操作文档时页面控件名以此为准，不得凭记忆编造。");
lines.push("");

for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  const src = readFileSync(f, "utf8");
  const body = src.replace(/<style[\s\S]*?<\/style>/g, "");

  const headers = collect(body, "AppPageHeader");
  const title = headers.length ? attr(headers[0].open, "title") : "";
  const desc = headers.length ? attr(headers[0].open, "description") : "";

  const buttons = uniq(
    collect(body, "el-button").map(b => {
      const inner = text(b.inner);
      return inner || attr(b.open, "label");
    })
  );

  const dialogs = uniq(
    [
      ...collect(body, "el-dialog").map(d =>
        [attr(d.open, "title"), attr(d.open, ":title")].find(x => x)
      ),
      ...collect(body, "el-drawer").map(d =>
        [attr(d.open, "title"), attr(d.open, ":title")].find(x => x)
      )
    ].filter(Boolean)
  );

  const columns = uniq(
    collect(body, "el-table-column").map(c => attr(c.open, "label") || attr(c.open, ":label"))
  );

  const tabs = uniq(collect(body, "el-tab-pane").map(t => attr(t.open, "label") || attr(t.open, ":label")));

  const formItems = uniq(
    collect(body, "el-form-item").map(i => attr(i.open, "label") || attr(i.open, ":label"))
  );

  const placeholders = uniq(
    [...body.matchAll(/placeholder\s*=\s*("([^"]*)"|'([^']*)')/g)].map(m => m[2] ?? m[3])
  );

  const empties = uniq(
    collect(body, "el-empty").map(e => [attr(e.open, "description"), attr(e.open, "title")].filter(Boolean).join(" / "))
  );

  const hints = uniq(
    [...body.matchAll(/<div[^>]*class="[^"]*page-hint[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => text(m[1]))
  );

  const has = x => (Array.isArray(x) ? x.length : x);
  if (!has(title) && !buttons.length && !columns.length && !tabs.length && !formItems.length) continue;

  lines.push(`## ${rel}`);
  lines.push("");
  if (title) lines.push(`- **页面标题**：${title}`);
  if (desc) lines.push(`- **页面说明**：${desc}`);
  if (dialogs.length) lines.push(`- **弹窗/抽屉**：${dialogs.join(" ｜ ")}`);
  if (tabs.length) lines.push(`- **页签**：${tabs.join(" ｜ ")}`);
  if (buttons.length) lines.push(`- **按钮**：${buttons.join(" ｜ ")}`);
  if (columns.length) lines.push(`- **表格列**：${columns.join(" ｜ ")}`);
  if (formItems.length) lines.push(`- **表单项**：${formItems.join(" ｜ ")}`);
  if (placeholders.length) lines.push(`- **输入框提示**：${placeholders.join(" ｜ ")}`);
  if (empties.length) lines.push(`- **空态文案**：${empties.join(" ｜ ")}`);
  if (hints.length) lines.push(`- **页面小字提示**：${hints.join(" ｜ ")}`);
  lines.push("");
}

const md = lines.join("\n");

if (process.argv.includes("--print")) {
  console.log(md);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, md, "utf8");
  console.log(`已写出 ${relative(ROOT, OUT)}（${md.length} 字符，${files.length} 个文件）`);
}
