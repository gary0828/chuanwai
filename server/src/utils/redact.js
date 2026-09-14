// 出网脱敏（服务端侧，硬编码规则）—— 姓名 / 电话 / 金额不出网的最后一道闸门
//
// 为什么在服务端再做一次：前端（工作台）已经过滤过一遍，但**不能信任前端**——
// 工作台是独立部署的静态应用，任何人都能改它的代码后直接调本接口。
//
// 为什么不用「精确键名黑名单」：2026-09-14 实测发现 `focusStudentNames`
// 这种变体直接漏过了精确匹配，学生姓名出网。因此改为**键名归一化 + 语义规则**：
// 宁可多剔除（少一点上下文），也不能漏掉一个姓名。

/** 归一化键名：小写并去掉分隔符，让 student_name / studentName / STUDENT-NAME 等价 */
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_\-\s]/g, "");
}

/** 出现即剔 (值一定是敏感信息) */
const HARD_ROOTS = /(phone|mobile|tel|amount|money|fee|balance|price|idcard|address|email|parent)/;

/** 中文语义上的「姓名类」前缀：这些开头的 name/names 一律剔除 */
const PERSON_PREFIX = /^(name|names|student|focus|teacher|staff|member|child|kid|guardian)/;

/** 明确安全的「名称」前缀：教学实体的名称必须保留，否则模型会失去上下文 */
const SAFE_NAME_PREFIX = /^(kp|unit|class|lesson|course|subject|exam|paper|material|question|topic|weak|latest|chapter|term)/;

/** 课时数量：按既有决策（D5）不出网 */
const HOURS_KEYS = new Set(["remainhours", "totalhours", "hours", "consumedhours"]);

/**
 * 判断某个键是否禁止出网。
 * 规则（按优先级）：
 * 1. 归一名后命中 HARD_ROOTS → 剔除（parentPhone / studentId / amount …）
 * 2. 归一名后等于 name / names → 剔除
 * 3. 以 PERSON_PREFIX 开头且含 name → 剔除（studentName / focusStudentNames …）
 * 4. 以 name/names 结尾且**不**以 SAFE_NAME_PREFIX 开头 → 剔除
 * 5. 课时类键 → 剔除
 */
function isForbiddenKey(key) {
  const k = normalizeKey(key);

  if (HARD_ROOTS.test(k)) return true;
  if (k === "name" || k === "names") return true;
  if (PERSON_PREFIX.test(k) && k.includes("name")) return true;

  if ((k.endsWith("name") || k.endsWith("names")) && !SAFE_NAME_PREFIX.test(k)) {
    return true;
  }
  if (HOURS_KEYS.has(k)) return true;

  return false;
}

/** 文本里出现金额特征即整段替换 */
const MONEY_HINT = /(¥|￥|\d[\d,.]*\s*元)/;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 递归脱敏，返回安全副本与被剔除字段路径（不改动入参）。
 * @returns {{ safe: unknown, removed: string[] }}
 */
function redactDeep(input) {
  const removed = [];

  function walk(node, path) {
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`));
    }
    if (isPlainObject(node)) {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        const childPath = path ? `${path}.${k}` : k;
        if (isForbiddenKey(k)) {
          removed.push(childPath);
          continue;
        }
        out[k] = walk(v, childPath);
      }
      return out;
    }
    if (typeof node === "string" && MONEY_HINT.test(node)) {
      removed.push(path);
      return "[已脱敏]";
    }
    return node;
  }

  const safe = walk(input, "");
  return { safe, removed };
}

/** 字符串级兜底：把 11 位手机号与 18 位身份证替换掉（防止混在自由文本里出网） */
function scrubText(text) {
  return String(text || "")
    .replace(/1[3-9]\d{9}/g, "[手机号已脱敏]")
    .replace(/\d{17}[\dXx]/g, "[证件号已脱敏]");
}

module.exports = { redactDeep, scrubText, isForbiddenKey, normalizeKey };
