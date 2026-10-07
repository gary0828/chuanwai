/**
 * 改动文件的语法检查（不执行代码，避免触发 config 校验与迁移）。
 *
 * 用法：node /tmp/syntax-check.mjs   （在 server/ 目录下运行）
 * 为什么独立成文件：内联 `node -e` 时模板字符串里的反引号会被 shell 解释掉。
 */
import fs from "node:fs";
import vm from "node:vm";

const files = [
  "src/routes/qbank.js",
  "src/routes/qbank-ocr.js",
  "src/routes/qbank-taxonomy.js",
  "src/migrations/027-question-bank-recycle.js",
  "src/migrations/index.js",
  "src/index.js"
];

let bad = 0;
for (const f of files) {
  try {
    new vm.Script(fs.readFileSync(f, "utf8"), { filename: f });
    console.log("  OK  " + f);
  } catch (e) {
    bad += 1;
    console.log("  ERR " + f + " -> " + e.message);
  }
}
console.log("");
console.log(bad === 0 ? "全部语法通过" : bad + " 个文件有语法错误");
process.exit(bad === 0 ? 0 : 1);
