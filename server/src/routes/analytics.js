// AI 分析预留端点（Analytics）
// 用途：为后续「AI 经营分析 / 批量数据导出」提供统一、稳定、可解析的数据出口。
// 权限：JWT 认证 + 仅 admin 可访问（含导出，避免教师越权获取全量经营数据）。
// 约定：
//   - 统一响应信封：{ data: { metrics, records, meta }, metric_definitions }
//   - meta.data_version 取自 PRAGMA user_version（与数据库迁移版本一致，当前 v14）
//   - 导出端点支持 ?format=json（默认）| csv（带 BOM，Excel 直接打开不乱码）
//   - 全部查询为只读，事务外执行，不影响业务写入
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { attendanceRate, absentRate } = require("../utils/attendance-rate");

const router = express.Router();

// 所有端点统一要求登录 + admin
router.use(auth, requireRole("admin"));

/** 当前数据库版本（与 server/database.md 的版本历史对应） */
function dataVersion() {
  const row = db.prepare("PRAGMA user_version").get();
  return `v${Number(row.user_version || 0)}`;
}

/** 解析 [?start=YYYY-MM-DD&end=YYYY-MM-DD] 时间范围 */
function parsePeriod(query) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(query.start || "") ? query.start : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(query.end || "") ? query.end : null;
  return { start, end };
}

/**
 * 指标定义字典（AI 解析用）：
 * 每个指标声明 名称 / 计算公式 / 数据来源表 / 单位，便于下游自动解释口径。
 */
const METRIC_DEFINITIONS = {
  attendance_rate: {
    name: "出勤率",
    formula: "(应到总数 − 缺勤) / 应到总数",
    note: "★ 2026-09-26 口径统一：请假计入分母且不计为缺勤（请假不拉低出勤率）。此前本端点用「实到 /(总数−请假)」，与统计报表数字对不上，已废除。实现见 utils/attendance-rate.js",
    source_table: "attendances",
    unit: "百分比"
  },
  absent_rate: {
    name: "缺勤率",
    formula: "缺勤 / 应到总数",
    note: "与出勤率同分母，故 出勤率 + 缺勤率 = 100%；请假率是与之重叠的独立维度，不可再与两者相加",
    source_table: "attendances",
    unit: "百分比"
  },
  student_total: {
    name: "学员总数",
    formula: "COUNT(students)",
    source_table: "students",
    unit: "人"
  },
  student_active: {
    name: "在读学员数",
    formula: "COUNT(orders WHERE status = '在读') 去重学员",
    source_table: "orders",
    unit: "人"
  },
  active_rate: {
    name: "在读率",
    formula: "在读学员数 / 学员总数",
    source_table: "students, orders",
    unit: "百分比"
  },
  revenue_total: {
    name: "实收金额",
    formula: "SUM(payments.amount) - SUM(refunds.amount WHERE status = '通过')",
    source_table: "payments, refunds",
    unit: "元"
  },
  lead_total: {
    name: "线索总数",
    formula: "COUNT(leads)",
    source_table: "leads",
    unit: "条"
  },
  lead_converted: {
    name: "线索转化数",
    formula: "COUNT(leads WHERE status = '已转化')",
    source_table: "leads",
    unit: "条"
  },
  lead_conversion_rate: {
    name: "线索转化率",
    formula: "转化数 / 线索总数",
    source_table: "leads",
    unit: "百分比"
  },
  hours_consumed: {
    name: "净消耗课时",
    formula: "SUM(hours WHERE type='扣减') - SUM(hours WHERE type='回补')",
    source_table: "hour_consumptions",
    unit: "课时"
  },
  exam_average: {
    name: "考试平均分",
    formula: "AVG(exam_scores.score)",
    source_table: "exam_scores",
    unit: "分"
  },
  score_excellent_rate: {
    name: "优秀率",
    formula: "得分率 ≥ 90% 的成绩数 / 成绩总数",
    source_table: "exam_scores, exams",
    unit: "百分比"
  }
};

/** 统一信封 */
function envelope({ records = [], metrics = {}, period = {}, extraMeta = {} }) {
  return {
    data: {
      metrics,
      records,
      meta: {
        generated_at: new Date().toISOString(),
        period: { start: period.start || null, end: period.end || null },
        total_count: records.length,
        data_version: dataVersion(),
        ...extraMeta
      }
    },
    metric_definitions: METRIC_DEFINITIONS
  };
}

/** 数组 → CSV 文本（带 UTF-8 BOM，Excel 可直接打开） */
function toCsv(rows, columns) {
  // 空数据时也要输出表头：导出的 CSV 至少得让人知道有哪些列（也方便当导入模板用）。
  // 此时无法从首行推断列名，因此由 DATASETS 显式声明 columns。
  const headers =
    columns && columns.length
      ? columns
      : rows.length
        ? Object.keys(rows[0])
        : [];
  if (!headers.length) return "\uFEFF";
  const escape = v => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => escape(r[h])).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

/** 按 format 输出：json（默认）或 csv */
function respond(req, res, payload, filename, columns) {
  if ((req.query.format || "").toLowerCase() === "csv") {
    const rows = payload.data.records;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    return res.send(toCsv(rows, columns));
  }
  return res.json({ success: true, ...payload });
}

/** 分值 → 等级（与成绩单口径一致：≥90% 优 / ≥80% 良 / ≥70% 中 / ≥60% 及格） */
function calcLevel(score, fullScore) {
  const ratio = fullScore > 0 ? score / fullScore : 0;
  if (ratio >= 0.9) return "优";
  if (ratio >= 0.8) return "良";
  if (ratio >= 0.7) return "中";
  if (ratio >= 0.6) return "及格";
  return "不及格";
}

// ---------------------------------------------------------------------------
// GET /api/analytics/metrics —— 指标定义字典
// ---------------------------------------------------------------------------
router.get("/metrics", (_req, res) => {
  res.json({
    success: true,
    data: {
      metrics: {},
      records: [],
      meta: {
        generated_at: new Date().toISOString(),
        period: { start: null, end: null },
        total_count: 0,
        data_version: dataVersion(),
        metric_count: Object.keys(METRIC_DEFINITIONS).length
      }
    },
    metric_definitions: METRIC_DEFINITIONS
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/overview —— 全局经营概览
// ---------------------------------------------------------------------------
router.get("/overview", (req, res) => {
  const period = parsePeriod(req.query);
  const range = { start: period.start, end: period.end };

  // 学员 / 班级
  const studentTotal = Number(
    db.prepare("SELECT COUNT(*) AS n FROM students").get().n || 0
  );
  const classTotal = Number(
    db.prepare("SELECT COUNT(*) AS n FROM classes").get().n || 0
  );
  const activeStudents = Number(
    db.prepare("SELECT COUNT(DISTINCT student_id) AS n FROM orders WHERE status = '在读'").get().n || 0
  );

  // 考勤（受 period 过滤）
  const attWhere = [];
  const attParams = [];
  if (period.start) { attWhere.push("date(date) >= date(?)"); attParams.push(period.start); }
  if (period.end) { attWhere.push("date(date) <= date(?)"); attParams.push(period.end); }
  const attSql = `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status IN ('正常','迟到','早退') THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN status = '缺勤' THEN 1 ELSE 0 END) AS absent,
           SUM(CASE WHEN status = '请假' THEN 1 ELSE 0 END) AS leave_cnt
    FROM attendances
    ${attWhere.length ? "WHERE " + attWhere.join(" AND ") : ""}
  `;
  const att = db.prepare(attSql).get(...attParams);
  const attTotal = Number(att.total || 0);
  const attPresent = Number(att.present || 0);
  const attAbsent = Number(att.absent || 0);
  // ★ 口径统一（2026-09-26）：出勤率/缺勤率一律用「应到总数」作分母（请假计入），
  //   与 attendance.js / reports.js 完全一致。此前这里剔除了请假 → 同一指标跨页面数字对不上。
  //   attPresent 仅作为明细字段返回，不再参与比率计算。

  // 财务（受 period 过滤）
  const payWhere = [];
  const payParams = [];
  if (period.start) { payWhere.push("date(pay_time) >= date(?)"); payParams.push(period.start); }
  if (period.end) { payWhere.push("date(pay_time) <= date(?)"); payParams.push(period.end); }
  const income =
    Number(
      db.prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM payments ${payWhere.length ? "WHERE " + payWhere.join(" AND ") : ""}`
      ).get(...payParams).s || 0
    ) || 0;

  const refWhere = ["status = '通过'"];
  const refParams = [];
  if (period.start) { refWhere.push("date(COALESCE(approve_time, apply_time, created_at)) >= date(?)"); refParams.push(period.start); }
  if (period.end) { refWhere.push("date(COALESCE(approve_time, apply_time, created_at)) <= date(?)"); refParams.push(period.end); }
  const refunded =
    Number(
      db.prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM refunds WHERE ${refWhere.join(" AND ")}`
      ).get(...refParams).s || 0
    ) || 0;

  // 招生线索（受 period 过滤，按创建时间）
  const leadWhere = [];
  const leadParams = [];
  if (period.start) { leadWhere.push("date(created_at) >= date(?)"); leadParams.push(period.start); }
  if (period.end) { leadWhere.push("date(created_at) <= date(?)"); leadParams.push(period.end); }
  const leadSql = `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = '已转化' THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN status = '已流失' THEN 1 ELSE 0 END) AS lost
    FROM leads
    ${leadWhere.length ? "WHERE " + leadWhere.join(" AND ") : ""}
  `;
  const lead = db.prepare(leadSql).get(...leadParams);
  const leadTotal = Number(lead.total || 0);
  const leadConverted = Number(lead.converted || 0);

  // 课时消耗（受 period 过滤）
  const hcWhere = [];
  const hcParams = [];
  if (period.start) { hcWhere.push("date(date) >= date(?)"); hcParams.push(period.start); }
  if (period.end) { hcWhere.push("date(date) <= date(?)"); hcParams.push(period.end); }
  const hc = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='扣减' THEN hours ELSE -hours END),0) AS net
       FROM hour_consumptions ${hcWhere.length ? "WHERE " + hcWhere.join(" AND ") : ""}`
    )
    .get(...hcParams);

  // 成绩（受 period 过滤，按考试日期）
  const scWhere = [];
  const scParams = [];
  if (period.start) { scWhere.push("date(e.exam_date) >= date(?)"); scParams.push(period.start); }
  if (period.end) { scWhere.push("date(e.exam_date) <= date(?)"); scParams.push(period.end); }
  const sc = db
    .prepare(
      `SELECT COUNT(*) AS total, AVG(sc.score) AS avg_score,
              SUM(CASE WHEN e.full_score > 0 AND sc.score * 1.0 / e.full_score >= 0.9 THEN 1 ELSE 0 END) AS excellent
       FROM exam_scores sc JOIN exams e ON e.id = sc.exam_id
       ${scWhere.length ? "WHERE " + scWhere.join(" AND ") : ""}`
    )
    .get(...scParams);
  const scTotal = Number(sc.total || 0);

  const pct = (a, b) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : 0);

  const metrics = {
    student_total: studentTotal,
    student_active: activeStudents,
    active_rate: pct(activeStudents, studentTotal),
    class_total: classTotal,
    attendance_total: attTotal,
    attendance_present: attPresent,
    attendance_absent: attAbsent,
    attendance_leave: Number(att.leave_cnt || 0),
    attendance_rate: attendanceRate(attTotal, attAbsent),
    absent_rate: absentRate(attTotal, attAbsent),
    revenue_income: Number(income.toFixed(2)),
    revenue_refunded: Number(refunded.toFixed(2)),
    revenue_total: Number((income - refunded).toFixed(2)),
    lead_total: leadTotal,
    lead_converted: leadConverted,
    lead_lost: Number(lead.lost || 0),
    lead_conversion_rate: pct(leadConverted, leadTotal),
    hours_consumed: Number(Number(hc.net || 0).toFixed(2)),
    exam_score_total: scTotal,
    exam_average: sc.total ? Number(Number(sc.avg_score || 0).toFixed(2)) : 0,
    score_excellent_rate: pct(Number(sc.excellent || 0), scTotal)
  };

  // 近 12 个月营收走势（月度，供 AI 趋势分析）
  const revenueTrend = db
    .prepare(
      `SELECT strftime('%Y-%m', pay_time) AS month,
              ROUND(SUM(amount), 2) AS amount,
              COUNT(*) AS count
       FROM payments
       WHERE date(pay_time) >= date('now', 'localtime', 'start of month', '-11 months')
       GROUP BY month ORDER BY month`
    )
    .all();

  // 渠道转化分布
  const channelStats = db
    .prepare(
      `SELECT source,
              COUNT(*) AS total,
              SUM(CASE WHEN status = '已转化' THEN 1 ELSE 0 END) AS converted
       FROM leads GROUP BY source ORDER BY total DESC`
    )
    .all()
    .map(r => ({
      source: r.source,
      total: Number(r.total || 0),
      converted: Number(r.converted || 0),
      conversion_rate: pct(Number(r.converted || 0), Number(r.total || 0))
    }));

  res.json({
    success: true,
    ...envelope({
      metrics,
      records: [],
      period,
      extraMeta: { revenue_trend: revenueTrend, channel_stats: channelStats }
    })
  });
});

// ---------------------------------------------------------------------------
// 数据集注册表：导出端点共用（新增数据集只需在此登记）
// ---------------------------------------------------------------------------
const DATASETS = {
  attendance: {
    label: "考勤明细",
    columns: [
      "id",
      "date",
      "student_no",
      "student_name",
      "class_name",
      "course_name",
      "status",
      "remark",
      "created_at",
      "updated_at"
    ],
    build(period) {
      const where = [];
      const params = [];
      if (period.start) { where.push("date(a.date) >= date(?)"); params.push(period.start); }
      if (period.end) { where.push("date(a.date) <= date(?)"); params.push(period.end); }
      const sql = `
        SELECT a.id, a.date, s.student_no, s.name AS student_name,
               cl.name AS class_name, c.name AS course_name,
               a.status, a.remark, a.created_at, a.updated_at
        FROM attendances a
        JOIN students s ON s.id = a.student_id
        LEFT JOIN classes cl ON cl.id = s.class_id
        LEFT JOIN courses c ON c.id = a.course_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY a.date DESC, a.id DESC LIMIT 20000
      `;
      return db.prepare(sql).all(...params);
    }
  },
  finance: {
    label: "财务流水",
    columns: [
      "time",
      "type",
      "student_no",
      "student_name",
      "class_name",
      "amount",
      "method",
      "remark"
    ],
    build(period) {
      const rows = [];
      const payWhere = [];
      const payParams = [];
      if (period.start) { payWhere.push("date(p.pay_time) >= date(?)"); payParams.push(period.start); }
      if (period.end) { payWhere.push("date(p.pay_time) <= date(?)"); payParams.push(period.end); }
      const pays = db
        .prepare(
          `SELECT p.pay_time AS time, '缴费' AS type, s.student_no, s.name AS student_name,
                  cl.name AS class_name, p.amount, p.pay_method AS method, p.remark
           FROM payments p
           JOIN students s ON s.id = p.student_id
           LEFT JOIN orders o ON o.id = p.order_id
           LEFT JOIN classes cl ON cl.id = o.class_id
           ${payWhere.length ? "WHERE " + payWhere.join(" AND ") : ""}
           ORDER BY p.pay_time DESC LIMIT 20000`
        )
        .all(...payParams);
      rows.push(...pays);

      const refWhere = [];
      const refParams = [];
      if (period.start) { refWhere.push("date(COALESCE(r.approve_time, r.apply_time, r.created_at)) >= date(?)"); refParams.push(period.start); }
      if (period.end) { refWhere.push("date(COALESCE(r.approve_time, r.apply_time, r.created_at)) <= date(?)"); refParams.push(period.end); }
      const refs = db
        .prepare(
          `SELECT COALESCE(r.approve_time, r.apply_time, r.created_at) AS time,
                  '退费(' || r.status || ')' AS type, s.student_no, s.name AS student_name,
                  cl.name AS class_name, (0 - r.amount) AS amount, '' AS method, r.reason AS remark
           FROM refunds r
           JOIN students s ON s.id = r.student_id
           LEFT JOIN orders o ON o.id = r.order_id
           LEFT JOIN classes cl ON cl.id = o.class_id
           ${refWhere.length ? "WHERE " + refWhere.join(" AND ") : ""}
           ORDER BY time DESC LIMIT 20000`
        )
        .all(...refParams);
      rows.push(...refs);
      return rows
        .sort((x, y) => String(y.time || "").localeCompare(String(x.time || "")))
        .map(r => ({ ...r, amount: Number(r.amount || 0) }));
    }
  },
  leads: {
    label: "招生线索",
    columns: [
      "id",
      "name",
      "phone",
      "intent_course",
      "source",
      "status",
      "follow_user",
      "converted_student_no",
      "remark",
      "created_at",
      "updated_at",
      "follow_count"
    ],
    build(period) {
      const where = [];
      const params = [];
      if (period.start) { where.push("date(l.created_at) >= date(?)"); params.push(period.start); }
      if (period.end) { where.push("date(l.created_at) <= date(?)"); params.push(period.end); }
      const sql = `
        SELECT l.id, l.name, l.phone, c.name AS intent_course, l.source, l.status,
               u.name AS follow_user, s.student_no AS converted_student_no,
               l.follow_records, l.remark, l.created_at, l.updated_at
        FROM leads l
        LEFT JOIN courses c ON c.id = l.intent_course_id
        LEFT JOIN users u ON u.id = l.follow_user_id
        LEFT JOIN students s ON s.id = l.converted_student_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY l.created_at DESC LIMIT 20000
      `;
      return db.prepare(sql).all(...params).map(r => {
        let followCount = 0;
        try {
          const arr = JSON.parse(r.follow_records || "[]");
          followCount = Array.isArray(arr) ? arr.length : 0;
        } catch {
          followCount = 0;
        }
        const { follow_records: _raw, ...rest } = r;
        return { ...rest, follow_count: followCount };
      });
    }
  },
  scores: {
    label: "考试成绩",
    columns: [
      "exam_name",
      "exam_date",
      "exam_type",
      "full_score",
      "class_name",
      "course_name",
      "student_no",
      "student_name",
      "score",
      "remark",
      "level"
    ],
    build(period) {
      const where = [];
      const params = [];
      if (period.start) { where.push("date(e.exam_date) >= date(?)"); params.push(period.start); }
      if (period.end) { where.push("date(e.exam_date) <= date(?)"); params.push(period.end); }
      const sql = `
        SELECT e.name AS exam_name, e.exam_date, e.type AS exam_type, e.full_score,
               cl.name AS class_name, c.name AS course_name,
               s.student_no, s.name AS student_name, sc.score, sc.remark
        FROM exam_scores sc
        JOIN exams e ON e.id = sc.exam_id
        JOIN students s ON s.id = sc.student_id
        LEFT JOIN classes cl ON cl.id = e.class_id
        LEFT JOIN courses c ON c.id = e.course_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY e.exam_date DESC, sc.score DESC LIMIT 20000
      `;
      return db
        .prepare(sql)
        .all(...params)
        .map(r => ({ ...r, level: calcLevel(Number(r.score || 0), Number(r.full_score || 0)) }));
    }
  }
};

// ---------------------------------------------------------------------------
// GET /api/analytics/:dataset/export —— 批量导出（attendance/finance/leads/scores）
// ---------------------------------------------------------------------------
router.get("/:dataset/export", (req, res) => {
  const ds = DATASETS[req.params.dataset];
  if (!ds) {
    return res.status(404).json({
      success: false,
      message: `不支持的数据集：${req.params.dataset}`,
      data: { supported: Object.keys(DATASETS) }
    });
  }
  const period = parsePeriod(req.query);
  const records = ds.build(period);

  // 按 format=csv 输出附件；否则返回统一信封 JSON
  respond(
    req,
    res,
    envelope({ records, period, extraMeta: { dataset: req.params.dataset, dataset_label: ds.label } }),
    `analytics-${req.params.dataset}`,
    ds.columns
  );
});

module.exports = router;
