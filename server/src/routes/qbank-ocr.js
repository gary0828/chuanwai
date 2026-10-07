// 智能题库 · 一期：AI 截图识别录题
//
// 能力来源（2026-10-07 实测确认）：
//   DeepSeek 已于 2026-08-21 上线 `deepseek-v4-flash-vision-exp`，支持图片输入，
//   单图 ≤384 tokens，与 V4-Flash 同价 → 本项目**无需新依赖**即可做「截图 → 题卡」。
//   ★ 而 `utils/llm.js:79` 是**直接透传 cfg.model、无白名单**，
//     所以模型名只需在「AI 配置中心」改一次，**本文件不需要硬编码模型名** ——
//     若某个环境没配 vision 模型，调用会失败并在这里降级为明确报错（不静默）。
//
// 设计取舍（三条，都是为了「不能静默」这个项目铁律K-050）：
//
//   1. **识别结果不自动入库**。返回题卡让老师核对后再存 —— 理由：OCR 会错，
//      自动入库会污染题库，而「错题进库」比「没录进来」更难清理。
//   2. **图片只转发不落盘**（除非将来做配图功能）。题库不因此囤积图片。
//   3. **失败必须明确**。模型超时/返回非 JSON/字段缺失 → 全部返回可读原因，
//      绝不让页面显示空白（那正是 K-050 记的事故形态）。
//
// ★ 本文件最需要小心的坑：**LaTeX 与 JSON 互相打架**
//   公式 `\frac{1}{2}` 里那个反斜杠，放进 JSON 字符串要写成 `\\frac{1}{2}`；
//   模型常常忘记转义，或多写一层、少写一层 → 直接 JSON.parse 会炸。
//   `parseModelJson()` 下面有完整的容错链，不是「保险起见」而是实测必需。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const llm = require("../utils/llm");
const { audit } = require("../utils/audit");
const dedupe = require("../utils/qbank-dedupe");
// ★ 容错解析抽成独立模块：它不依赖 db/express/llm，可单独穷举测脏输出
//   （见 server/scripts/test-ai-parse.mjs）—— 内联在路由里时要靠 eval 绕路才能测，那是设计信号。
const aiParse = require("../utils/qbank-ai-parse");
const { parseModelJson, parseJsonArray, normalizeType, normalizeAnswer } = aiParse;

const router = express.Router();

/**
 * 把模型给的知识点**名称**反查成 id 数组。
 *
 * ★★ 抽成函数的原因（2026-10-07）：
 *   OCR 识别路径原本**自己写了一段**反查，而 AI 出题路径**根本没反查** ——
 *   结果后者返回的题卡只有名称，前端保存时不知道往 kp_ids 里塞什么，
 *   于是"AI 建议的知识点"被整个丢弃（后端辛苦算了却白做）。
 *   ⇒ 两条路径**必须共用同一份反查**，否则下次加字段还会漏一条。
 *
 * 匹配策略：**精确同名**。找不到就不挂（宁可漏挂，也不猜 —— 猜错会污染知识点统计）。
 *
 * @param {string[]} names 模型输出的知识点名称
 * @returns {number[]} 匹配到的知识点 id（去重）
 */
function resolveKpNamesToIds(names, courseId) {
  if (!Array.isArray(names) || !names.length) return [];
  const clean = [...new Set(names.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (!clean.length) return [];

  // ★★ 必须限定在**同一学科内**匹配（迁移 028）：
  //   不同学科会有同名知识点（如数学与物理都有「图像」、化学与生物都有「细胞」类概念），
  //   不限学科会把物理题的知识点挂到数学的知识点 id 上 —— 交叉污染学情统计。
  const cid = Number(courseId);
  const courseClause = Number.isInteger(cid) && cid > 0 ? " AND course_id = ?" : "";
  const courseParams = Number.isInteger(cid) && cid > 0 ? [cid] : [];

  const rows = db
    .prepare(
      `SELECT id FROM knowledge_points
        WHERE name IN (${clean.map(() => "?").join(",")})${courseClause}`
    )
    .all(...clean, ...courseParams);
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * 取用于 LIKE 粗筛的原文探针（**必须来自原始题干**，不能用 normalizeStem）。
 * 详细口径与踩坑说明见 server/src/routes/qbank.js 的 rawProbe()。
 */
function rawStemProbe(stem, len = 8) {
  const raw = String(stem || "").trim();
  if (raw.length < 3) return "";
  let cut = Math.min(len, raw.length);
  while (cut > 1 && /[\s，。；：？！（）【】、,.;:?!()\[\]"'""''~—\-]/.test(raw[cut - 1])) {
    cut -= 1;
  }
  return raw.slice(0, cut);
}

/** 单图上限：4MB（base64 约 5.3MB）。超过直接拒，不进模型。 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** 允许的图片类型（与 utils/image.js 的魔数判型口径一致） */
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

const QUESTION_TYPES = ["单选题", "多选题", "填空题", "判断题", "解答题", "简答题"];

/**
 * 容错解析模型返回的 JSON。
 *
 * 实测过的模型输出形态（都不罕见）：
 *   a) ```json\n{...}\n```        ← 被 markdown 围栏包住
 *   b) 前置一句「好的，识别结果如下：」再跟 JSON
 *   c) JSON 里LaTeX 的反斜杠只转义了一层或**零层**（`\frac` → JSON.parse 直接抛）
 *   d) 末尾多了逗号（尾随逗号）
 *   e) 单引号 / 无引号的键
 *
 * 策略：从文本里**扫出最像JSON 的那段**（找第一个 { 到最后一个 }），
 * 然后逐级尝试：原样 → 补转义 → 去尾随逗号。**任一级成功即返回**，
 * 全失败则抛出带原始片段的错误（供前端提示，不打印完整题干避免刷屏）。
 */
/**
 * AI 截图识别 → 结构化题卡。
 *
 * body: { image: "data:image/png;base64,....", kpHint?: number[] }
 * 权限：qb_agent 或教务 token（auth 中间件已校验）
 *
 * 返回（不落库）：{
 *   card: { type, stem, options, answer, analysis, difficulty, kpIds, source },
 *   confidence: 0–1,
 *   raw: 原始输出（折叠展示，便于老师核对）
 *   duplicate: { exact: [...], similar: [...] }← 顺手查重，省得老师录完才发现重了
 * }
 */
router.post("/ocr/recognize", auth, requireRole("admin", "teacher"), async (req, res) => {
  const startedAt = Date.now();

  // ── 1. 入参校验（在校验失败时明确报错，不进模型）────────────────────
  const image = String(req.body?.image || "");
  if (!image) {
    return res.status(400).json({ success: false, message: "请先上传题目截图" });
  }
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(image);
  if (!m) {
    return res.status(400).json({ success: false, message: "图片格式不正确，请重新截图上传" });
  }
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.includes(mime)) {
    return res.status(400).json({
      success: false,
      message: `不支持的图片格式（${mime}），请用 PNG / JPEG / WebP / GIF 截图`
    });
  }
  // base64 长度 ≈ 原始字节 × 4/3，用它判大小，避免先解码再判（省内存）
  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return res.status(400).json({
      success: false,
      message: `图片太大（约 ${(approxBytes / 1024 / 1024).toFixed(1)}MB），请截小一点再上传（上限 4MB）`
    });
  }

  // ★ 学科必填（迁移 028）：AI 识别出的题要归属老师当前所在学科。
  //   模型无从知道老师在哪个学科操作，所以由**前端**在请求里带 course_id。
  //   ★★ 顺序刻意放在这里（**入参校验区**）：先校验入参、再查依赖。
  //     反过来的话，没配 Key 时返回 503，会把「你没选学科」这个更基础的错误盖掉 ——
  //     老师会去翻 AI 配置，而真正该做的只是先选学科（2026-10-07 实测踩到）。
  const ocrCourseId = Number(req.body?.course_id);
  if (!Number.isInteger(ocrCourseId) || ocrCourseId <= 0) {
    return res.status(400).json({ success: false, message: "请先选择学科再识别题目" });
  }
  if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(ocrCourseId)) {
    return res.status(400).json({ success: false, message: "所选学科不存在" });
  }

  // ── 2. 模型是否可用：明确报「没配」而不是让调用失败 ────────────────
  if (!llm.isConfigured()) {
    return res.status(503).json({
      success: false,
      message: "尚未配置大模型Key，无法识别题目。请到「AI 配置中心」填写后再试"
    });
  }

  // ── 3. 组提示词 ───────────────────────────────────────────────────
  const kpHint = Array.isArray(req.body?.kpHint)
    ? req.body.kpHint.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10)
    : [];
  const kpNames = kpHint.length
    ? db
        .prepare(
          `SELECT id, name FROM knowledge_points WHERE id IN (${kpHint.map(() => "?").join(",")})`
        )
        .all(...kpHint)
        .map((r) => `${r.id}=${r.name}`)
    : [];

  const instruction = `你是一名中学数学/物理教辅题目录入助手。用户会给你一张题目截图（含题干、选项、可能的配图、可能带答案与解析）。

请把这道题提取为结构化题目，**只输出一个 JSON 对象**，不要输出任何解释文字、不要用markdown 代码围栏。

JSON 结构：
{
  "type": "单选题|多选题|填空题|判断题|解答题|简答题",
  "stem": "题干原文（**保留 LaTeX 公式**，用 $...$ 或 $$...$$ 包裹；去掉页眉页脚与题号）",
  "options": ["A项内容", "B项内容", "..."],
  "answer": "答案（选择题只填字母，多选用 AB 或数组；非选择题填答案本身）",
  "analysis": "解析原文；截图里没有解析就写 \"\"",
  "difficulty": 1到5的整数（1最易、5最难）,
  "knowledgePoints": ["知识点名称", "..."],
  "hasFigure": true或false,
  "confidence": 0到1的小数，表示你对本次识别的把握
}

注意：
1. **JSON 字符串里的 LaTeX 反斜杠必须转义**：\\frac 表示 \\frac，一个反斜杠要写成两个。
2. 不要编造截图中没有的内容；看不清就把该字段留空字符串。
3. options 只在选择题时给数组，其他题型给 []。${kpNames.length ? `\n4. 老师预选的知识点供参考：${kpNames.join("、")}` : ""}`;

  const messages = [
    { role: "system", content: instruction },
    {
      role: "user",
      content: [
        { type: "text", text: "识别这道题：" },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ];

  // ── 4. 调模型（超时放宽到 90s：vision 推理比纯文本慢）──────────────
  let llmResult;
  try {
    llmResult = await llm.chat(messages, { temperature: 0.2, maxTokens: 4000, timeoutMs: 90_000 });
  } catch (err) {
    const reasons = {
      LLM_NOT_CONFIGURED: "尚未配置大模型 Key",
      LLM_TIMEOUT: "模型响应超时（90 秒）。题目太复杂或网络较慢，可重试或改用手工录入",
      LLM_EMPTY: "模型返回内容为空（可能该截图不含可识别的题目）",
      LLM_HTTP_ERROR: err.message
    };
    return res.status(502).json({
      success: false,
      // ★ K-050：把原因如实说清，不让页面空白
      message: reasons[err.code] || `识别失败：${err.message}`,
      code: err.code || "LLM_ERROR"
    });
  }

  // ── 5. 容错解析（见文件头「最需要小心的坑」）──────────────────────
  let parsed;
  try {
    parsed = parseModelJson(llmResult.text);
  } catch (err) {
    audit(req.user, "AI识别题目", `解析失败：${err.message.slice(0, 80)}`);
    return res.status(502).json({
      success: false,
      message: `识别结果无法处理：${err.message}`,
      hint: "这通常是模型输出格式异常。可以重试，或改用「手工新增」录入这道题"
    });
  }

  const d = parsed.data;
  const options = Array.isArray(d.options)
    ? d.options.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const type = normalizeType(d.type, options);

  // 知识点：模型给的是名称 → 反查 id（限定本学科内，见 resolveKpNamesToIds 注释）
  const kpIds = resolveKpNamesToIds(d.knowledgePoints, ocrCourseId);

  const confidence = Number.isFinite(Number(d.confidence))
    ? Math.max(0, Math.min(1, Number(d.confidence)))
    : null;

  const stem = String(d.stem ?? "").trim();
  if (!stem) {
    return res.status(422).json({
      success: false,
      message: "没能从这张图里读出题干。请确认截图包含完整题目，或改用手工录入"
    });
  }

  // ── 6. 顺手查重：录之前就告诉老师「这道题题库里已经有了」──────────
  // ★★ 必须限定**同一学科内**（迁移 028）—— 与 qbank.js 的查重同口径。
  //   这两处是**两份独立实现**（横向扫描才发现只改了一处）；
  //   不限学科的后果：物理题被告知"与数学题重复"，老师点进去一脸问号。
  const exact = db
    .prepare(
      `SELECT id, stem FROM questions
       WHERE deleted_at IS NULL AND content_hash = ? AND status != '已归档' AND course_id = ?
       LIMIT 5`
    )
    .all(dedupe.contentHash(stem), ocrCourseId);
  // ★ 同routes/qbank.js 里修过的那个坑：探针必须取**原始题干**片段，
  //   不能用 normalizeStem 的结果（那不是 stem 列的子串 → LIKE 一条都匹配不到）。
  //   详细说明见 qbank.js 的 rawProbe() 注释。
  const probe = rawStemProbe(stem);
  let similar = [];
  if (probe.length >= 3 && exact.length === 0) {
    const candidates = db
      .prepare(
        `SELECT id, stem FROM questions
         WHERE deleted_at IS NULL AND content_hash != ? AND status != '已归档' AND course_id = ?
           AND stem LIKE ? ESCAPE '\\' LIMIT 300`
      )
      // ★ 参数顺序与 SQL 的 ? 一一对应：学科在 LIKE 之前
      .all(dedupe.contentHash(stem), ocrCourseId, `%${probe.replace(/[%_]/g, (x) => `\\${x}`)}%`);
    similar = candidates
      .map((c) => ({ id: c.id, stem: c.stem, similarity: dedupe.similarity(stem, c.stem) }))
      .filter((c) => c.similarity >= dedupe.DEFAULT_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  const cost = llmResult.cost ?? null;
  audit(
    req.user,
    "AI识别题目",
    `识别成功（${(Date.now() - startedAt) / 1000}s，置信度 ${confidence ?? "未知"}）`
  );

  // ★ 注意：这里**没有 INSERT**。题目等老师核对后才入库。
  res.json({
    success: true,
    data: {
      card: {
        type,
        stem,
        options,
        answer: normalizeAnswer(d.answer),
        analysis: String(d.analysis ?? ""),
        difficulty: Number.isInteger(Number(d.difficulty))
          ? Math.max(1, Math.min(5, Number(d.difficulty)))
          : 3,
        kpIds,
        hasFigure: Boolean(d.hasFigure)
      },
      confidence,
      duplicate: { exact, similar },
      model: llmResult.model,
      cost,
      elapsedMs: Date.now() - startedAt,
      // 原始输出折叠展示 —— 识别错了老师能对照原文排查
      raw: String(llmResult.text).slice(0, 4000)
    }
  });
});

/**
 * AI 出题（按知识点 + 难度 + 题型批量生成）。
 *
 * 与录题相反的方向：没有截图时，按条件让模型**生成**题目。
 * 生成的题**同样不自动入库** —— 返回题卡数组，老师挑选后保存。
 * 一期就在这里提供，是因为它是「智能题库」区别于普通题库的核心能力。
 */
router.post("/ocr/generate", auth, requireRole("admin", "teacher"), async (req, res) => {
  // ★ 顺序刻意：**先校验入参，再查模型是否可用**。
  //   反过来的话，「没配 Key」的 503 会把「你没填主题」这个更基础的错误掩盖掉，
  //   用户不知道自己到底缺什么（K-050：任何反馈都要指向可执行的下一步）。
  const count = Math.min(Math.max(Number(req.body?.count) || 3, 1), 10);
  const type = QUESTION_TYPES.includes(req.body?.type) ? req.body.type : "单选题";
  const difficulty = Math.min(Math.max(Number(req.body?.difficulty) || 3, 1), 5);

  let kpName = "";
  if (req.body?.kpId) {
    const row = db.prepare("SELECT name FROM knowledge_points WHERE id = ?").get(Number(req.body.kpId));
    if (!row) {
      return res.status(400).json({ success: false, message: "所选知识点不存在，请重新选择" });
    }
    kpName = row.name;
  }
  const topic = String(req.body?.topic || kpName || "").trim();
  if (!topic) {
    return res.status(400).json({ success: false, message: "请填写题目主题或选择知识点" });
  }

  const instruction = `你是中学${process.env.SCHOOL_SUBJECT || "数学"}教辅出题老师。请围绕「${topic}」出${count} 道${type}，难度等级 ${difficulty}（1最易、5最难）。

只输出一个 JSON 数组，**不要任何解释文字、不要 markdown 围栏**。数组每个元素结构：
{
  "type": "${type}",
  "stem": "题干（**保留 LaTeX 公式**，用 $...$ 包裹）",
  "options": ${type === "单选题" || type === "多选题" ? '"A项", "B项", "C项", "D项"' : "[]"},
  "answer": "答案",
  "analysis": "解析（讲清为什么，给出关键步骤）",
  "difficulty": ${difficulty},
  "knowledgePoints": ["${topic}"]
}

注意：JSON 里的 LaTeX 反斜杠必须转义（\\frac 要写成 \\\\frac 这样的双反斜杠形式在 JSON 字符串中）。
题目要**原创**、表述准确、不超纲；同一知识点下${count} 道题要有区分度（考不同的角度或变式）。`;

  // 入参已全部校验通过 → 现在才检查模型可用性
  // ★ 顺序：**先校验入参，再查依赖**（同 recognize，理由见该处注释）
  // ★ 学科必填（迁移 028）—— 出题也要知道题目归属哪个学科
  const genCourseId = Number(req.body?.course_id);
  if (!Number.isInteger(genCourseId) || genCourseId <= 0) {
    return res.status(400).json({ success: false, message: "请先选择学科再出题" });
  }
  if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(genCourseId)) {
    return res.status(400).json({ success: false, message: "所选学科不存在" });
  }

  if (!llm.isConfigured()) {
    return res.status(503).json({
      success: false,
      message: "尚未配置大模型 Key，无法生成题目。请到「AI 配置中心」填写后再试"
    });
  }

  let llmResult;
  try {
    llmResult = await llm.chat(
      [
        { role: "system", content: instruction },
        { role: "user", content: `请出 ${count} 道题，主题「${topic}」。` }
      ],
      { temperature: 0.8, maxTokens: 6000, timeoutMs: 90_000 }
    );
  } catch (err) {
    const reasons = {
      LLM_NOT_CONFIGURED: "尚未配置大模型 Key",
      LLM_TIMEOUT: "生成超时（90 秒），可减少数量后重试",
      LLM_EMPTY: "模型返回内容为空"
    };
    return res.status(502).json({
      success: false,
      message: reasons[err.code] || `生成失败：${err.message}`
    });
  }

  // 数组容错：复用 parseModelJson 的扫描思路，但这里要解数组
  let cards = [];
  try {
    cards = parseJsonArray(llmResult.text);
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: `生成结果无法处理：${err.message}`,
      hint: "可以重试，或减少一次出题的数量"
    });
  }

  // ★ 与「截图识别」路径**同一套**字段后处理（2026-10-07 补）：
  //   原来这里直接把模型解析结果丢给前端，导致两边字段结构不一致 ——
  //   最要命的是出题结果只有 `knowledgePoints`（名称），没有 `kpIds`，
  //   前端保存时无法写 kp_ids，AI 建议的知识点被整条丢弃。
  //   现在两条路径的题卡结构完全一致，前端可用同一段保存逻辑。
  const beforeCount = cards.length;
  cards = cards
    .map((c) => {
      const options = Array.isArray(c?.options)
        ? c.options.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 12)
        : [];
      const diff = Number(c?.difficulty);
      return {
        type: normalizeType(c?.type, options),
        stem: String(c?.stem ?? "").trim(),
        options,
        answer: normalizeAnswer(c?.answer),
        analysis: String(c?.analysis ?? "").trim(),
        difficulty: Number.isInteger(diff) && diff >= 1 && diff <= 5 ? diff : Number(req.body?.difficulty) || 3,
        // 知识点名称 → id（限定本学科内；与截图识别路径共用同一份反查函数）
        kpIds: resolveKpNamesToIds(c?.knowledgePoints, genCourseId),
        // 保留名称供前端展示"建议挂哪些知识点"（即使一个都没匹配上）
        knowledgePoints: Array.isArray(c?.knowledgePoints) ? c.knowledgePoints : []
      };
    })
    .filter((c) => c.stem);   // 过滤掉模型偶尔吐出的空题干项

  if (!cards.length) {
    return res.status(422).json({
      success: false,
      message: beforeCount
        ? "模型生成的题目都缺少题干，无法使用，请换个主题重试"
        : "模型没有生成任何题目，请换个主题重试"
    });
  }

  audit(req.user, "AI生成题目", `主题「${topic}」生成 ${cards.length} 道`);

  res.json({
    success: true,
    data: {
      cards,
      model: llmResult.model,
      cost: llmResult.cost ?? null,
      raw: String(llmResult.text).slice(0, 4000)
    }
  });
});

module.exports = router;