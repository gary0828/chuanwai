// 智能题库系统 · 一期：题目资产 + 检索 + 查重 + Excel 导入导出
//
// 定位（2026-10-07）：这是《智能题库管理系统·完整设计》四期建设的**地基**。
//   一期只做「题目能录进来、能查到、能查重、能导出」；
//   组卷（papers）→ 作答（attempts）→ 学情反哺（question_kp_stats）分别落在二/ 三/ 四期，
//   本文件为此预留字段但不提前实现逻辑（避免半迁移）。
//
// 权限模型（用户 2026-10-07 拍板）：
//   · **全校区共享** —— 任何老师都能看到并使用全部题目（题库的价值就在于共享）；
//   · **teacher 只能改/删自己录入的题**（created_by 过滤），admin 全量。
//   → 这与项目既有「teacher 仅本班」的模型**刻意不同**：题库不是班级资产，是校区资产。
//     之所以敢共享，是因为题库域**不含任何学员数据、不含金额与家长信息**
//     （出网白名单见 utils/redact.js，AI 录题时只发题干文本）。
//
// 凭证（middleware/auth.js）：本路由同时接受两种 token
//   · 教务系统正式登录 token（老师从教务端进入时用）
//   · qb_agent 类型凭证（题库前端免登进入后用，仅放行 /api/qbank）
// 两者都过auth 中间件，但**权限校验在本文件内部逐端点做**（不依赖路径前缀）。
const express = require("express");
const path = require("path");
const XLSX = require("xlsx");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { isBlank, parseText, parseNumber, isConstraintError, constraintMessage } =
  require("../utils/validate");
const dedupe = require("../utils/qbank-dedupe");
// 配图上传的判型与落盘走**公共实现**（与「员工头像」「站点 Logo」共用同一份）。
// ★ 不自写一套 —— utils/image.js 的注释已固化这条原则：
//   「判型与落盘逻辑如果各写一份，将来改允许的格式或大小必然只改一处、另一处漂移」
//   （与 413 事故同源：三份 nginx 只改了一份）。
const { MAX_UPLOAD_BYTES, saveImage } = require("../utils/image");

// ── 校验取值包装（2026-10-07 加）────────────────────────────────────
// ★为什么需要这两个：utils/validate.js 的 parseText / parseNumber 返回的是
//   ** `{ ok, value }` 对象**，不是裸值。本文件最初直接把返回值当字符串绑进
//   SQL，于是node:sqlite 抛 `Provided value cannot be bound to SQLite parameter 2`
//   —— **接口 500，但错误信息完全指不到真因**（看起来像SQL 问题，实为类型契约用错）。
//
//   项目既有写法是「先判 ok 再取 value」（见 routes/exams.js），这里包一层，
//   让 SQL 拼接处保持 `text("答案")` 这样的干净表达式。
//   ⚠ `text()` 遇校验失败返回 Error 对象 → 后续 SQL 必然再次失败，
//     所以 POST/PUT 入口必须**先 text() 一次做校验**，通过后才拿 .value。
function text(value, opts) {
  const r = parseText(value, opts);
  return r.ok ? r.value : new Error(r.message);
}
function num(value, opts) {
  const r = parseNumber(value, opts);
  return r.ok ? r.value : new Error(r.message);
}
const { audit } = require("../utils/audit");

const router = express.Router();

const QUESTION_TYPES = ["单选题", "多选题", "填空题", "判断题", "解答题", "简答题"];
const SOURCES = ["自编", "AI 原创", "教材", "授权题库"];
const STATUSES = ["草稿", "待审", "已启用", "已归档"];

/** 转义 LIKE 通配符 —— 否则用户搜「100%」会变成匹配任意（实测 FTS5 弃用后走 LIKE） */
function escapeLike(s) {
  return String(s ?? "").replace(/[%_]/g, (m) => `\\${m}`);
}

/**
 * 把「DB 里的 JSON 字符串」与「请求里的数组」统一成**数组**（并校验选择题至少 2 项）。
 *
 * @param {string} stored DB 里的 options（JSON 字符串，如 '["甲","乙"]'）
 * @param {any} incoming 请求体里的 options（数组，或 undefined 表示未传）
 * @param {string} type 生效题型
 * @returns {string[]} 规范化后的选项数组（已剔除空项、限长 12）
 * @throws 若选择题不足 2 项
 */
function normalizeOptions(stored, incoming, type) {
  let list = [];
  if (Array.isArray(incoming)) {
    list = incoming;
  } else {
    // 未传 → 用库里的存量值解析（**必须能容忍已损坏的历史数据**）
    try {
      const parsed = typeof stored === "string" ? JSON.parse(stored || "[]") : stored;
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = [];
    }
  }
  const cleaned = list.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 12);
  if ((type === "单选题" || type === "多选题") && cleaned.length < 2) {
    throw new Error("选择题至少需要 2 个选项");
  }
  return cleaned;
}

/**
 * 取一个用于 LIKE 粗筛的「原文探针」。
 *
 * 要点：
 *  1. **必须来自原始题干**（不能来自 normalizeStem）—— 否则探针不是原始列的子串；
 *  2. 取前若干字符后，**回退到最后一个非标点位置**，避免探针正好切在标点前
 *     导致「差一个标点」的两题探针不同（L1 已覆盖完全重复，L2 要处理的是「差几个字」）；
 *  3. 太短（< 3 字）的题干不做粗筛 —— 那样等于全表扫，直接跳过更省。
 * @returns {string} 探针；空串表示「太短，不做 L2 粗筛」
 */
function rawProbe(stem, len = 8) {
  const raw = String(stem || "").trim();
  if (raw.length < 3) return "";
  let cut = Math.min(len, raw.length);
  // 回退到最后一个「实义字符」上（跳过空白与标点），保证探针不以标点收尾
  while (cut > 1 && /[\s，。；：？！（）【】、,.;:?!()\[\]"'""''~—\-]/.test(raw[cut - 1])) {
    cut -= 1;
  }
  return raw.slice(0, cut);
}

/**
 * 权限判定：admin 全量；teacher 只能改/删**自己录入的**题。
 * @returns {{ok: boolean, reason?: string}}
 */
function canMutate(req, row) {
  // ★ 返回值带 status —— 「不存在」是 404、「无权限」是 403，两者语义完全不同。
  //   之前一律返回 403，导致「重复删除」被报成「没权限删」，
  //   用户会以为是自己权限有问题，实际是题早就删了（实测发现 2026-10-07）。
  if (!row) return { ok: false, status: 404, reason: "题目不存在或已被删除" };
  if (req.user.role === "admin") return { ok: true };
  if (Number(row.created_by) === Number(req.user.id)) return { ok: true };
  return {
    ok: false,
    status: 403,
    reason: "这道题是其他老师录入的，只能由他自己修改；如需调整请联系管理员"
  };
}

/**
 * 题库质量分（0–1）= **录入完整度**。
 *
 * 口径：只算三个"可选"维度，各占 1/3 —— 有解析 / 有知识点 / 有解题方法。
 *
 * ★ 为什么不把「难度」和「来源」算进去：
 *   这两列是表约束保证的（`difficulty NOT NULL DEFAULT 3`、`source` 必填受限枚举），
 *   任何一行都满足 → 计入后最低分变成 0.4，老师会困惑"我什么都没填怎么有 40 分"，
 *   且真实区分度只剩 0.4~1.0 三段。剔除后 0 = 三项全空、1 = 三项全填，一目了然。
 * ★ 为什么不把「配图」算进去：只有几何/函数图像类题目需要图，它是"按需"而非"应填"。
 *
 * ★ 与迁移 027 的回填 SQL 口径必须**逐字一致**（改这里要同步改那里）。
 * ★ 四期扩展位：真正的"质量"要看学生作答正确率（correct_rate），
 *   那时本函数可升级为「完整度 × 实测表现」的复合分。
 */
function computeQualityScore({ analysis, kpIds, solveMethod }) {
  let score = 0;
  if (String(analysis || "").trim() !== "") score += 1 / 3;
  if (Array.isArray(kpIds) && kpIds.length > 0) score += 1 / 3;
  if (String(solveMethod || "").trim() !== "") score += 1 / 3;
  // 保留两位小数，避免 0.3333333333333333 这种浮点噪声进库
  return Math.round(score * 100) / 100;
}

/**
 * 校验知识点 id 是否**真实存在**。
 *
 * ★ 为什么必须校验（2026-10-07 全流程测试发现）：
 *   原来只过滤「是正整数」，所以 `kp_ids:[99999]` 会被原样存进库。
 *   后果：这道题**永远不出现在任何知识点视角里**（json_each 反查找不到 99999），
 *   老师会以为题丢了；且库里躺着指向不存在实体的脏数据。
 *   对比：`chapter_id` 有真外键约束，不存在会直接 400 —— 两处口径本该一致。
 *
 * @param {number[]} ids 候选 id
 * @returns {number[]} 真实存在的 id（去重、保序）
 */
function filterExistingKpIds(ids) {
  const nums = [
    ...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))
  ];
  if (!nums.length) return [];
  const rows = db
    .prepare(`SELECT id FROM knowledge_points WHERE id IN (${nums.map(() => "?").join(",")})`)
    .all(...nums);
  const exists = new Set(rows.map((r) => r.id));
  return nums.filter((id) => exists.has(id));
}

/** 读取一行题目（含 created_by，用于权限判定） */
function loadQuestion(id) {
  return db.prepare("SELECT * FROM questions WHERE id = ? AND deleted_at IS NULL").get(Number(id));
}

/**
 * 题库概览：一次性给出首页需要的各类计数与维度分布。
 * 参考系统的「数据统计」页就是这套结构（题库题目数/ 试卷数/ 已入卷数 / 题型分布）。
 */
router.get("/overview", auth, (req, res) => {
  // ★ 全部计数按学科过滤 —— 否则切到「初中物理」会看到数学的题量
  const cf = courseFilter(req.query);
  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql}`).get(...cf.params).c
  );
  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql} GROUP BY status`)
    .all(...cf.params);
  const byType = db
    .prepare(`SELECT type, COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql} GROUP BY type ORDER BY c DESC`)
    .all(...cf.params);
  const bySource = db
    .prepare(`SELECT source, COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql} GROUP BY source ORDER BY c DESC`)
    .all(...cf.params);
  const byDifficulty = db
    .prepare(`SELECT difficulty, COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql} GROUP BY difficulty ORDER BY difficulty`)
    .all(...cf.params);
  const withKp = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql} AND EXISTS (SELECT 1 FROM json_each(questions.kp_ids))`
      )
      .get(...cf.params).c
  );
  const aiAssisted = Number(
    db.prepare(
      `SELECT COUNT(*) AS c FROM questions WHERE deleted_at IS NULL${cf.sql} AND parse_status != 'manual'`
    ).get(...cf.params).c
  );
  res.json({
    success: true,
    data: {
      total,
      // 未挂知识点的通用题 —— 一期刻意允许 NULL，这里给老师一个提示口径
      withoutKp: total - withKp,
      aiAssisted,
      byStatus,
      byType,
      bySource,
      byDifficulty
    }
  });
});

/**
 * 学科过滤片段（**可选**）。
 *
 * ★ 抽成函数的原因：多学科上线后，**每一处读 questions 的查询都要按学科过滤**
 *   （列表/导出/概览/facets/回收站/查重…），散着写必然漏 —— 与软删那次同类。
 *
 * ★ 不传 `course_id` 时返回**空条件 = 查全部学科**：
 *   这是刻意的 —— 管理员可能需要跨学科查看；而前端切换器总会带上学科学科，
 *   所以正常使用不会看到混在一起的数据。比"没传就报错"稳（前端漏传不会白屏）。
 *
 * @returns {{ sql: string, params: number[] }} 形如 ` AND course_id = ?`
 */
function courseFilter(query) {
  const id = Number(query?.course_id);
  if (Number.isInteger(id) && id > 0) {
    return { sql: " AND course_id = ?", params: [id] };
  }
  return { sql: "", params: [] };
}

/**
 * 构造题目筛选条件 —— **列表与导出共用同一份**。
 *
 * ★★ 为什么必须共用（2026-10-07 修的真实缺陷）：
 *   一期导出只认 5 个维度、列表认 10 个，且前端连 difficulty 都没传。
 *   实测：造 2 道题（1 挂知识点1+难度1、1 不挂+难度5），
 *   `export?kp_id=1` 返回 **2 行**（应为 1 行）—— 导出的是整个题库。
 *   老师筛「知识点=三角函数」后导出，拿到全部题，**不报错**（K-050 静默给错数据）。
 *
 *   ★ 根因不是"漏传了参数"，而是**两处各写一遍筛选条件**。
 *     所以修法不是把字段补齐到两边，而是让它们**只有一份** ——
 *     下次加筛选维度时，列表和导出自动都有。
 *
 * @param {object} query req.query
 * @returns {{ where: string, params: any[] }} 可直接拼进 `WHERE ${where}`
 */
function buildQuestionFilter(query = {}) {
  const {
    keyword, type, difficulty, source, status,
    kp_id, chapter_id, include_sub_folders, solve_method, exam_year, custom_tag,
    course_id
  } = query;

  const conds = [];
  const params = [];

  // 关键词：题干 + 解析（★ 用 LIKE 而非 FTS5 —— 实测 unicode61 与 trigram 在
  // node:sqlite 下都搜不到中文，已在 026 迁移注释里固化这个结论）
  if (!isBlank(keyword)) {
    const like = `%${escapeLike(String(keyword).trim())}%`;
    conds.push("(q.stem LIKE ? ESCAPE '\\' OR q.analysis LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (!isBlank(type)) { conds.push("q.type = ?"); params.push(String(type)); }
  if (!isBlank(difficulty)) { conds.push("q.difficulty = ?"); params.push(Number(difficulty)); }
  if (!isBlank(source)) { conds.push("q.source = ?"); params.push(String(source)); }
  if (!isBlank(status)) { conds.push("q.status = ?"); params.push(String(status)); }
  if (!isBlank(exam_year)) { conds.push("q.exam_year = ?"); params.push(Number(exam_year)); }
  if (!isBlank(solve_method)) { conds.push("q.solve_method = ?"); params.push(String(solve_method)); }
  // 知识点筛选：kp_ids 是 JSON 数组，用 json_each 反查（v26 迁移注释已说明选型理由）
  if (!isBlank(kp_id)) {
    conds.push("EXISTS (SELECT 1 FROM json_each(q.kp_ids) WHERE json_each.value = ?)");
    params.push(Number(kp_id));
  }
  // 章节筛选：include_sub_folders=1 时把子树一并纳入
  // （参考系统有同名参数 includeSubFolders —— 树形筛选必须支持，否则筛「三角函数」查不到下级）
  if (!isBlank(chapter_id)) {
    if (String(include_sub_folders) === "1" || String(include_sub_folders) === "true") {
      conds.push(
        `q.chapter_id IN (
           WITH RECURSIVE sub(id) AS (
             SELECT id FROM question_chapters WHERE id = ?
             UNION ALL
             SELECT c.id FROM question_chapters c JOIN sub s ON c.parent_id = s.id
           ) SELECT id FROM sub
         )`
      );
    } else {
      conds.push("q.chapter_id = ?");
    }
    params.push(Number(chapter_id));
  }
  if (!isBlank(custom_tag)) {
    conds.push("EXISTS (SELECT 1 FROM json_each(q.custom_tags) WHERE json_each.value = ?)");
    params.push(String(custom_tag));
  }

  // ★ 学科过滤（迁移 028）：切到「初中物理」就不该看到数学题。
  //   放在共享函数里 —— 列表与导出同时生效，不会像一期导出那样各写一遍而漏掉。
  if (!isBlank(course_id)) {
    conds.push("q.course_id = ?");
    params.push(Number(course_id));
  }

  // ★ 软删过滤：**所有**题目查询都必须带（回收站，迁移 027）。
  //   放在这里而不是各调用点 —— 少一处遗漏就是数据泄漏。
  conds.push("q.deleted_at IS NULL");

  return { where: conds.join(" AND "), params };
}

/** 列表排序白名单（**不接受**用户传任意列名，防注入） */
const QUESTION_SORTS = {
  updated: "q.updated_at DESC, q.id DESC",   // 默认：刚录的/刚改的在最上面
  created: "q.created_at DESC, q.id DESC",
  difficulty_asc: "q.difficulty ASC, q.id DESC",
  difficulty_desc: "q.difficulty DESC, q.id DESC",
  quality_asc: "COALESCE(q.quality_score, 0) ASC, q.id DESC",   // 先看"填得不全"的
  quality_desc: "COALESCE(q.quality_score, 0) DESC, q.id DESC",
  type: "q.type ASC, q.id DESC",
  year_desc: "q.exam_year DESC, q.id DESC"
};

/**
 * 题目列表：分页 + 多维筛选。
 *筛选维度覆盖三视角（知识点/章节/解题方法）+ 题型/难度/来源/状态/年份 + 关键词。
 */
router.get("/questions", auth, (req, res) => {
  // ★ 筛选条件来自**共享**函数 —— 与导出用同一份，从根上消除
  //   「列表筛了、导出不认」这类静默不一致（见 buildQuestionFilter 注释）。
  const { where, params } = buildQuestionFilter(req.query);

  const orderBy = QUESTION_SORTS[String(req.query?.sort)] || QUESTION_SORTS.updated;

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM questions q WHERE ${where}`).get(...params).c
  );

  // 分页
  const size = Math.min(Math.max(Number(req.query?.pageSize) || 20, 1), 100);
  const pageNo = Math.max(Number(req.query?.page) || 1, 1);
  const offset = (pageNo - 1) * size;

  const list = db
    .prepare(
      `
      SELECT q.id, q.type, q.stem, q.options, q.answer, q.analysis,
             q.difficulty, q.kp_ids, q.chapter_id, q.solve_method, q.source,
             q.custom_tags, q.exam_year, q.region, q.status,
             q.parse_status, q.ocr_confidence, q.quality_score,
             q.use_count, q.correct_rate, q.created_by, q.created_at, q.updated_at,
             -- ★ course_id 必须返回（迁移 028）：前端要它来标记题目归属、
             --   也用于验证"导入到某学科的题确实落在该学科"
             q.course_id,
             u.name AS created_by_name
      FROM questions q
      LEFT JOIN users u ON u.id = q.created_by
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `
    )
    .all(...params, size, offset);

  res.json({ success: true, data: { list, total, page: pageNo, pageSize: size } });
});

// ────────────────────────────────────────────────────────────────
// ★ 路由顺序敏感：下面两个**静态路径**端点必须注册在 `/questions/:id` 之前。
//   否则 Express 会把 `export` / `template.xlsx` 当成 :id 匹配掉 → 404
//   （2026-10-07 实测踩到：两个下载接口全 404，错误信息毫无指向性）
/** Excel 模板下载 */
router.get("/questions/template.xlsx", auth, (_req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    [
      "题型",
      "题干",
      "选项A",
      "选项B",
      "选项C",
      "选项D",
      "答案",
      "解析",
      "难度(1-5)",
      "知识点编码(逗号分隔)",
      "章节名",
      "解题方法",
      "来源(自编/AI 原创/教材/授权题库)",
      "年份",
      "地区",
      "标签(逗号分隔)"
    ],
    // 一行示例，避免老师对着空表不知道每列填什么
    [
      "单选题",
      "已知 $\\vec{a}=(-4,1)$，则与 $\\vec{a}$ 共线的单位向量的坐标为____",
      "(1,4)/5",
      "(-1,-4)/5",
      "(4,1)/5",
      "(-4,1)/5",
      "A",
      "与向量 a 共线即方向相同或相反，归一化后取首项。",
      3,
      "K-MATH-VEC",
      "平面向量及其应用",
      "向量归一化",
      "自编",
      2024,
      "北京",
      "期末重点,易错"
    ]
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "题目导入模板");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''question-import-template.xlsx");
  res.end(buf);
});


/**
 * Excel 导出（**按当前筛选条件**导出全部，不只当前页）。
 *
 * ★★ 筛选条件走 `buildQuestionFilter()` —— 与列表**同一份**。
 *   一期这里曾自己写一遍、只认 5 个维度，导致"筛知识点后导出的是全部题"，
 *   实测确认后重构为共享函数（见 buildQuestionFilter 注释）。
 */
router.get("/questions/export", auth, (req, res) => {
  const { where, params } = buildQuestionFilter(req.query);

  const rows = db
    .prepare(
      `SELECT q.*, u.name AS created_by_name FROM questions q
       LEFT JOIN users u ON u.id = q.created_by
       WHERE ${where} ORDER BY q.id ASC LIMIT 5000`
    )
    .all(...params);

  const kpRows = db.prepare("SELECT id, code FROM knowledge_points").all();
  const kpNameById = new Map(kpRows.map((r) => [r.id, r.code]));
  const chapterById = new Map(
    db.prepare("SELECT id, name FROM question_chapters").all().map((r) => [r.id, r.name])
  );
  // id → 学科名（导出列里显示中文名，不是 id）
  const courseById = new Map(
    db.prepare("SELECT id, name FROM courses").all().map((r) => [r.id, r.name])
  );

  const aoa = [
    // ★ 加「学科」列（迁移 028）：管理员不传 course_id 导出时会跨学科，
    //   没有这一列就分不清哪道题属于哪科。
    ["学科","题型","题干","选项A","选项B","选项C","选项D","答案","解析","难度","知识点编码","章节名","解题方法","来源","年份","地区","标签","录入人","状态"]
  ];
  for (const q of rows) {
    const opts = typeof q.options === "string" ? JSON.parse(q.options || "[]") : q.options || [];
    const kpIds = typeof q.kp_ids === "string" ? JSON.parse(q.kp_ids || "[]") : [];
    const tags = typeof q.custom_tags === "string" ? JSON.parse(q.custom_tags || "[]") : [];
    aoa.push([
      courseById.get(q.course_id) ?? "（未归属）",
      q.type,
      q.stem,
      opts[0] || "", opts[1] || "", opts[2] || "", opts[3] || "",
      q.answer,
      q.analysis,
      q.difficulty,
      kpIds.map((id) => kpNameById.get(id) ?? id).join(","),
      chapterById.get(q.chapter_id) ?? "",
      q.solve_method,
      q.source,
      q.exam_year ?? "",
      q.region,
      tags.join(","),
      q.created_by_name ?? "",
      q.status
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "题库");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  // ★ 文件名带时间戳（2026-10-07）：原来写死 questions.xlsx，
  //   一天内多次导出会互相覆盖，且从文件名看不出是什么时候导的。
  const stamp = new Date()
    .toLocaleString("sv-SE", { hour12: false })   // sv-SE 恰好是 YYYY-MM-DD HH:mm:ss
    .replace(/[-: ]/g, "")
    .slice(0, 14);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''questions-${stamp}.xlsx`
  );
  res.end(buf);
});

/**
 * 回收站列表（软删的题）。
 *
 * ★★ 路由顺序敏感：本端点必须注册在 `/questions/:id` **之前**，
 *   否则 Express 会把 `recycle` 当成 :id 匹配掉 → 404。
 *   同类的还有 template.xlsx / export（一期已踩过这个坑）。
 */
router.get("/questions/recycle", auth, (req, res) => {
  const keyword = String(req.query?.keyword || "").trim();
  const conds = ["q.deleted_at IS NOT NULL"];
  const params = [];
  // ★ 回收站也按学科隔离（迁移 028）—— 否则在物理学科下会看到数学的回收站题
  const cid = Number(req.query?.course_id);
  if (Number.isInteger(cid) && cid > 0) {
    conds.push("q.course_id = ?");
    params.push(cid);
  }
  if (keyword) {
    const like = `%${escapeLike(keyword)}%`;
    conds.push("(q.stem LIKE ? ESCAPE '\\' OR q.analysis LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const where = conds.join(" AND ");
  const size = Math.min(Math.max(Number(req.query?.pageSize) || 20, 1), 100);
  const pageNo = Math.max(Number(req.query?.page) || 1, 1);

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM questions q WHERE ${where}`).get(...params).c
  );
  const list = db
    .prepare(
      `SELECT q.id, q.type, q.stem, q.options, q.answer, q.analysis, q.difficulty,
              q.kp_ids, q.source, q.status, q.deleted_at,
              q.created_by, q.updated_at,
              u.name AS created_by_name,
              d.name AS deleted_by_name
         FROM questions q
         LEFT JOIN users u ON u.id = q.created_by
         LEFT JOIN users d ON d.id = q.deleted_by
        WHERE ${where}
        ORDER BY q.deleted_at DESC, q.id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, size, (pageNo - 1) * size);

  res.json({ success: true, data: { list, total, page: pageNo, pageSize: size } });
});

/**
 * 删除配图文件（**只在彻底删除时调用**）。
 *
 * ★ 为什么不放在软删里：软删后还能恢复，恢复回来的题必须还有图。
 *   这个原则踩过一次 —— 一期硬删时顺手删文件是对的，但改软删后照搬就会丢图。
 * 失败只 warn 不阻断：文件删不掉不该让用户删不掉题。
 */
function purgeQuestionFiles(figurePath) {
  if (!figurePath) return;
  try {
    const fs = require("fs");
    const path = require("path");
    // ★ 两层 `..`：本文件在 `<root>/server/src/routes/`，要到 `<root>/server/data/`
    //   （一层 .. 会落到 `<root>/server/src/data/` —— 一期这里就写错了，
    //    因为当时没测过配图所以没暴露。对齐 auth.js / site-info.js 的写法。）
    const assetsDir = path.join(__dirname, "..", "..", "data", "assets");

    // ★★ 必须同时剥掉 `/assets/` 前缀（2026-10-07 实测踩到）：
    //   `figure_path` 存的是**对外 URL 路径** `/assets/questions/xxx.png`，
    //   而 `path.join(assetsDir, ...)` 要的是**相对 assets 的路径**。
    //   只剥开头斜杠会拼成 `.../data/assets/assets/questions/xxx.png`（多一层 assets）
    //   → 文件永远找不到 → **换图/删题时旧图静默不删**，磁盘慢慢堆孤儿文件。
    //   这类 bug 不报错、只表现为"磁盘越来越多"，很难发现。
    const rel = String(figurePath)
      .replace(/^\/+/, "")
      .replace(/^assets\//, "");          // 剥掉对外前缀
    if (!rel || rel.includes("..")) return;  // 防路径穿越

    const abs = path.join(assetsDir, rel);
    // 路径越界防护：只允许删 assets 目录内的文件
    if (abs.startsWith(assetsDir) && fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  } catch (err) {
    console.warn("[qbank] 配图文件清理失败（不影响删题）:", err.message);
  }
}

/** 单题详情 */
router.get("/questions/:id", auth, (req, res) => {
  const row = loadQuestion(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: "题目不存在或已被删除" });
  res.json({ success: true, data: row });
});

/**
 * 题目列表页的三个筛选侧栏：知识点树 / 章节树 / 解题方法枚举 + 标签枚举。
 * 一次取全，避免前端串行发四个请求。
 */
router.get("/facets", auth, (req, res) => {
  // ★★ 五个维度**全部**按学科过滤（迁移 028）：
  //   否则切到「初中物理」时，侧栏会列出数学的知识点与章节 ——
  //   老师点了数学知识点，结果查出 0 道题，会以为题库坏了。
  //   ★ 知识点与章节有各自的 course_id 列；方法与标签是 questions 的派生值，
  //     所以走 questions 的 course_id。
  const cid = Number(req.query?.course_id);
  const hasCourse = Number.isInteger(cid) && cid > 0;

  const knowledge = hasCourse
    ? db
        .prepare(
          `SELECT id, parent_id, name, difficulty FROM knowledge_points
           WHERE is_active = 1 AND course_id = ? ORDER BY unit_no, seq, id`
        )
        .all(cid)
    : db
        .prepare(
          `SELECT id, parent_id, name, difficulty FROM knowledge_points
           WHERE is_active = 1 ORDER BY unit_no, seq, id`
        )
        .all();

  const chapters = hasCourse
    ? db
        .prepare("SELECT id, parent_id, name FROM question_chapters WHERE course_id = ? ORDER BY sort, id")
        .all(cid)
    : db.prepare("SELECT id, parent_id, name FROM question_chapters ORDER BY sort, id").all();

  // 题库里**实际用过**的解题方法与标签（而不是预先枚举一批空选项给用户看）
  const cf = courseFilter(req.query);
  const methods = db
    .prepare(
      `SELECT solve_method AS name, COUNT(*) AS c FROM questions
       WHERE deleted_at IS NULL${cf.sql} AND TRIM(solve_method) != ''
       GROUP BY solve_method ORDER BY c DESC`
    )
    .all(...cf.params);
  const tags = db
    .prepare(
      `SELECT DISTINCT json_each.value AS name FROM questions, json_each(custom_tags)
       WHERE questions.deleted_at IS NULL${hasCourse ? " AND questions.course_id = ?" : ""}
         AND TRIM(COALESCE(json_each.value,'')) != ''
       ORDER BY name`
    )
    .all(...(hasCourse ? [cid] : []));
  const years = db
    .prepare(
      `SELECT DISTINCT exam_year AS year FROM questions
       WHERE deleted_at IS NULL${cf.sql} AND exam_year IS NOT NULL ORDER BY exam_year DESC`
    )
    .all(...cf.params);

  res.json({ success: true, data: { knowledge, chapters, methods, tags, years } });
});

/**
 * 学科清单（供题库前端的学科切换器用）。
 *
 * ★ 只返回**有题库数据或至少已建章节**的学科吗？不 —— 返回全部：
 *   老师切到「初中物理」时即便一道题都没有，也该能看到该学科（否则无法开始录题）。
 * ★ 附带每学科题量，让切换器上能直接显示「初中数学 (12)」，
 *   老师一眼知道哪个学科有内容（也便于发现"建了却没在用"的学科）。
 */
router.get("/subjects", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.code, c.name,
              (SELECT COUNT(*) FROM questions q
                WHERE q.course_id = c.id AND q.deleted_at IS NULL) AS questionCount,
              (SELECT COUNT(*) FROM question_chapters ch WHERE ch.course_id = c.id) AS chapterCount
         FROM courses c
        ORDER BY c.id`
    )
    .all();
  res.json({ success: true, data: { list: rows } });
});

/**
 * 新建题目。
 *
 * body（JSON）：type / stem / options / answer / analysis / difficulty /
 *              kp_ids / chapter_id / solve_method / source(必填) / custom_tags /
 *              exam_year / region / status
 */
router.post("/questions", auth, requireRole("admin", "teacher"), (req, res, next) => {
  try {
    const stemRes = text(req.body?.stem, { field: "题干", max: 4000, required: true });
    if (stemRes instanceof Error) return res.status(400).json({ success: false, message: stemRes.message });
    const stem = stemRes;
    const type = QUESTION_TYPES.includes(req.body?.type) ? req.body.type : "单选题";
    const source = String(req.body?.source || "").trim();

    // ★ 学科必填（迁移 028）：题目必须归属某个学科，否则切到任何学科都看不到它
    //   （成了"幽灵题"）。刻意**不给默认值** —— 默认数学会让物理题静默记成数学题。
    const courseIdRaw = Number(req.body?.course_id);
    if (!Number.isInteger(courseIdRaw) || courseIdRaw <= 0) {
      return res.status(400).json({ success: false, message: "请选择所属学科" });
    }
    const courseRow = db.prepare("SELECT id FROM courses WHERE id = ?").get(courseIdRaw);
    if (!courseRow) {
      return res.status(400).json({ success: false, message: "所选学科不存在，请刷新后重试" });
    }
    const courseId = courseIdRaw;
    if (!SOURCES.includes(source)) {
      return res
        .status(400)
        .json({ success: false, message: `请选择题目来源（${SOURCES.join(" / ")}）` });
    }
    const diffRes = num(req.body?.difficulty ?? 3, { field: "难度", min: 1, max: 5, integer: true });
    if (diffRes instanceof Error) return res.status(400).json({ success: false, message: diffRes.message });
    const difficulty = diffRes;

    // 选项：走与 PUT 同一个 normalizeOptions，避免两套清洗逻辑漂移
    let options;
    try {
      options = normalizeOptions("[]", req.body?.options, type);
    } catch (optErr) {
      return res.status(400).json({ success: false, message: optErr.message });
    }
    // 非选择题不存选项（统一存"[]"，避免脏数据混进导出文件）
    if (type !== "单选题" && type !== "多选题") options = [];

    // 知识点多值：只保留正整数，去重
    const kpIds = filterExistingKpIds(req.body?.kp_ids);
    // 自定义标签：字符串数组，同样清洗
    const customTags = Array.isArray(req.body?.custom_tags)
      ? [...new Set(req.body.custom_tags.map((t) => String(t ?? "").trim()).filter(Boolean))].slice(0, 20)
      : [];

    const status = STATUSES.includes(req.body?.status) ? req.body.status : "草稿";
    const hash = dedupe.contentHash(stem);

    const info = db
      .prepare(
        `INSERT INTO questions
           (type, stem, options, answer, analysis, difficulty, kp_ids, chapter_id,
            solve_method, source, content_hash, custom_tags, exam_year, region, status,
            created_by, parse_status, quality_score, figure_path, course_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        type,
        stem,
        JSON.stringify(options),
        text(req.body?.answer, { field: "答案", max: 2000 }),
        text(req.body?.analysis, { field: "解析", max: 4000 }),
        difficulty,
        JSON.stringify(kpIds),
        isBlank(req.body?.chapter_id) ? null : Number(req.body.chapter_id),
        text(req.body?.solve_method, { field: "解题方法", max: 100 }),
        source,
        hash,
        JSON.stringify(customTags),
        isBlank(req.body?.exam_year) ? null : Number(req.body.exam_year),
        text(req.body?.region, { field: "地区", max: 50 }),
        status,
        req.user.id,
        // 手工录入的题parse_status 恒为 manual；AI 录入的题由 OCR 端点写入
        String(req.body?.parse_status || "manual").startsWith("manual") ? "manual" : "confirmed",
        // 质量分（录入完整度）。★ 用 req.body 原值算，与上面那几列同源，避免"存进去的和算分用的不一致"
        computeQualityScore({
          analysis: req.body?.analysis,
          kpIds,
          solveMethod: req.body?.solve_method
        }),
        // 配图：前端先传图拿到路径，随建题一起提交（可空）
        String(req.body?.figure_path || "").trim().slice(0, 300),
        courseId
      );

    audit(req.user, "新增题目", `题目#${info.lastInsertRowid} ${stem.slice(0, 30)}`);
    res.json({ success: true, data: { id: Number(info.lastInsertRowid), content_hash: hash } });
  } catch (err) {
    if (isConstraintError(err)) {
      return res.status(400).json({ success: false, message: constraintMessage(err) });
    }
    next(err);
  }
});

/** 修改题目（teacher 仅限自己录入的） */
router.put("/questions/:id", auth, requireRole("admin", "teacher"), (req, res, next) => {
  try {
    const row = loadQuestion(req.params.id);
    const allowed = canMutate(req, row);
    if (!allowed.ok) return res.status(allowed.status).json({ success: false, message: allowed.reason });

    const stemRes = isBlank(req.body?.stem) ? row.stem : text(req.body.stem, { field: "题干", max: 4000, required: true });
    if (stemRes instanceof Error) return res.status(400).json({ success: false, message: stemRes.message });
    const stem = stemRes;
    const source = SOURCES.includes(req.body?.source) ? req.body.source : row.source;

    // 学科：未传沿用原值；传了则校验存在（**允许改** —— 录错学科应当有救，
    // 否则只能删了重录，而删题会连配图一起进回收站流程）
    let courseNext = row.course_id;
    if (req.body?.course_id !== undefined) {
      const cid = Number(req.body.course_id);
      if (!Number.isInteger(cid) || cid <= 0) {
        return res.status(400).json({ success: false, message: "请选择所属学科" });
      }
      if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(cid)) {
        return res.status(400).json({ success: false, message: "所选学科不存在" });
      }
      courseNext = cid;
    }

    //★★ options 的规范化：DB 里存的是 **JSON 字符串**，而 req.body 里是**数组**。
    //   必须先统一成数组、再校验、最后一次性 stringify 回写。
    //
    //   踩过的坑（2026-10-07，P0 级数据损坏）：
    //     row.options 从 DB 读出来是字符串 '["甲","乙"]'，我直接 `JSON.stringify()` 写回
    //     → 变成 '"[\\"甲\\",\\"乙\\"]"'（**双重编码**）。
    //     后果：**每 PUT 一次就多包一层**，改两次后解析出来是['"甲"','"乙"']，
    //     选项文本被污染成带引号的残缺内容，且**不可逆**。
    //     触发链路：改难度 → options 被二次编码 → 下次改选项数 <2 → 400「至少2个选项」，
    //     而老师只是改了个难度，**报错信息完全指不到真因**。
    // ★ 生效题型必须在 options 规范化**之前**定下来（normalizeOptions 依赖它判断
    //   「选择题至少 2 项」），且下面的 UPDATE 还要用同一个值。
    const type = QUESTION_TYPES.includes(req.body?.type) ? req.body.type : row.type;

    let options;
    try {
      options = normalizeOptions(row.options, req.body?.options, type);
    } catch (optErr) {
      return res.status(400).json({ success: false, message: optErr.message });
    }

    const kpIds = req.body?.kp_ids === undefined
      ? JSON.parse(row.kp_ids || "[]")
      : filterExistingKpIds(req.body.kp_ids);
    const customTags = Array.isArray(req.body?.custom_tags)
      ? [...new Set(req.body.custom_tags.map((t) => String(t ?? "").trim()).filter(Boolean))].slice(0, 20)
      : JSON.parse(row.custom_tags || "[]");

    // 配图：算出新的值（未传则沿用），并在"确实换了图"时清理旧文件
    const figureNext = isBlank(req.body?.figure_path)
      ? row.figure_path
      : text(req.body.figure_path, { field: "配图路径", max: 300 });
    if (figureNext instanceof Error) {
      return res.status(400).json({ success: false, message: figureNext.message });
    }
    replaceFigure(row.figure_path, figureNext);

    db.prepare(
      `UPDATE questions SET
         type = ?, stem = ?, options = ?, answer = ?, analysis = ?, difficulty = ?,
         kp_ids = ?, chapter_id = ?, solve_method = ?, source = ?, content_hash = ?,
         custom_tags = ?, exam_year = ?, region = ?, status = ?,
         figure_path = ?, course_id = ?,
         quality_score = ?,
         updated_at = datetime('now','localtime'), updated_by = ?
       WHERE id = ?`
    ).run(
      type,
      stem,
      JSON.stringify(options),
      isBlank(req.body?.answer) ? row.answer : text(req.body.answer, { field: "答案", max: 2000 }),
      isBlank(req.body?.analysis) ? row.analysis : text(req.body.analysis, { field: "解析", max: 4000 }),
      num(req.body?.difficulty ?? row.difficulty, { field: "难度", min: 1, max: 5, integer: true }),
      JSON.stringify(kpIds),
      req.body?.chapter_id === undefined ? row.chapter_id : isBlank(req.body.chapter_id) ? null : Number(req.body.chapter_id),
      req.body?.solve_method === undefined ? row.solve_method : text(req.body.solve_method, { field: "解题方法", max: 100 }),
      source,
      dedupe.contentHash(stem),
      JSON.stringify(customTags),
      req.body?.exam_year === undefined ? row.exam_year : isBlank(req.body.exam_year) ? null : Number(req.body.exam_year),
      req.body?.region === undefined ? row.region : text(req.body.region, { field: "地区", max: 50 }),
      STATUSES.includes(req.body?.status) ? req.body.status : row.status,
      // 配图：未传沿用旧值；换了图则顺手删掉旧文件（不删会留下孤儿文件）
      figureNext,
      courseNext,
      // ★ 质量分要用**生效后**的值算（PUT 是部分更新：未传的字段沿用 row 的值）
      //   —— 用 req.body 原值算会把"没改解析"误判成"没有解析"，分数凭空掉一档。
      computeQualityScore({
        analysis: isBlank(req.body?.analysis) ? row.analysis : req.body.analysis,
        kpIds,
        solveMethod: req.body?.solve_method === undefined ? row.solve_method : req.body.solve_method
      }),
      req.user.id,
      row.id
    );

    audit(req.user, "修改题目", `题目#${row.id}`);
    res.json({ success: true, data: { id: row.id } });
  } catch (err) {
    if (isConstraintError(err)) {
      return res.status(400).json({ success: false, message: constraintMessage(err) });
    }
    next(err);
  }
});

/**
 * 删除题目 → **软删**（进回收站，teacher 仅限自己录入的）。
 *
 * ★ 改为软删（2026-10-07，迁移 027）：题库是长期积累的资产，硬删不可逆。
 *   ★★ 关键：**软删时**不碰配图文件** —— 恢复时还要用。
 *      文件清理由「彻底删除」负责（见 purgeQuestionFiles）。
 *      早期版本在硬删时顺手删文件，若照搬到这里，恢复回来的题会缺图。
 */
router.delete("/questions/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const row = loadQuestion(req.params.id);
  const allowed = canMutate(req, row);
  if (!allowed.ok) return res.status(allowed.status).json({ success: false, message: allowed.reason });

  db.prepare(
    "UPDATE questions SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE id = ?"
  ).run(req.user.id, row.id);
  audit(req.user, "删除题目（进回收站）", `题目#${row.id}`);
  res.json({
    success: true,
    data: { id: row.id, recycle: true, message: "已移入回收站，可在「回收站」里恢复" }
  });
});

/** 批量删除（只删自己有权的；teacher 传别人的 id 会被跳过并如实回报数量） */
router.post("/questions/batch-delete", auth, requireRole("admin", "teacher"), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "请先选择要删除的题目" });

  let deleted = 0;
  let skipped = 0;
  for (const id of ids) {
    const row = loadQuestion(id);
    if (!row) { skipped += 1; continue; }
    if (!canMutate(req, row).ok) { skipped += 1; continue; }
    db.prepare(
      "UPDATE questions SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE id = ?"
    ).run(req.user.id, id);
    deleted += 1;
  }
  // ★ 如实回报（K-050 静默即缺陷）：不能说「全部成功」却悄悄跳过别人的题
  res.json({
    success: true,
    data: { deleted, skipped, message: skipped > 0 ? `已移入回收站 ${deleted} 道，${skipped} 道因无权限或不存在被跳过` : `已移入回收站 ${deleted} 道题目，可在「回收站」恢复` }
  });
});

/**
 * 查重：录入前先问一下。
 *
 * body：{ stem, excludeId? }
 * 返回：{ exact: [...], similar: [{id, stem, similarity}] }
 *   · exact   —— L1 哈希命中（完全重复）
 *   · similar —— L2 Jaccard ≥ 阈值（疑似重复，含相似度）
 *   · aiHint  —— 占位：二期接入 L3 AI 语义判重时返回（见 qbank-dedupe 注释）
 */
router.post("/questions/check-duplicate", auth, (req, res) => {
  const stemRes = text(req.body?.stem, { field: "题干", max: 4000, required: true });
    if (stemRes instanceof Error) return res.status(400).json({ success: false, message: stemRes.message });
    const stem = stemRes;
  const excludeId = Number(req.body?.excludeId) || 0;

  // ★★ 查重**限定在同一学科内**（迁移 028）：
  //   跨学科判重会误导 —— 物理题与数学题撞了相似度，老师看到"题库里已有"，
  //   点进去发现是另一科的题，反而要怀疑系统。
  //   跨学科"重复"本质是归类问题，不是重复录入，不该在这里提示。
  const dupCourseId = Number(req.body?.course_id) || 0;
  const dupCourseClause = dupCourseId > 0 ? " AND course_id = ?" : "";
  const dupCourseParams = dupCourseId > 0 ? [dupCourseId] : [];

  // L1：命中哈希直接算精确重复（走索引，零成本）
  const exact = db
    .prepare(
      `SELECT id, stem, created_by FROM questions
       WHERE deleted_at IS NULL AND content_hash = ? AND id != ? AND status != '已归档'${dupCourseClause}
       LIMIT 20`
    )
    .all(dedupe.contentHash(stem), excludeId, ...dupCourseParams);

  // L2：哈希不同但内容像 —— 走 LIKE 粗筛出候选，再算 Jaccard。
  // ⚠ 不能对全表算 Jaccard（万题级每次全扫太慢），先用题干前段做粗筛。
  //
  // ★★ 粗筛探针必须取**原始题干**的片段，不能取归一化后的（2026-10-07 实测修）：
  //   归一化会去掉空格与标点，「QB测试 函数求最小值：f(x)」归一化成
  //   「qb测试函数求最小值fx」—— 这个串**不是原始 stem 列的子串**，
  //   于是 `stem LIKE '%探针%'` 一条都匹配不到，L2 相似度恒为 0（形同虚设）。
  //   正确做法：从**原文**取一段「长度足够长、且不受标点影响的连续片段」做探针。
  const probe = rawProbe(stem);
  let candidates = [];
  if (probe.length >= 2) {
    candidates = db
      .prepare(
        `SELECT id, stem FROM questions
         WHERE deleted_at IS NULL AND id != ? AND content_hash != ? AND status != '已归档'${dupCourseClause}
           AND stem LIKE ? ESCAPE '\\' LIMIT 300`
      )
      // ★ 参数顺序必须与 SQL 里的 `?` 一一对应：
      //   SQL 是 `id != ? AND content_hash != ? ...${dupCourseClause} AND stem LIKE ?`
      //   → 学科参数要插在 LIKE 参数**之前**，写错会静默匹配错列。
      .all(excludeId, dedupe.contentHash(stem), ...dupCourseParams, `%${escapeLike(probe)}%`);
  }

  const similar = candidates
    .map((c) => ({ id: c.id, stem: c.stem, similarity: dedupe.similarity(stem, c.stem) }))
    .filter((c) => c.similarity >= dedupe.DEFAULT_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);

  res.json({ success: true, data: { exact, similar, checked: candidates.length } });
});

/**
 * Excel 批量导入。
 *
 * ★ 报错策略（验收标准第 5 条）：**逐行校验、逐行回报**，不因一行错就整批失败 ——
 *   老师导100 道题，第 3 行写错不该让前 97 道白导。
 *   返回 { total, imported, failed, errors: [{row, message}] }。
 *
 * ★ 版权口径：来源为空的行**拒绝导入**（与手录入库同规则，CHECK 也会拦）。
 */
router.post("/questions/import", auth, requireRole("admin", "teacher"), (req, res, next) => {
  // ★ 导入的学科从**请求**取（前端传当前学科），不从 Excel 行里读 ——
  //   老师是在"某个学科下"导入的，让他每行都填学科既啰嗦又易错；
  //   而模板里放学科列还会让跨学科导入变得含糊。
  const importCourseId = Number(req.body?.course_id);
  if (!Number.isInteger(importCourseId) || importCourseId <= 0) {
    return res.status(400).json({ success: false, message: "请选择导入到哪个学科" });
  }
  if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(importCourseId)) {
    return res.status(400).json({ success: false, message: "所选学科不存在" });
  }
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "没有可导入的数据" });
    if (rows.length > 500) {
      return res.status(400).json({ success: false, message: "单次最多导入 500 道题，请分批导入" });
    }

    // 知识点 code → id 映射（Excel 里填 code 比填 id 对老师友好）
    const kpRows = db.prepare("SELECT id, code FROM knowledge_points").all();
    const kpByCode = new Map(kpRows.map((r) => [String(r.code).toLowerCase(), r.id]));
    const kpByName = new Map(kpRows.map((r) => [String(r.code), r.id]));
    // 章节按名字匹配，找不到就留空（不静默建章 —— 建章是管理动作）
    const chapterRows = db.prepare("SELECT id, name FROM question_chapters").all();
    const chapterByName = new Map(chapterRows.map((r) => [String(r.name).trim(), r.id]));

    const errors = [];
    let imported = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i] || {};
      const rowNo = i + 2; // 表头占第 1 行，报错行号按 Excel 计

      const stem = String(r.stem ?? "").trim();
      if (!stem) {
        errors.push({ row: rowNo, message: "题干为空" });
        continue;
      }
      const type = QUESTION_TYPES.includes(String(r.type)) ? String(r.type) : "";
      if (!type) {
        errors.push({ row: rowNo, message: `题型必须是：${QUESTION_TYPES.join("/")}（当前「${r.type ?? ""}」）` });
        continue;
      }
      const source = String(r.source ?? "").trim();
      if (!SOURCES.includes(source)) {
        errors.push({ row: rowNo, message: `来源必须是：${SOURCES.join("/")}（当前「${source}」）` });
        continue;
      }

      const options = [r.optionA, r.optionB, r.optionC, r.optionD]
        .map((o) => String(o ?? "").trim())
        .filter(Boolean);

      const difficultyRaw = Number(r.difficulty);
      const difficulty = Number.isInteger(difficultyRaw) && difficultyRaw >= 1 && difficultyRaw <= 5
        ? difficultyRaw
        : 3;

      // 知识点：支持 code 或 name，逗号/顿号分隔
      const kpIds = String(r.kp_code ?? "")
        .split(/[,，、]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((s) => kpByCode.get(s) ?? kpByName.get(s) ?? null)
        .filter(Number.isInteger);

      const chapterId = chapterByName.get(String(r.chapter ?? "").trim()) ?? null;
      const customTags = String(r.custom_tags ?? "")
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        db.prepare(
          `INSERT INTO questions
             (type, stem, options, answer, analysis, difficulty, kp_ids, chapter_id,
              solve_method, source, content_hash, custom_tags, exam_year, region,
              status, created_by, parse_status, quality_score, course_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '草稿', ?, 'manual', ?, ?)`
        ).run(
          type,
          stem,
          JSON.stringify(type === "单选题" || type === "多选题" ? options : []),
          String(r.answer ?? "").trim(),
          String(r.analysis ?? "").trim(),
          difficulty,
          JSON.stringify(kpIds),
          chapterId,
          String(r.solve_method ?? "").trim(),
          source,
          dedupe.contentHash(stem),
          JSON.stringify(customTags),
          Number(r.year) || null,
          String(r.region ?? "").trim(),
          req.user.id,
          computeQualityScore({
            analysis: r.analysis,
            kpIds,
            solveMethod: r.solve_method
          }),
          importCourseId
        );
        imported += 1;
      } catch (err) {
        errors.push({ row: rowNo, message: isConstraintError(err) ? constraintMessage(err) : err.message });
      }
    }

    audit(req.user, "导入题目", `Excel 导入：成功 ${imported} / 共 ${rows.length}`);
    // ★ 部分成功也返回 200 —— HTTP 200 +业务结果，页面据此逐条提示
    res.json({
      success: true,
      data: {
        total: rows.length,
        imported,
        failed: errors.length,
        errors: errors.slice(0, 50)
      }
    });
  } catch (err) {
    next(err);
  }
});


/**
 * 上传题目配图（题干插图）。
 *
 * 用法：前端先传图拿到路径 → 随题目一起提交到 `figure_path`。
 * 所以本端点**不绑定题目 id**（新建题目时题目还不存在）。
 *
 * ★★ `cleanup: false` 是必须的（不是可选项）：
 *   `saveImage` 默认会删掉「同前缀的旧文件」—— 那是为 **Logo / 头像**
 *   这类「一个位置只有一张图」的场景设计的。而配图是**多文件共存**
 *   （每题一张），若照搬默认值，新上传的图会把之前所有图删掉。
 *   这是"把单文件场景的默认值搬到多文件场景"的典型坑。
 *   ⇒ 旧配图的清理由 PUT 题目时按 figure_path 差异精确处理（见 replaceFigure）。
 *
 * 落盘目录 `data/assets/questions/`（迁移 026 的注释里已预留该路径），
 * 走既有 `/assets` 静态链路（ADR-008：DB 只存路径，文件随 data/ 一起备份）。
 */
router.post(
  "/questions/figure",
  auth,
  requireRole("admin", "teacher"),
  express.raw({ type: ["image/*", "application/octet-stream"], limit: MAX_UPLOAD_BYTES + 1024 }),
  (req, res) => {
    // ★ 同样两层 `..`（见 purgeQuestionFiles 的注释）
    const dir = path.join(__dirname, "..", "..", "data", "assets", "questions");
    const saved = saveImage({
      dir,
      prefix: "fig",
      buf: req.body,
      cleanup: false   // ★ 见上方说明：配图多文件共存，绝不能开
    });
    if (!saved.ok) {
      return res.status(saved.status).json({ success: false, message: saved.message });
    }
    audit(req.user, "上传题目配图", saved.filename);
    res.json({
      success: true,
      data: {
        // 返回相对路径，前端直接塞进 figure_path / <img src>
        path: `/assets/questions/${saved.filename}`,
        filename: saved.filename,
        size: req.body?.length || 0
      }
    });
  }
);

/**
 * 配图替换时的旧文件清理。
 *
 * ★ 只在「路径确实变了」时删旧图 —— 否则改一道题的难度也会把图删掉。
 * ★ 只在「旧路径属于本系统 assets 目录」时删 —— 防路径穿越。
 * 失败只 warn 不阻断（图片删不掉不该让用户改不了题）。
 */
function replaceFigure(oldPath, newPath) {
  const oldP = String(oldPath || "").trim();
  const newP = String(newPath || "").trim();
  if (!oldP || oldP === newP) return;          // 没换图 → 不动
  if (!oldP.startsWith("/assets/questions/")) return;  // 不是本系统传的图 → 不碰
  purgeQuestionFiles(oldP);
}

/**
 * 从回收站恢复（单个或批量）。
 *
 * ★ 权限口径与删除完全对称：能用 `canMutate` 改的题才能恢复。
 *   不对称会出怪事 —— 比如「删不了别人的题，却能把别人删的题恢复回来」。
 */
router.post("/questions/restore", auth, requireRole("admin", "teacher"), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "请先选择要恢复的题目" });

  let restored = 0;
  let skipped = 0;
  for (const id of ids) {
    // ★ 这里**不能**用 loadQuestion —— 它带 `deleted_at IS NULL`，
    //   正好把「要恢复的那道题」排除掉了，永远恢复不了。
    const row = db.prepare("SELECT * FROM questions WHERE id = ?").get(Number(id));
    if (!row || !row.deleted_at) { skipped += 1; continue; }   // 不存在 或 本来就没删
    if (!canMutate(req, row).ok) { skipped += 1; continue; }
    db.prepare(
      "UPDATE questions SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?"
    ).run(req.user.id, id);
    restored += 1;
  }
  audit(req.user, "恢复题目", `恢复 ${restored} 道`);
  res.json({
    success: true,
    data: {
      restored,
      skipped,
      message: skipped > 0
        ? `已恢复 ${restored} 道，${skipped} 道因无权限或不在回收站被跳过`
        : `已恢复 ${restored} 道题目`
    }
  });
});

/**
 * 彻底删除（不可恢复）—— 物理删除 + 清理配图文件。
 *
 * body：{ ids: [...] } 删指定的；或 { all: true } 清空回收站（**仅 admin**）。
 * ★ 清空回收站是高风险操作，因此：① 限 admin ② 要求**显式**传 all:true，
 *   不能靠 ids 为空隐式触发（否则前端一个空数组就抹掉整个回收站）。
 */
router.post("/questions/purge", auth, requireRole("admin", "teacher"), (req, res) => {
  const purgeAll = req.body?.all === true;

  if (purgeAll) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "只有管理员可以清空回收站" });
    }
    const rows = db.prepare("SELECT id, figure_path FROM questions WHERE deleted_at IS NOT NULL").all();
    for (const r of rows) purgeQuestionFiles(r.figure_path);
    db.prepare("DELETE FROM questions WHERE deleted_at IS NOT NULL").run();
    audit(req.user, "清空回收站", `彻底删除 ${rows.length} 道`);
    return res.json({
      success: true,
      data: { purged: rows.length, message: `已彻底删除 ${rows.length} 道题目，不可恢复` }
    });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: "请先选择要彻底删除的题目" });
  }

  let purged = 0;
  let skipped = 0;
  for (const id of ids) {
    const row = db.prepare("SELECT * FROM questions WHERE id = ?").get(Number(id));
    // ★ 只允许对**已在回收站**的题彻底删除 —— 否则直接调 purge 就能
    //   一步干掉正常题目，绕过了软删这层保护。
    if (!row || !row.deleted_at) { skipped += 1; continue; }
    if (!canMutate(req, row).ok) { skipped += 1; continue; }
    purgeQuestionFiles(row.figure_path);
    db.prepare("DELETE FROM questions WHERE id = ?").run(id);
    purged += 1;
  }
  audit(req.user, "彻底删除题目", `删除 ${purged} 道`);
  res.json({
    success: true,
    data: {
      purged,
      skipped,
      message: skipped > 0
        ? `已彻底删除 ${purged} 道，${skipped} 道因无权限或不在回收站被跳过`
        : `已彻底删除 ${purged} 道题目，不可恢复`
    }
  });
});


/** 批量修改状态（启用/归档等）—— 同样按权限过滤 */
router.post("/questions/batch-status", auth, requireRole("admin", "teacher"), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  const status = String(req.body?.status || "");
  if (!ids.length) return res.status(400).json({ success: false, message: "请先选择题目" });
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: `状态必须是：${STATUSES.join("/")}` });
  }
  let updated = 0;
  let skipped = 0;
  for (const id of ids) {
    const row = loadQuestion(id);
    if (!row || !canMutate(req, row).ok) { skipped += 1; continue; }
    db.prepare("UPDATE questions SET status = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?")
      .run(status, req.user.id, id);
    updated += 1;
  }
  res.json({
    success: true,
    data: { updated, skipped, message: skipped > 0 ? `已更新 ${updated} 道，${skipped} 道被跳过` : `已更新 ${updated} 道` }
  });
});

module.exports = router;