/**
 * LaTeX 渲染（KaTeX）
 *
 * ★★ 为什么 KaTeX 只能渲染**裸公式体**，不能直接喂含 `$...$` 的整段文本（2026-10-07 实测踩坑）：
 *   `katex.renderToString("$\\alpha$")` 会报
 *     `Can't use function '$' in math mode at position 1`
 *   并在 `throwOnError:false` 下**渲染成一个红框错误**，页面看起来是"公式没生效"。
 *   —— `$...$` 分隔符是 **auto-render 扩展**的职责，`renderToString` 不认。
 *
 *   正解（本文件采用，与 auto-render 同一思路）：**按 `$...$` / `$$...$$` 切片**，
 *   偶数段是普通文本（转义后拼接），奇数段才是公式（剥掉分隔符再renderToString）。
 *
 * ★ 为什么不用 katex/contrib/auto-render：
 *   它绑定 DOM 文本节点、异步批量处理，对「题干里嵌公式、选项里嵌公式」的
 *   字符串拼接场景不合适 —— 我们要的是**字符串 → 字符串**，由 v-html 直接用。
 */
import katex from "katex";

/** 匹配 $...$ 与 $$...$$（顺序很重要：长分隔符在前） */
const FORMULA_SPLIT = /(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g;

/** KaTeX 公共选项 */
const KATEX_OPTS = {
  // ★ 关键：公式写错时不抛异常，KaTeX 把出错片段渲染成红色原文。
  //   老师的题库里一定有写错的公式 —— 一个错公式不能带崩整个列表页。
  throwOnError: false,
  // 公式里的 \ 已在数据库里存成单反斜杠，KaTeX 能直接吃；关掉严格校验避免误报
  strict: false,
  // ★ 禁止 \htmlClass 等注入型命令（题库内容来自模型与 Excel，需要防注入）
  trust: false,
  // 只输出 HTML（不重复输出 MathML），体积更小
  output: "html" as const
};

/**
 * 渲染含 LaTeX 的文本 → HTML 字符串。
 * @param text 原始文本，可含 $...$ / $$...$$
 * @param displayMode 传入时强制整段按行间公式渲染（用于独立成行的答案）
 */
export function renderLatex(text: string, displayMode = false): string {
  const src = String(text ?? "");
  if (!src) return "";

  // 强制行间：整段剥掉 $$ 当作公式体渲染
  if (displayMode) {
    const body = src.replace(/^\$\$?/, "").replace(/\$\$?$/, "").trim();
    return body.includes("\\") ? safeRender(body, true) : escapeHtml(src);
  }

  // 没有 $ 就直接转义返回（省一次调用，也避免把普通文本里的 $ 误当公式）
  if (!src.includes("$")) return escapeHtml(src);

  // ★ 按分隔符切片：偶数段纯文本，奇数段公式
  const parts = src.split(FORMULA_SPLIT).filter((p) => p !== "");
  let html = "";
  for (const part of parts) {
    const blockMatch = part.match(/^\$\$([\s\S]*)\$\$$/);
    const inlineMatch = part.match(/^\$([^$\n]*)\$$/);
    if (blockMatch) {
      html += safeRender(blockMatch[1], true);
    } else if (inlineMatch) {
      html += safeRender(inlineMatch[1], false);
    } else {
      html += escapeHtml(part);
    }
  }
  return html;
}

/** 单个公式体 → HTML（失败则退回转义原文，绝不抛出） */
function safeRender(body: string, display: boolean): string {
  const expr = String(body || "").trim();
  if (!expr) return "";
  try {
    return katex.renderToString(expr, { ...KATEX_OPTS, displayMode: display });
  } catch {
    //连 KaTeX 自己都抛了（极端输入）→ 至少把原文安全转义显示
    return escapeHtml(expr);
  }
}

/** 行内公式（题干、选项、答案用） */
export function renderInline(text: string): string {
  return renderLatex(text, false);
}

/** 行间公式（独立成行的公式用） */
export function renderBlock(text: string): string {
  return renderLatex(text, true);
}

/** HTML 转义（用于无公式的纯文本，防止题干里的 < > 被当标签解析） */
export function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 题干摘要（查重提示、删除确认用）：**保留 $ 分隔符**再截断。
 *
 * ★ 踩过的坑（2026-10-07 实测）：原实现把 `$` 剥掉再截断，
 *   视图里 `renderInline(stemPreview(...))` 就再也认不出公式了 ——
 *   查重提示框里会露出裸露的 \vec{...}，与「公式必须渲染」的验收标准冲突。
 *   ⇒ **截断不该改变语义**。真要控制长度，用 `trimToFormulaSafe()`
 *   只在**公式段之外**截断，保持每段$...$ 完整。
 *
 * @param n 期望的最大长度（超了会在公式边界处断开并加省略号）
 */
export function stemPreview(text: string, n = 80): string {
  const src = String(text ?? "").replace(/\s+/g, " ").trim();
  if (src.length <= n) return src;

  // 在公式段边界处断开：保留到第n 个字符所在的**最后一个完整公式结束处**
  const parts = src.split(FORMULA_SPLIT);
  let out = "";
  for (const part of parts) {
    if ((out + part).length > n) {
      // 只有公式段能完整带上，纯文本段超了就直接截
      if (/^\$\$[\s\S]*\$\$$|^\$[^$\n]*\$$/.test(part)) out += part;
      else if (out.length < n) out += part.slice(0, n - out.length);
      break;
    }
    out += part;
  }
  return `${out.trim()}…`;
}