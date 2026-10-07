// AI 输出的容错解析（模型返回 → 可用结构）
//
// ★ 单独成文件的原因（2026-10-07）：这两个函数是「AI 录题」里**最容易出错**的部分，
//   而它们**不依赖 db / express / llm**，完全可以独立测。
//   之前内联在路由文件里，导致要靠 eval + 构造器绕路才能测（实测踩了 3 次才成功）——
//   这本身就是设计信号：**该抽出来**。
//
// ★★ 最需要小心的坑：**LaTeX 与 JSON 互相打架**
//   公式 `\frac{1}{2}` 里那个反斜杠，放进 JSON 字符串要写成 `\\frac{1}{2}`；
//   模型经常少写一层或多写一层→ 直接 JSON.parse 会抛异常，整道题录不进来。
//   下面 `ATTEMPTS` 的多级修复链**是实测必需**，不是「保险起见」。

/** 允许从模型输出里识别出的题型 */
const QUESTION_TYPES = ["单选题", "多选题", "填空题", "判断题", "解答题", "简答题"];

/** 剥 markdown 围栏并截取第一对括号 —— 大多数脏输出都能在这里被清掉 */
function extractSlice(text, open, close) {
  const s = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = s.indexOf(open);
  const end = s.lastIndexOf(close);
  if (start < 0 || end <= start) return null;
  return s.slice(start, end + 1);
}

/**
 * 逐级修复并解析。返回 { data, how } —— `how` 说明是靠哪一级修好的，
 * 生产环境里打到日志便于后续调prompt。
 */
function parseWithAttempts(slice, attempts) {
  const failures = [];
  for (const [name, candidate] of attempts) {
    if (candidate == null) continue;
    try {
      const parsed = JSON.parse(candidate);
      return { data: parsed, how: name };
    } catch (err) {
      failures.push(`${name}: ${err.message.slice(0, 50)}`);
    }
  }
  return { data: null, failures };
}

/**
 * 修复「JSON 里未转义的反斜杠」：单个 `\` 后不是合法 JSON 转义时，补一层。
 *
 * ★★ 这里有个**极隐蔽的坑**（2026-10-07 实测踩到）：
 *   `\frac` 里的 `\f` **在字符层面确实匹配 JSON 的 `\f`（form feed换页符）**，
 *   所以「按 JSON 白名单判断」的写法会放过它 →
 *   JSON.parse 把它吃成换页符，**结果 `\frac` 变成 `rac`（反斜杠消失）**，
 *   界面上公式静默渲染成 "rac{1}{2}"，不报错、只是**看不见公式**。
 *
 *   判据（实用且可靠）：**若 `\` 后面紧跟字母，且字母不是 JSON 真正的换行/制表类转义**，
 *   它就是 LaTeX 命令（`\frac` `\times` `\beta` `\leq`），必须补一层。
 *   `\n` `\r` `\t` `\b` 是真实的控制字符转义，**不能动**。
 *
 * 参数：fromModel=true 表示「来自模型零层转义」；false 表示已合法，不用改。
 */
/**
 * 修复「JSON 里未转义的反斜杠」（模型零层转义时用）。
 *
 * ★★★ 本项目最隐蔽的一个坑（2026-10-07 实测踩到并修好，返工 3 次）：
 *
 *   LaTeX 命令 `\frac` `\beta` `\times` 里的 `\f` `\b` `\t`，
 *   **在字符层面确实匹配 JSON 的转义**（\f=换页符、\b=退格符、\t=制表符）。
 *   只要按「JSON 转义白名单」判断，它们就会被**原样放行**，
 *   然后 JSON.parse把它们吃成控制字符：
 *       \frac→ "rac"（f 变换页符，反斜杠消失）
 *       \beta  → "eta"  （b 变退格符）
 *       \times → "imes" （t 变制表符）
 *   后果：界面上公式**静默消失**，不报错、不抛异常——
 *   与 K-038（Vue 属性插值）、K-050（静默即缺陷）同型：**只在运行时表现为「东西不见了」**。
 *
 * ★★ 更隐蔽的一层：**不能靠「先试原样、失败再修复」**。
 *   `{"stem":"求 \frac{1}{2}"}` 在 JSON 语法上**完全合法**（\f 就是 form feed），
 *   所以「原样」那一次会**解析成功**并直接返回 —— 降级式修复对这类bug **完全失效**。
 *   ⇒ 必须**在解析之前无条件修一次**（见 parseModelJson 里的 fixed 变量）。
 *
 * ★ 策略：逐字符扫描，遇到 `\` 一律按「需要转义」处理，但保留三种例外
 *   ——`\"` `\\` `\/`（JSON 的字符串/反斜杠/斜杠转义，重复补会破坏），
 *   `\uXXXX`（Unicode 转义，必须成组保留）。
 *   `\n \r` **不保留**：模型很少在 JSON 里写它们，且题干预里出现真实换行
 *   应该用真正的换行符；若模型写了 `\n`，补一层后 JSON.parse 得到的
 *   是字面 `\n` 两个字符，语义上更接近「题干里有个反斜杠n」，可接受且不致命。
 */
function fixBackslashes(s) {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    const next = s[i + 1];
    // 已合法的转义：原样保留（补第二层会把它变成字面反斜杠）
    if (next === '"' || next === "\\" || next === "/") {
      out += s[i] + next;
      i += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
      out += s[i] + next + s.slice(i + 2, i + 6);
      i += 5;
      continue;
    }
    // 其余一律（含 \frac 的 f、\beta 的 b、\times 的 t、\n、未知命令）：
    //   把单个反斜杠变成两个，JSON.parse 后即得回单个 —— 即 LaTeX 正确形态。
    out += "\\\\";
    // ★ 刻意**不跳过 next**：让 next 作为普通字符在下一轮正常输出。
    //   （早期版本写了 i += 1，导致 next 被吞 → \frac 变成 \rac）
  }
  return out;
}

/** 修复尾随逗号：[1,2,] / {"a":1,} */
function fixTrailingComma(s) {
  return s.replace(/,\s*([}\]])/g, "$1");
}

/** 修复全角引号 */
function fixQuotes(s) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/**
 * 解析模型返回的**单个 JSON 对象**（截图识别走这条）。
 * @throws {Error} 带原始片段的错误信息（调用方据此提示用户，且不打印完整题干）
 */
function parseModelJson(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("模型返回内容为空");

  const slice = extractSlice(text, "{", "}");
  if (!slice) {
    throw new Error(`模型没有返回 JSON（收到：${text.slice(0, 60)}…）`);
  }

  // ★★ 修复顺序是**刻意的**，别改成「先试原样」——
  //   `{"stem":"求 \frac{1}{2}"}` 在 JSON 语法上**完全合法**（\f 是 form feed），
  //   所以「原样」这一级会**解析成功**并返回，但题干的反斜杠已被吃掉变成 "rac"。
  //   即：**降级式修复对这一类bug 完全失效**，它必须在解析之前就无条件执行。
  //
  //   换句话说：LaTeX 零层转义不是「解析失败」，是「静默解析成错的东西」——
  //   这与 K-038（Vue 属性插值）和 K-050（静默即缺陷）是同一种病：
  //   **不报错，只在运行时表现为「东西不见了」**。
  const fixed = fixTrailingComma(fixBackslashes(slice));

  const { data, failures } = parseWithAttempts(fixed, [
    ["修复后", fixed],
    ["修复后+规范引号", fixQuotes(fixed)],
    // 兜底：若修复后仍失败，去掉修复再试一次（防止修复本身误伤合法转义）
    ["仅去尾逗号（不修反斜杠）", fixTrailingComma(slice)],
    ["原文", slice]
  ]);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `模型返回的 JSON 无法解析（已尝试 ${failures.length} 种修复）。原始片段：${slice.slice(0, 120)}…`
    );
  }
  return { data, how: "ok" };
}

/**
 * 解析模型返回的 **JSON 数组**（AI 出题走这条）。
 *
 * ★ 容错点额外两条（实测模型真的这么干过）：
 *   · 模型忘了包数组，只回一个对象 → 自动包成单元素数组（总比整批失败好）；
 *   · 数组里混进非对象或空题干元素 → 过滤掉，不让一条坏数据毁掉整批。
 * @throws {Error}
 */
function parseJsonArray(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("模型返回内容为空");

  let slice = extractSlice(text, "[", "]");

  if (!slice) {
    // 模型忘了数组 → 尝试按单对象解析并包一层
    const obj = extractSlice(text, "{", "}");
    if (!obj) throw new Error(`模型没有返回 JSON（收到：${text.slice(0, 60)}…）`);
    const { data } = parseWithAttempts(fixTrailingComma(fixBackslashes(obj)), [
      ["修复后", fixTrailingComma(fixBackslashes(obj))],
      ["原文", obj]
    ]);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return [normalizeCard(data)];
    }
    throw new Error(`模型返回的内容无法解析为题目列表（收到：${text.slice(0, 60)}…）`);
  }

  // ★ 同 parseModelJson：**先无条件修反斜杠**，不能靠「原样先试」——
  //   `\frac` 在 JSON 语法合法，原样解析会成功但把公式吃掉（静默失败）。
  const fixed = fixTrailingComma(fixBackslashes(slice));
  const { data, failures } = parseWithAttempts(fixed, [
    ["修复后", fixed],
    ["仅去尾逗号（不修反斜杠）", fixTrailingComma(slice)],
    ["原文", slice]
  ]);

  if (!Array.isArray(data)) {
    throw new Error(
      `模型返回的数组无法解析（已尝试 ${failures.length} 种修复）。原始片段：${slice.slice(0, 100)}…`
    );
  }
  return data.map(normalizeCard).filter(Boolean);
}

/**
 * 清洗题型：认不出来就按选项数量猜，再兜底单选。
 * ⚠ 不返回 null —— 一期不做「题型必填」的强校验，由前端的可编辑题卡承载。
 */
function normalizeType(raw, options) {
  const s = String(raw || "").trim();
  for (const t of QUESTION_TYPES) {
    // 「选择题」这类模糊说法也算命中
    if (s.includes(t) || s.includes(t.replace("选择题", ""))) return t;
  }
  if (s.includes("选择") || s.includes("choice")) {
    return options.length > 4 ? "多选题" : "单选题";
  }
  if (s.includes("判断") || s.includes("true")) return "判断题";
  if (s.includes("填空") || s.includes("fill") || s.includes("解答")) return "填空题";
  if (s.includes("计算") || s.includes("证明") || s.includes("简答")) return "解答题";
  return options.length > 4 ? "多选题" : "单选题";
}

/** 答案归一：模型可能给 "A" / "AB" / ["A","B"] / {A:"x"} */
function normalizeAnswer(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? "").trim()).filter(Boolean).join("；");
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .map(([k, v]) => `${k}:${v}`)
      .join("；");
  }
  return String(raw ?? "").trim();
}

/** 把任意一条模型输出整理成统一结构；题干为空返回 null（该条丢弃） */
function normalizeCard(x) {
  if (!x || typeof x !== "object") return null;
  const stem = String(x.stem ?? "").trim();
  if (!stem) return null;
  const options = Array.isArray(x.options)
    ? x.options.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const d = Number(x.difficulty);
  return {
    type: normalizeType(x.type, options),
    stem,
    options,
    answer: normalizeAnswer(x.answer),
    analysis: String(x.analysis ?? ""),
    difficulty: Number.isInteger(d) && d >= 1 && d <= 5 ? d : 3,
    knowledgePoints: Array.isArray(x.knowledgePoints)
      ? x.knowledgePoints.map((s) => String(s ?? "").trim()).filter(Boolean)
      : []
  };
}

module.exports = {
  parseModelJson,
  parseJsonArray,
  normalizeType,
  normalizeAnswer,
  normalizeCard,
  QUESTION_TYPES
};