// 成长时间轴服务：写入与读取的唯一入口
//
// 设计要点（对齐 v18 迁移的四条铁律）：
// 1. **只增不改**：appendEvent 只 INSERT，绝不 UPDATE。历史事件不可篡改，
//    这是成长路径可信的前提。
// 2. **不改旧表**：出勤/成绩/课时三张既有表一张都不动。读取时用 UNION 把
//    它们与新增事件合并成统一时间轴，业务逻辑零回归风险。
// 3. **payload 不放敏感字段**：金额、家长电话一律不写入（对齐 agent.js 约定）。
// 4. **阈值从 growth_thresholds 读**：不硬编码，跑一周后可按真实分布调整。
//
// ★ 分工铁律（2026-09-20 实测缺陷后补）：
//   既有表已负责的维度（attendance / exam_score / hour_change），
//   **绝不再往 student_timeline 写事件** —— 否则读取时 UNION 会产生双份，
//   表现为「一次课算成两次」「一次考试显示两条」。
//   student_timeline 只装**既有表装不下的新维度**：
//   class_eval / kp_assessment / milestone / note。
//   读取层另加去重兜底，防历史脏数据。
const db = require("../db");

/**
 * 由既有表承载的维度：读取时从原表取，不接受 timeline 表的重复写入。
 * 写入这两个类型会被拒绝（防再犯），已存在的重复行在读取时按 (type,date) 去重。
 */
const LEGACY_TYPES = new Set(["attendance", "exam_score", "hour_change"]);

/** 合法事件类型白名单：前端不可自由写入任意 type */
const EVENT_TYPES = new Set([
  "attendance",
  "exam_score",
  "class_eval",
  "kp_assessment",
  "hour_change",
  "milestone",
  "note"
]);

const EVENT_LABELS = {
  attendance: "出勤",
  exam_score: "成绩",
  class_eval: "课堂表现",
  kp_assessment: "知识点掌握",
  hour_change: "课时变动",
  milestone: "成长里程碑",
  note: "教师备注"
};

/** 读取成长阈值（带默认值兜底，缺行不影响运行） */
function thresholds() {
  const rows = db.prepare("SELECT key, value FROM growth_thresholds").all();
  const map = new Map(rows.map(r => [r.key, Number(r.value)]));
  const num = (k, d) => (Number.isFinite(map.get(k)) ? map.get(k) : d);
  return {
    absentStreakWarn: num("absent_streak_warn", 2),
    scoreTrendDown: num("score_trend_down", -8),
    scoreTrendUp: num("score_trend_up", 8),
    hoursLowWarn: num("hours_low_warn", 12),
    excellentRate: num("excellent_rate", 88),
    outlierZ: num("outlier_z", 1.2),
    kpProgressStep: num("kp_progress_step", 1),
    attentionScore: num("attention_score", 6)
  };
}

/**
 * 追加一条时间轴事件。
 * @param {object} e
 * @param {number} e.studentId  必填
 * @param {string} e.eventType  必须在白名单内
 * @param {string} e.occurredAt YYYY-MM-DD 或 ISO 字符串
 * @param {object} [e.payload]  事件细节（禁止放金额/电话）
 * @param {number} [e.classId]
 * @param {number} [e.courseId]
 * @param {string} [e.source]   manual | auto | engine
 * @param {number} [e.createdBy]
 */
function appendEvent(e) {
  if (!e || !e.studentId) throw new Error("appendEvent 缺少 studentId");
  if (!EVENT_TYPES.has(e.eventType)) {
    throw new Error(`未知事件类型：${e.eventType}`);
  }
  // 既有表已承载的维度不再重复写时间轴（否则读取 UNION 会双份）
  if (LEGACY_TYPES.has(e.eventType)) {
    throw new Error(
      `${e.eventType} 由既有业务表承载，不应写入 student_timeline（会造成时间轴重复）`
    );
  }
  if (!e.occurredAt) throw new Error("appendEvent 缺少 occurredAt");

  // 敏感字段兜底剔除：即使调用方误传也不落库
  const clean = scrubPayload(e.payload || {});

  return db
    .prepare(
      `INSERT INTO student_timeline
         (student_id, class_id, course_id, occurred_at, event_type, payload, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(e.studentId),
      e.classId || null,
      e.courseId || null,
      String(e.occurredAt).slice(0, 10),
      e.eventType,
      JSON.stringify(clean),
      e.source || "auto",
      e.createdBy || null
    ).lastInsertRowid;
}

/** 兜底脱敏：金额 / 电话 / 家长相关键一律剔除（值也扫一遍手机号） */
const BAD_KEY = /(amount|money|fee|balance|price|pay|refund|phone|mobile|tel|parent|idcard|address|email)/i;
const PHONE_RE = /\b1[3-9]\d{9}\b/g;

function scrubPayload(obj, depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== "object") {
    if (typeof obj === "string") return obj.replace(PHONE_RE, "[已脱敏]");
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(v => scrubPayload(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BAD_KEY.test(k)) continue;
    out[k] = scrubPayload(v, depth + 1);
  }
  return out;
}

/**
 * 拉取单个学员的成长时间轴（三表 UNION + 新增事件合并，按时间正序）。
 * 返回统一结构，前端不需要知道数据来自哪张表。
 */
function studentTimeline(studentId, opts = {}) {
  const sid = Number(studentId);
  const from = opts.from || "0000-01-01";
  const to = opts.to || "9999-12-31";

  // ① 出勤（既有表，UNION 进来）
  const attendance = db
    .prepare(
      `SELECT a.date AS occurred_at, 'attendance' AS event_type,
              a.status AS status, '' AS detail
       FROM attendances a
       WHERE a.student_id = ? AND a.date BETWEEN ? AND ?
       ORDER BY a.date`
    )
    .all(sid, from, to)
    .map(r => ({
      type: "attendance",
      label: EVENT_LABELS.attendance,
      date: r.occurred_at,
      summary: r.status,
      payload: { status: r.status }
    }));

  // ② 成绩（既有表）
  const exams = db
    .prepare(
      `SELECT e.exam_date AS occurred_at, e.name AS exam_name, e.type AS exam_type,
              e.full_score, es.score
       FROM exam_scores es
       JOIN exams e ON e.id = es.exam_id
       WHERE es.student_id = ? AND e.exam_date BETWEEN ? AND ?
       ORDER BY e.exam_date`
    )
    .all(sid, from, to)
    .map(r => {
      const full = Number(r.full_score) || 0;
      const rate = full > 0 ? Math.round((Number(r.score) / full) * 1000) / 10 : 0;
      return {
        type: "exam_score",
        label: EVENT_LABELS.exam_score,
        date: r.occurred_at,
        summary: `${r.exam_name} ${r.score}/${full}（${rate}%）`,
        payload: {
          examName: r.exam_name,
          examType: r.exam_type,
          score: Number(r.score),
          full,
          rate
        }
      };
    });

  // ③ 课时变动（既有表，只记数量不记金额）
  const hours = db
    .prepare(
      `SELECT date AS occurred_at, hours, type FROM hour_consumptions
       WHERE student_id = ? AND date BETWEEN ? AND ?
       ORDER BY date`
    )
    .all(sid, from, to)
    .map(r => ({
      type: "hour_change",
      label: EVENT_LABELS.hour_change,
      date: r.occurred_at,
      summary: `${r.type} ${r.hours} 课时`,
      payload: { hours: Number(r.hours), kind: r.type }
    }));

  // ④ 新增事件（v18 时间轴表：课堂评价 / 知识点评定 / 里程碑 / 备注）
  // 去重兜底：历史脏数据可能把 attendance/exam_score 也写进了本表，
  // 这类维度一律以既有表为准，此处直接丢弃，避免时间轴出现双份。
  const extraRaw = db
    .prepare(
      `SELECT occurred_at, event_type, payload, source
       FROM student_timeline
       WHERE student_id = ? AND occurred_at BETWEEN ? AND ?
       ORDER BY occurred_at`
    )
    .all(sid, from, to);

  const extra = extraRaw
    .filter(r => !LEGACY_TYPES.has(r.event_type))
    .map(r => {
      let p = {};
      try {
        p = JSON.parse(r.payload || "{}");
      } catch {
        p = {};
      }
      return {
        type: r.event_type,
        label: EVENT_LABELS[r.event_type] || r.event_type,
        date: r.occurred_at,
        summary: summarizeEvent(r.event_type, p),
        payload: p,
        source: r.source
      };
    });

  // 同类型同日期的事件按「节」去重（同一天重复提交只保留一条，取内容更全的）
  const dedup = arr => {
    const m = new Map();
    for (const e of arr) {
      const key = `${e.type}|${e.date}`;
      const prev = m.get(key);
      if (!prev || (e.summary || "").length > (prev.summary || "").length) m.set(key, e);
    }
    return [...m.values()];
  };

  const all = dedup([...attendance, ...exams, ...hours, ...extra]).sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );

  return { studentId: sid, from, to, count: all.length, events: all };
}

/** 事件摘要文案（前端列表直接用，避免前端各处重复拼字符串） */
function summarizeEvent(type, p) {
  switch (type) {
    case "class_eval":
      return `专注 ${p.focus ?? "-"} · 参与 ${p.participation ?? "-"} · 掌握 ${p.mastery ?? "-"}${
        p.teacherNote ? ` · ${p.teacherNote}` : ""
      }`;
    case "kp_assessment":
      return `${p.kpName || "知识点"}：${p.level || ""}${
        p.from ? `（${p.from} → ${p.level}）` : ""
      }`;
    case "milestone":
      return p.title || "达成一个里程碑";
    case "note":
      return p.text || "";
    default:
      return "";
  }
}

/**
 * 班级成长概览：班级维度的时间轴聚合，供「整班视角」使用。
 * 只做聚合，不做 AI 调用——AI 只负责把结果写成人话。
 */
function classGrowth(classId, opts = {}) {
  const cid = Number(classId);
  const from = opts.from || "0000-01-01";
  const to = opts.to || "9999-12-31";

  const students = db
    .prepare("SELECT id, student_no, name FROM students WHERE class_id = ? ORDER BY id")
    .all(cid);

  // 课堂评价按课时聚合（每课一条班级均值），形成班级成长曲线
  const evalSeries = db
    .prepare(
      `SELECT eval_date,
              COUNT(*) AS n,
              ROUND(AVG(focus), 2) AS focus,
              ROUND(AVG(participation), 2) AS participation,
              ROUND(AVG(mastery), 2) AS mastery
       FROM class_evaluations
       WHERE class_id = ? AND eval_date BETWEEN ? AND ?
       GROUP BY eval_date ORDER BY eval_date`
    )
    .all(cid, from, to);

  // 知识点掌握度：每个知识点的「已掌握人数 / 已评定人数」
  const kpRows = db
    .prepare(
      `SELECT k.id AS kp_id, k.code, k.name, k.unit_no, k.seq,
              COUNT(*) AS assessed,
              SUM(CASE WHEN a.level = '已掌握' THEN 1 ELSE 0 END) AS mastered
       FROM kp_assessments a
       JOIN knowledge_points k ON k.id = a.kp_id
       WHERE a.class_id = ? AND a.assessed_at BETWEEN ? AND ?
       GROUP BY k.id ORDER BY k.unit_no, k.seq`
    )
    .all(cid, from, to)
    .map(r => ({
      kpId: Number(r.kp_id),
      code: r.code,
      name: r.name,
      unitNo: Number(r.unit_no),
      seq: Number(r.seq),
      assessed: Number(r.assessed),
      mastered: Number(r.mastered),
      masteryRate: Number(r.assessed) > 0
        ? Math.round((Number(r.mastered) / Number(r.assessed)) * 1000) / 10
        : null
    }));

  return {
    classId: cid,
    studentCount: students.length,
    students,
    evalSeries,
    kpMastery: kpRows,
    thresholds: thresholds()
  };
}

/**
 * 单个学员的成长画像：把时间轴加工成「起点 → 现在」的对比。
 * 这是「从 0 到成功」最直接的数据表达。
 */
function studentGrowth(studentId, opts = {}) {
  const t = thresholds();
  const tl = studentTimeline(studentId, opts);
  const ev = tl.events;

  const evals = ev.filter(e => e.type === "class_eval");
  const kps = ev.filter(e => e.type === "kp_assessment");
  const exms = ev.filter(e => e.type === "exam_score");
  const atts = ev.filter(e => e.type === "attendance");

  // 出勤：正常/迟到/早退计出席，缺勤不计（请假单独统计）
  const attended = atts.filter(a => a.payload.status !== "缺勤" && a.payload.status !== "请假").length;
  const absent = atts.filter(a => a.payload.status === "缺勤").length;
  const leave = atts.filter(a => a.payload.status === "请假").length;

  // 成绩：同一考试可能因历史脏数据出现多条，按 (考试名, 日期) 去重，只保留最后一条
  const examDedup = new Map();
  for (const e of exms) {
    examDedup.set(`${e.payload.examName}|${e.date}`, e);
  }
  const examList = [...examDedup.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  // 课堂表现：首末对比（成长曲线取值的两个端点）
  const evalTrend = evals.map(e => ({
    date: e.date,
    focus: e.payload.focus,
    participation: e.payload.participation,
    mastery: e.payload.mastery
  }));
  const firstEval = evalTrend[0] || null;
  const lastEval = evalTrend[evalTrend.length - 1] || null;

  // 知识点：每个知识点从「第一次评定」到「最后一次评定」的变化
  // ★ 关键：levels 保留**完整过程**（不去重），因为成长曲线需要的正是中间点。
  //   里程碑只取真正的等级跃迁（delta >= kpProgressStep），
  //   而「进步曲线」可以展示每一档的停留时长。
  const kpMap = new Map();
  for (const k of kps) {
    const id = k.payload.kpId;
    if (!id) continue;
    if (!kpMap.has(id)) {
      kpMap.set(id, { kpId: id, name: k.payload.kpName || "", levels: [] });
    }
    kpMap.get(id).levels.push({ date: k.date, level: k.payload.level });
  }
  const LEVEL_RANK = { 未掌握: 0, 部分掌握: 1, 已掌握: 2 };
  const kpProgress = [...kpMap.values()].map(k => {
    // 同一天可能有多条（重复提交），按日期去重取最后一条
    const byDate = new Map();
    for (const l of k.levels) byDate.set(l.date, l);
    const series = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    const first = series[0];
    const last = series[series.length - 1];
    const fromR = LEVEL_RANK[first.level] ?? 0;
    const toR = LEVEL_RANK[last.level] ?? 0;

    // 找出真正的跃迁点（用于里程碑），只记「向上」的提升
    const jumps = [];
    for (let i = 1; i < series.length; i++) {
      const a = LEVEL_RANK[series[i - 1].level] ?? 0;
      const b = LEVEL_RANK[series[i].level] ?? 0;
      if (b > a) jumps.push({ date: series[i].date, from: series[i - 1].level, to: series[i].level });
    }

    return {
      kpId: k.kpId,
      name: k.name,
      from: first.level,
      to: last.level,
      fromDate: first.date,
      toDate: last.date,
      delta: toR - fromR,
      attempts: series.length,
      jumps
    };
  }).sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));

  // 里程碑：取真实跃迁点（而非首末差值），这样才看得出「什么时候突破的」
  const milestones = [];
  for (const k of kpProgress) {
    for (const j of k.jumps) {
      milestones.push({
        date: j.date,
        title: `${k.name} 由「${j.from}」提升至「${j.to}」`,
        kind: "kp_progress"
      });
    }
  }
  // 另补「持续出勤」里程碑：连续 4 次课无缺勤且无迟到
  const attSorted = atts.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  let streak = 0;
  for (const a of attSorted) {
    if (a.payload.status === "正常") {
      streak++;
      if (streak > 0 && streak % 4 === 0) {
        milestones.push({
          date: a.date,
          title: `连续 ${streak} 次课全勤且按时到课`,
          kind: "attendance_streak"
        });
      }
    } else {
      streak = 0;
    }
  }
  milestones.sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    studentId: tl.studentId,
    range: { from: tl.from, to: tl.to },
    sessionCount: atts.length,
    attendance: {
      attended,
      absent,
      leave,
      rate: atts.length > 0 ? Math.round((attended / atts.length) * 1000) / 10 : null
    },
    evalTrend,
    evalDelta: firstEval && lastEval
      ? {
          focus: lastEval.focus - firstEval.focus,
          participation: lastEval.participation - firstEval.participation,
          mastery: lastEval.mastery - firstEval.mastery
        }
      : null,
    examSeries: examList.map(e => ({ date: e.date, name: e.payload.examName, rate: e.payload.rate })),
    kpProgress,
    milestones,
    // 事件明细分类计数：让「这一步有据可查」可被界面直接展示
    breakdown: {
      attendance: atts.length,
      exam: examList.length,
      classEval: evals.length,
      kpAssessment: kps.length,
      total: evals.length + kps.length + examList.length + atts.length
    },
    eventCount: tl.count,
    thresholds: t,
    dataVersion: `v${Number(db.prepare("PRAGMA user_version").get().user_version || 0)}`
  };
}

module.exports = {
  EVENT_TYPES,
  EVENT_LABELS,
  thresholds,
  appendEvent,
  studentTimeline,
  classGrowth,
  studentGrowth,
  scrubPayload
};
