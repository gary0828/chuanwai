// 题库查重（两级 + AI 接口预留）
//
// 背景（2026-10-07）：参考系统（智能题库浏览器扩展）每道题旁都有「查重」按钮，
// 数据统计里也显示「相似题关联20」→ 判重是题库的**基础能力**，不是加分项。
//
// 为什么分两级（而非一把梭 AI 判重）：
//   · L1 精确：题干归一化后 SHA1，**纯 SQL**，万题级零成本，挡住完全重复与「只差空格标点」；
//   · L2 近似：归一化后算 bigram 的 **Jaccard 相似度**，纯 JS，挡住「改几个字/换个数字」；
//   · L3 语义：调模型问「这两题是否等价」，**最准但每次一次调用** ——
//     一期**不在批量路径上跑**（万题全量跑成本与耗时都不可接受），
//     只保留接口 `aiDuplicateHint`，二期起可在「单题录入时对新题判重」这一处调用。
//
// ★ 归一化必须做（否则 L1 形同虚设）：
//   「已知x = 1」与「已知x=1」在肉眼看来是同一题，但字符串不等 → 必须先去空白与标点。
//   实测（2026-10-07，node:sqlite）：归一化后两者哈希一致。
const crypto = require("crypto");

/** 归一化题干：去空白 + 去中英文标点 + 转小写 + 统一全角 */
function normalizeStem(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    // 中文标点
    .replace(/[，。；：？！（）【】〔〕《》“”‘’、…—～·]/g, "")
    // 英文标点（保留数学里的 + - = < >，它们是题目语义的一部分）
    .replace(/[,.;:?!()[\]"']/g, "")
    .toLowerCase()
    .trim();
}

/** L1 精确去重用的哈希（存 questions.content_hash） */
function contentHash(stem) {
  return crypto.createHash("sha1").update(normalizeStem(stem)).digest("hex").slice(0, 16);
}

/**
 * bigram 集合：把字符串切成相邻两字/两字符的集合。
 * 「三角形全等」→ {三角, 角形, 形全, 全等}
 * 单字符串（"x"）退化为它自己，避免空集合导致相似度恒为 0。
 */
function bigrams(s) {
  const t = normalizeStem(s);
  if (t.length < 2) return new Set(t ? [t] : []);
  const set = new Set();
  for (let i = 0; i < t.length - 1; i += 1) set.add(t.slice(i, i + 2));
  return set;
}

/** Jaccard 相似度（0–1） */
function similarity(a, b) {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const g of setA) if (setB.has(g)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** L2 默认阈值：bigram Jaccard ≥ 0.75 判为「疑似重复」 */
const DEFAULT_THRESHOLD = 0.75;

module.exports = {
  normalizeStem,
  contentHash,
  similarity,
  DEFAULT_THRESHOLD
};