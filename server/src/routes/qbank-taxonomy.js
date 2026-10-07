// 智能题库 · 知识点与章节管理（2026-10-07 新增）
//
// 为什么单独一个文件：`routes/qbank.js` 已 1100+ 行，而本模块职责独立
//   （管理教学体系骨架，不碰题目内容），拆开后两者都能独立读。
//   挂载方式与 qbank.js 完全相同（同一个 `/api/qbank` 前缀），
//   所以 `qb_agent` 凭证的路径白名单自动覆盖本文件，无需改中间件。
//
// ★★ 权限（用户 2026-10-07 拍板）：**admin 与 teacher 都可增删改**。
//   之所以敢放开，是因为老师最清楚自己教的章节该怎么分；
//   代价是必须有**引用保护** —— 见下方 assertKpDeletable / assertChapterDeletable。
//
// ★★ 引用保护是本节最关键的逻辑，且**必须查两类引用**（横向扫描的结论）：
//   1. `questions.kp_ids` —— 题库里的题目挂了这个知识点；
//   2. `kp_assessments.kp_id` —— **学生知识点测评记录**（成长曲线的证据源，
//      见迁移 018）。这张表是 `ON DELETE CASCADE`，删知识点会**级联删掉
//      所有学生的测评记录** —— 那是不可重建的真实教学数据，比题目引用严重得多。
//      只查题库会漏掉这一类（这正是"横向同类扫描"要防的事）。
//
// 章节同理：`question_chapters` 自引用 `ON DELETE CASCADE`，
//   删一个「章」会连带删掉它的所有「节」，而那些节可能正被题目引用 →
//   必须检查**整棵子树**。
const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { isBlank, parseText, parseNumber } = require("../utils/validate");
const { audit } = require("../utils/audit");

const router = express.Router();

/** 管理端点统一要求登录 + admin/teacher 角色 */
const managerOnly = [auth, requireRole("admin", "teacher")];

/** 安全解析 JSON 数组（DB 里可能存着历史脏数据） */
function safeJsonArray(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════
// 读取：一次性拿回两棵树（带引用计数，供管理页显示"这个节点被用了多少次"）
// ══════════════════════════════════════════════════════════════════════
router.get("/taxonomy", auth, (req, res) => {
  // ★ 按学科过滤（迁移 028）：管理页也要跟着学科切换器走 ——
  //   否则在「初中物理」下会看到数学的知识点树，一眼就乱。
  const cid = Number(req.query?.course_id);
  const hasCourse = Number.isInteger(cid) && cid > 0;
  const kpWhere = hasCourse ? "WHERE course_id = ?" : "";
  const kpParams = hasCourse ? [cid] : [];

  const kps = db
    .prepare(
      `SELECT id, parent_id, code, name, difficulty, seq, is_active, description
         FROM knowledge_points
         ${kpWhere}
        ORDER BY COALESCE(parent_id, 0), seq, id`
    )
    .all(...kpParams);

  // 每个知识点被多少道题挂载（json_each 反查，量级 <1 万足够快）
  const kpQ = new Map();
  for (const r of db
    .prepare(
      `SELECT json_each.value AS kp, COUNT(*) AS c
         FROM questions, json_each(questions.kp_ids)
        WHERE questions.deleted_at IS NULL
        GROUP BY json_each.value`
    )
    .all()) {
    kpQ.set(Number(r.kp), r.c);
  }
  // 每个知识点的学生测评记录数（★ 这是"删了就丢学生数据"的风险指标）
  const kpA = new Map();
  for (const r of db
    .prepare("SELECT kp_id, COUNT(*) AS c FROM kp_assessments GROUP BY kp_id")
    .all()) {
    kpA.set(Number(r.kp_id), r.c);
  }

  const chapters = db
    .prepare(
      `SELECT id, parent_id, name, sort, course_id FROM question_chapters
       ${hasCourse ? "WHERE course_id = ?" : ""}
       ORDER BY sort, id`
    )
    .all(...kpParams);
  const chQ = new Map();
  for (const r of db
    .prepare(
      "SELECT chapter_id, COUNT(*) AS c FROM questions WHERE deleted_at IS NULL AND chapter_id IS NOT NULL GROUP BY chapter_id"
    )
    .all()) {
    chQ.set(Number(r.chapter_id), r.c);
  }

  res.json({
    success: true,
    data: {
      knowledge: kps.map((k) => ({
        ...k,
        questionCount: kpQ.get(k.id) || 0,
        // ★ 非 0 表示"删了会连学生测评记录一起没了"，前端要显式警示
        assessmentCount: kpA.get(k.id) || 0
      })),
      chapters: chapters.map((c) => ({ ...c, questionCount: chQ.get(c.id) || 0 }))
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// 知识点增删改
// ══════════════════════════════════════════════════════════════════════

/**
 * 删除前的引用检查。
 * @returns {string|null} 拒绝原因；null 表示可删
 */
function kpDeleteBlocker(kpId) {
  const q = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM questions
          WHERE deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM json_each(questions.kp_ids) WHERE json_each.value = ?)`
      )
      .get(kpId).c
  );
  if (q > 0) return `该知识点下还有 ${q} 道题在用，请先把这些题换到别的知识点（或删除它们）`;

  const a = Number(
    db.prepare("SELECT COUNT(*) AS c FROM kp_assessments WHERE kp_id = ?").get(kpId).c
  );
  if (a > 0) {
    return (
      `该知识点下已有 ${a} 条学生测评记录（成长曲线的证据）。` +
      `删除会连带删掉这些真实教学记录，因此不允许删除。` +
      `若确实不再使用，请改名为「（已停用）xxx」并取消激活`
    );
  }

  const child = Number(
    db.prepare("SELECT COUNT(*) AS c FROM knowledge_points WHERE parent_id = ?").get(kpId).c
  );
  if (child > 0) return `该知识点下还有 ${child} 个子知识点，请先处理子节点`;
  return null;
}

/** 新增知识点 */
router.post("/taxonomy/kp", ...managerOnly, (req, res, next) => {
  try {
    const nameRes = parseText(req.body?.name, { field: "知识点名称", max: 60, required: true });
    if (!nameRes.ok) return res.status(400).json({ success: false, message: nameRes.message });
    const name = nameRes.value;

    const diff = parseNumber(req.body?.difficulty ?? 2, {
      field: "难度", min: 1, max: 5, integer: true
    });
    if (!diff.ok) return res.status(400).json({ success: false, message: diff.message });

    // ★ 学科必填（迁移 028）：知识点必须归属学科，否则管理页切换学科后会"消失"
    const kpCourseId = Number(req.body?.course_id);
    if (!Number.isInteger(kpCourseId) || kpCourseId <= 0) {
      return res.status(400).json({ success: false, message: "请选择所属学科" });
    }
    if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(kpCourseId)) {
      return res.status(400).json({ success: false, message: "所选学科不存在" });
    }

    let parentId = null;
    if (!isBlank(req.body?.parent_id)) {
      parentId = Number(req.body.parent_id);
      const p = db.prepare("SELECT id, course_id FROM knowledge_points WHERE id = ?").get(parentId);
      if (!p) return res.status(400).json({ success: false, message: "上级知识点不存在" });
      // ★ 上级必须同一学科 —— 否则会造出"物理章节下的数学知识点"这种跨科父子关系
      if (Number(p.course_id) !== kpCourseId) {
        return res.status(400).json({ success: false, message: "上级知识点属于其他学科" });
      }
    }

    // code 是 NOT NULL UNIQUE。老师很少关心它，所以留空即自动生成；
    // 但它在 Excel 导入时是匹配键，所以允许老师填有意义的编码。
    let code = String(req.body?.code || "").trim();
    if (!code) {
      // 生成格式：K-<8位随机>（base36 大写，去掉易混的 0/O/1/I）
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      let tries = 0;
      do {
        code =
          "K-" +
          Array.from(crypto.randomBytes(8))
            .map((b) => alphabet[b % alphabet.length])
            .join("");
        tries += 1;
      } while (db.prepare("SELECT 1 FROM knowledge_points WHERE code = ?").get(code) && tries < 10);
    } else if (db.prepare("SELECT 1 FROM knowledge_points WHERE code = ?").get(code)) {
      return res.status(400).json({ success: false, message: `编码「${code}」已被占用，请换一个` });
    }

    const info = db
      .prepare(
        `INSERT INTO knowledge_points (parent_id, code, name, difficulty, seq, description, course_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        parentId,
        code,
        name,
        diff.value,
        Number(req.body?.seq) || 0,
        String(req.body?.description || "").trim().slice(0, 300),
        kpCourseId
      );

    audit(req.user, "新增知识点", `${name}（${code}）`);
    res.json({ success: true, data: { id: Number(info.lastInsertRowid), code } });
  } catch (err) {
    next(err);
  }
});

/** 修改知识点（改名 / 难度 / 排序 / 启停 / 上级） */
router.put("/taxonomy/kp/:id", ...managerOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM knowledge_points WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ success: false, message: "知识点不存在" });

    const nameRes = isBlank(req.body?.name)
      ? { ok: true, value: row.name }
      : parseText(req.body.name, { field: "知识点名称", max: 60, required: true });
    if (!nameRes.ok) return res.status(400).json({ success: false, message: nameRes.message });

    const diffRes = parseNumber(req.body?.difficulty ?? row.difficulty, {
      field: "难度", min: 1, max: 5, integer: true
    });
    if (!diffRes.ok) return res.status(400).json({ success: false, message: diffRes.message });

    // 上级变更：防成环（不能把自己挂到自己的子孙下面）
    let parentId = req.body?.parent_id === undefined ? row.parent_id : (isBlank(req.body.parent_id) ? null : Number(req.body.parent_id));
    if (parentId !== null) {
      if (parentId === id) return res.status(400).json({ success: false, message: "不能把自己设为上级" });
      // 沿 parent 链上溯，若遇到自己则成环
      let cur = parentId;
      let guard = 0;
      while (cur !== null && guard < 50) {
        if (cur === id) return res.status(400).json({ success: false, message: "不能挂到自己的下级知识点下（会形成环）" });
        const p = db.prepare("SELECT parent_id FROM knowledge_points WHERE id = ?").get(cur);
        cur = p ? p.parent_id : null;
        guard += 1;
      }
    }

    const code = String(req.body?.code || "").trim();
    if (code && code !== row.code) {
      if (db.prepare("SELECT 1 FROM knowledge_points WHERE code = ? AND id != ?").get(code, id)) {
        return res.status(400).json({ success: false, message: `编码「${code}」已被占用` });
      }
    }

    db.prepare(
      `UPDATE knowledge_points
          SET parent_id = ?, name = ?, code = ?, difficulty = ?, seq = ?,
              is_active = ?, description = ?
        WHERE id = ?`
    ).run(
      parentId,
      nameRes.value,
      code || row.code,
      diffRes.value,
      req.body?.seq === undefined ? row.seq : Number(req.body.seq) || 0,
      req.body?.is_active === undefined ? row.is_active : (req.body.is_active ? 1 : 0),
      req.body?.description === undefined ? row.description : String(req.body.description).trim().slice(0, 300),
      id
    );

    audit(req.user, "修改知识点", `#${id} ${nameRes.value}`);
    res.json({ success: true, data: { id } });
  } catch (err) {
    next(err);
  }
});

/** 删除知识点（有引用时拒绝，并说明是什么引用） */
router.delete("/taxonomy/kp/:id", ...managerOnly, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM knowledge_points WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "知识点不存在" });

  const blocker = kpDeleteBlocker(id);
  if (blocker) return res.status(409).json({ success: false, message: blocker });

  db.prepare("DELETE FROM knowledge_points WHERE id = ?").run(id);
  audit(req.user, "删除知识点", `#${id} ${row.name}`);
  res.json({ success: true, data: { id, message: `已删除知识点「${row.name}」` } });
});

// ══════════════════════════════════════════════════════════════════════
// 章节增删改
// ══════════════════════════════════════════════════════════════════════

/** 收集某章节及其所有后代 id（章节自引用 CASCADE，删父会连带删子） */
function chapterSubtreeIds(rootId) {
  const rows = db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM question_chapters WHERE id = ?
         UNION ALL
         SELECT c.id FROM question_chapters c JOIN sub s ON c.parent_id = s.id
       ) SELECT id FROM sub`
    )
    .all(rootId);
  return rows.map((r) => r.id);
}

/** 删除前的引用检查（含子树） */
function chapterDeleteBlocker(chId) {
  const ids = chapterSubtreeIds(chId);
  const ph = ids.map(() => "?").join(",");
  const q = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM questions
          WHERE deleted_at IS NULL AND chapter_id IN (${ph})`
      )
      .get(...ids).c
  );
  if (q > 0) {
    const extra = ids.length > 1 ? `（含 ${ids.length - 1} 个下级章节）` : "";
    return `该章节${extra}下还有 ${q} 道题在用，请先把这些题换到别的章节（或删除它们）`;
  }
  return null;
}

/** 新增章节 */
router.post("/taxonomy/chapter", ...managerOnly, (req, res, next) => {
  try {
    const nameRes = parseText(req.body?.name, { field: "章节名称", max: 80, required: true });
    if (!nameRes.ok) return res.status(400).json({ success: false, message: nameRes.message });

    // ★ 学科必填（迁移 028）
    const chCourseId = Number(req.body?.course_id);
    if (!Number.isInteger(chCourseId) || chCourseId <= 0) {
      return res.status(400).json({ success: false, message: "请选择所属学科" });
    }
    if (!db.prepare("SELECT id FROM courses WHERE id = ?").get(chCourseId)) {
      return res.status(400).json({ success: false, message: "所选学科不存在" });
    }

    let parentId = null;
    if (!isBlank(req.body?.parent_id)) {
      parentId = Number(req.body.parent_id);
      const p = db.prepare("SELECT id, parent_id, course_id FROM question_chapters WHERE id = ?").get(parentId);
      if (!p) return res.status(400).json({ success: false, message: "上级章节不存在" });
      // ★ 上级必须同一学科（否则会造出跨科的父子关系）
      if (Number(p.course_id) !== chCourseId) {
        return res.status(400).json({ success: false, message: "上级章节属于其他学科" });
      }
      // 只允许两层（章 → 节）：本项目教材结构就是两级，三层会让组卷时的层级语义变乱
      if (p.parent_id !== null) {
        return res.status(400).json({ success: false, message: "章节最多两层（章 → 节），不能在「节」下再建子级" });
      }
    }

    const info = db
      .prepare("INSERT INTO question_chapters (parent_id, course_id, name, sort) VALUES (?, ?, ?, ?)")
      .run(parentId, chCourseId, nameRes.value, Number(req.body?.sort) || 0);

    audit(req.user, "新增章节", nameRes.value);
    res.json({ success: true, data: { id: Number(info.lastInsertRowid) } });
  } catch (err) {
    next(err);
  }
});

/** 修改章节 */
router.put("/taxonomy/chapter/:id", ...managerOnly, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM question_chapters WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ success: false, message: "章节不存在" });

    const nameRes = isBlank(req.body?.name)
      ? { ok: true, value: row.name }
      : parseText(req.body.name, { field: "章节名称", max: 80, required: true });
    if (!nameRes.ok) return res.status(400).json({ success: false, message: nameRes.message });

    let parentId = req.body?.parent_id === undefined
      ? row.parent_id
      : (isBlank(req.body.parent_id) ? null : Number(req.body.parent_id));
    if (parentId !== null) {
      if (parentId === id) return res.status(400).json({ success: false, message: "不能把自己设为上级" });
      const p = db.prepare("SELECT id, parent_id FROM question_chapters WHERE id = ?").get(parentId);
      if (!p) return res.status(400).json({ success: false, message: "上级章节不存在" });
      if (p.parent_id !== null) {
        return res.status(400).json({ success: false, message: "章节最多两层，不能在「节」下再建子级" });
      }
      // 有子章节的「章」不能降级成「节」（否则三层）
      const childCount = Number(
        db.prepare("SELECT COUNT(*) AS c FROM question_chapters WHERE parent_id = ?").get(id).c
      );
      if (childCount > 0) {
        return res.status(400).json({
          success: false,
          message: `该章节下还有 ${childCount} 个子章节，不能再挂到别的章下（会变成三层）`
        });
      }
    }

    db.prepare("UPDATE question_chapters SET parent_id = ?, name = ?, sort = ? WHERE id = ?").run(
      parentId,
      nameRes.value,
      req.body?.sort === undefined ? row.sort : Number(req.body.sort) || 0,
      id
    );

    audit(req.user, "修改章节", `#${id} ${nameRes.value}`);
    res.json({ success: true, data: { id } });
  } catch (err) {
    next(err);
  }
});

/** 删除章节（有引用时拒绝，含子树检查） */
router.delete("/taxonomy/chapter/:id", ...managerOnly, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM question_chapters WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ success: false, message: "章节不存在" });

  const blocker = chapterDeleteBlocker(id);
  if (blocker) return res.status(409).json({ success: false, message: blocker });

  const subCount = chapterSubtreeIds(id).length - 1;
  db.prepare("DELETE FROM question_chapters WHERE id = ?").run(id);
  audit(req.user, "删除章节", `#${id} ${row.name}`);
  res.json({
    success: true,
    data: {
      id,
      message: subCount > 0
        ? `已删除章节「${row.name}」及其 ${subCount} 个下级章节`
        : `已删除章节「${row.name}」`
    }
  });
});

module.exports = router;
