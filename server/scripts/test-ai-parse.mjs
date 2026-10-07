// 独立验证脚本：AI 输出容错解析（qbank-ai-parse）
//
// 为什么要独立成脚本（而不是塞进 verify-qbank.mjs）：
//   这两个函数**不依赖 db / express / llm**，是纯字符串处理 ——
//   可以用「喂脏输出、断言结果」的方式穷举测，不需要起服务器。
//   断言按项目规矩**打印实际值**（K-011），不只打 PASS/FAIL。
//
// 用法：node server/scripts/test-ai-parse.mjs
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseModelJson, parseJsonArray } = require(
  join(process.cwd(), "server/src/utils/qbank-ai-parse.js")
);

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label.padEnd(34)} → ${JSON.stringify(actual)}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label.padEnd(34)} 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  }
}

function checkOk(label, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  PASS  ${label}`);
  } catch (err) {
    fail += 1;
    console.log(`  FAIL  ${label} → ${err.message.slice(0, 100)}`);
  }
}

function checkThrows(label, fn, expectFragment) {
  try {
    fn();
    fail += 1;
    console.log(`  FAIL  ${label.padEnd(34)} 期望抛错但没抛`);
  } catch (err) {
    if (expectFragment && !err.message.includes(expectFragment)) {
      fail += 1;
      console.log(`  FAIL  ${label.padEnd(34)} 错误信息不含「${expectFragment}」：${err.message.slice(0, 60)}`);
    } else {
      pass += 1;
      console.log(`  PASS  ${label.padEnd(34)} → 明确报错：${err.message.slice(0, 50)}`);
    }
  }
}

console.log("\n=== parseModelJson · 截图识别走这条 ===");

check("理想输出", parseModelJson('{"stem":"已知x=1","answer":"A"}').data.stem, "已知x=1");

check(
  "markdown 围栏",
  parseModelJson('```json\n{"stem":"被围栏包住"}\n```').data.stem,
  "被围栏包住"
);

check(
  "前置废话（'好的，结果如下：'）",
  parseModelJson('好的，识别结果如下：\n{"stem":"有废话"}').data.stem,
  "有废话"
);

check(
  "LaTeX 单层转义（JSON 里合法的写法）",
  parseModelJson('{"stem":"求 \\frac{1}{2} 的值"}').data.stem,
  "求 \\frac{1}{2} 的值"
);

// ★ 注意「实际值」怎么看：JSON.parse 之后字符串里的**单个反斜杠**才是 LaTeX 正确形态。
//   模型吐的是 `\frac`（零层转义，JSON.parse 会把它当 \f），修复后应还原为单反斜杠。
// ★ 判定口径：JSON.parse 之后**单反斜杠**才是 LaTeX 正确形态。
//   模型吐的是零层转义的 \frac，修复后必须还原成单反斜杠，否则 KaTeX 渲染不出。
check(
  "LaTeX 零层转义（模型常见错，必须修）",
  parseModelJson('{"stem":"求 \\frac{1}{2} 的值"}').data.stem,
  "求 \\frac{1}{2} 的值"
);

check(
  "尾随逗号",
  parseModelJson('{"stem":"尾逗号","answer":"B",}').data.answer,
  "B"
);

check("全角引号", parseModelJson('{“stem”:“全角引号”}').data.stem, "全角引号");

check(
  "选项是数组",
  parseModelJson('{"stem":"t","options":["A项","B项"]}').data.options,
  ["A项", "B项"]
);

checkThrows("空返回", () => parseModelJson(""), "空");
checkThrows("完全没有 JSON", () => parseModelJson("模型说：我看不清这张图"), "没有返回 JSON");

console.log("\n=== parseJsonArray · AI 出题走这条 ===");

check("理想数组（2 道）", parseJsonArray('[{"stem":"题1"},{"stem":"题2"}]').length, 2);

check(
  "围栏 + 前置废话",
  parseJsonArray('题目如下：\n```json\n[{"stem":"围栏题"}]\n```').length,
  1
);

check("尾随逗号", parseJsonArray('[{"stem":"尾逗号"},]').length, 1);

check(
  "LaTeX 零层转义（数组路径同样要修）",
  parseJsonArray('[{"stem":"求 \\frac{1}{2}"}]')[0].stem,
  "求 \\frac{1}{2}"
);

check(
  "★ 模型忘了包数组（只回对象）→ 自动包一层",
  parseJsonArray('{"stem":"单对象题"}').length,
  1
);

check(
  "★ 混入空题干元素 → 被过滤掉",
  parseJsonArray('[{"stem":"好题"},{"stem":"  "},{"stem":""}]').length,
  1
);

check("空数组 → 0 道（不报错）", parseJsonArray("[]").length, 0);

checkThrows("完全无法解析", () => parseJsonArray("对不起，我无法完成"), "没有返回 JSON");

console.log("\n=== 字段清洗 ===");

const card = parseJsonArray(
  '[{"type":"选择题","stem":"t","options":["A","B","C","D","E"],"answer":["A","B"],"difficulty":9,"knowledgePoints":["三角函数",123]}]'
)[0];

check("模糊题型「选择题」+ 5 选项 → 多选题", card.type, "多选题");
check("数组答案归一为字符串", card.answer, "A；B");
// 越界难度 → **拒绝并落默认 3**（不是收敛到边界）：
//   「难度 9」在 1–5 的语义下无意义，猜成 5 比猜成 3 更危险。
check("越界难度 9 → 拒绝并落默认 3", card.difficulty, 3);
check("知识点里混入数字 → 归一为字符串", card.knowledgePoints, ["三角函数", "123"]);

console.log(`\n结果：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);