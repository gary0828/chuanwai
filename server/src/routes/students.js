// 学生管理 CRUD + 批量导入/导出（纯档案管理，无账号概念）
// 数据权限：教师仅可见/管理自己绑定班级的学生；管理员不限
// v14：学生不登录、无账号；家长信息（姓名/电话）直接存于档案字段
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const {
  studentScopeWhere,
  canManageStudent,
  canManageClass
} = require("../utils/scope");
const {
  parseDate,
  parseText,
  isConstraintError,
  constraintMessage
} = require("../utils/validate");
const { paidNetSql } = require("../utils/money");
// ★ 统一分页钳制（2026-10-18 深度测试 P2-4）：page/pageSize 非法值不再 500 / 全表
const { clampPagination } = require("../utils/pagination");
// ★ 复用「已扣判定」的单一权威实现（勿在本文件另写一套：v29 事故的根因就是三处重复的扣课逻辑）
const {
  DEDUCT_STATUSES,
  DEDUCTED_EXISTS
} = require("../utils/hours-reconcile");
// ★ 删除守卫：自动发现「谁引用了这个学员」，不再硬编码表清单（2026-10-18 修复漏报）
const { scanReferences } = require("../utils/delete-guard");
const { audit } = require("../utils/audit");

const router = express.Router();

const GENDERS = ["男", "女"];
const STATUSES = ["在读", "休学", "退学"];
/** 姓名字段长度上限（防止 400 字符长名撑破表格与 CSV 导出） */
const MAX_NAME_LENGTH = 50;
/** 学号长度上限 */
const MAX_CODE_LENGTH = 32;

/** 学生列表（班级/姓名/学号/keyword 过滤 + 分页；教师仅本班）
 *
 *  v30 软删：默认只看「未删除」；`deleted=1` 只看已删除；`deleted=all` 全部。
 *  ★ 为什么默认隐藏而不分开两个接口：前端列表的筛选器是同一套，
 *    多一个接口就要多改一处列表状态与分页逻辑，容易漏。
 */
router.get("/", auth, (req, res) => {
  const {
    class_id,
    name = "",
    student_no = "",
    keyword = "",
    deleted = ""
  } = req.query;
  // P2-4：page/pageSize 统一钳制（pageSize 上限 200；非法值回落默认页，不再 500）
  const { pageSize: ps, offset } = clampPagination(req.query);
  const scope = studentScopeWhere(req);

  // ★ 参数顺序约定（2026-10-18 P1-2 修复）：SQL 里 `${where}${scope.where}` —— 过滤条件在前、
  //   scope 在后，因此参数数组也必须「先 push 所有过滤参数，最后再接 scope.params」。
  //   旧实现 params 以 [...scope.params] 开头，teacher 一旦带筛选条件就整体错位 → 恒空列表。
  let where = "WHERE 1=1";
  const params = [];
  if (deleted === "1") {
    where += " AND s.deleted_at IS NOT NULL";
  } else if (deleted === "all") {
    // 不追加条件：已删 + 未删都返回
  } else {
    where += " AND s.deleted_at IS NULL";
  }
  if (class_id) {
    where += " AND s.class_id = ?";
    params.push(Number(class_id));
  }
  if (name) {
    where += " AND s.name LIKE ?";
    params.push(`%${name}%`);
  }
  if (student_no) {
    where += " AND s.student_no LIKE ?";
    params.push(`%${student_no}%`);
  }
  if (keyword) {
    // 模糊匹配姓名或学号（用于学员搜索等场景）
    where += " AND (s.name LIKE ? OR s.student_no LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM students s ${where}${scope.where}`)
    .get(...params, ...scope.params).c;
  const list = db
    .prepare(
      `SELECT s.*, c.name AS class_name
       FROM students s LEFT JOIN classes c ON s.class_id = c.id
       ${where}${scope.where} ORDER BY s.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ...scope.params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 学生全量导出（与列表同筛选、不分页；供前端导出 Excel）
 *  v30：默认只导出未删除学员（与列表口径一致） */
router.get("/export", auth, (req, res) => {
  const { class_id, name = "", student_no = "", deleted = "" } = req.query;
  const scope = studentScopeWhere(req);

  // 参数顺序与 SQL `${where}${scope.where}` 一致：过滤参数在前、scope.params 在末尾（P1-2）
  let where = "WHERE 1=1";
  const params = [];
  if (deleted === "1") {
    where += " AND s.deleted_at IS NOT NULL";
  } else if (deleted !== "all") {
    where += " AND s.deleted_at IS NULL";
  }
  if (class_id) {
    where += " AND s.class_id = ?";
    params.push(Number(class_id));
  }
  if (name) {
    where += " AND s.name LIKE ?";
    params.push(`%${name}%`);
  }
  if (student_no) {
    where += " AND s.student_no LIKE ?";
    params.push(`%${student_no}%`);
  }

  const list = db
    .prepare(
      `SELECT s.student_no, s.name, s.gender, s.phone, s.email, c.name AS class_name, s.status,
              s.parent_name, s.parent_phone, s.source_channel, s.enroll_date
       FROM students s LEFT JOIN classes c ON s.class_id = c.id
       ${where}${scope.where} ORDER BY s.class_id, s.student_no`
    )
    .all(...params, ...scope.params);

  res.json({ success: true, data: { list } });
});

/** 学员档案（详情聚合）—— 基本信息 + 报班与账户 + 缴费退费 + 考勤与课时流水
 *
 *  ★ 剩余学费口径严格遵循 ADR-003（不可随意改动）：
 *      余额 = 实缴 × 剩余课时 ÷ 总课时     （逐单计算，再在学员层汇总）
 *      实缴 = SUM(payments) − SUM(已审批通过的 refunds)
 *    并回传 `formula` 字符串 —— ADR-003 的「影响」一节明确要求 UI 展示计算式，便于对账。
 *
 *  ★ 权限：teacher 只拿到课时与考勤，**金额字段一律为 null**（与 finance 模块
 *    「费用与业务运营内容一律不可见」的既定口径一致，见 routes/finance.js 头部注释）。
 */
router.get("/:id/profile", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "无效的学员 ID" });
  }
  if (!canManageStudent(req, id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权查看该学员档案" });
  }

  const student = db
    .prepare(
      `SELECT s.id, s.student_no, s.name, s.gender, s.phone, s.email, s.status,
              s.parent_name, s.parent_phone, s.source_channel, s.enroll_date, s.created_at,
              s.class_id, c.name AS class_name, u.name AS head_teacher_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN users u ON u.id = c.head_teacher_id
       WHERE s.id = ?`
    )
    .get(id);
  if (!student) {
    return res.status(404).json({ success: false, message: "学员不存在" });
  }

  const canSeeAmount = req.user.role === "admin";
  const round2 = n => Math.round(n * 100) / 100;

  // ── 报班订单：逐单算「已耗课时 / 剩余学费」，不做订单间摊平 ──────────
  const orders = db
    .prepare(
      `SELECT o.id, o.enroll_date, o.amount, o.total_hours, o.remain_hours, o.status, o.remark,
              c.name AS class_name, cu.name AS course_name,
              ${paidNetSql("o.id")} AS paid
       FROM orders o
       LEFT JOIN classes c ON c.id = o.class_id
       LEFT JOIN courses cu ON cu.id = o.course_id
       WHERE o.student_id = ?
       ORDER BY o.id DESC`
    )
    .all(id)
    .map(o => {
      const total = Number(o.total_hours || 0);
      const remain = Number(o.remain_hours || 0);
      // ★ 必须先 round2：SUM(amount) 是浮点累加，直接拼进 formula 会出现
      //   「实缴 1000.0100000000002 × …」这种给家长看会挨骂的数字
      const paid = round2(Number(o.paid || 0));
      const balance = total > 0 ? round2((paid * remain) / total) : 0;
      return {
        id: o.id,
        enroll_date: o.enroll_date,
        class_name: o.class_name,
        course_name: o.course_name,
        status: o.status,
        remark: o.remark,
        total_hours: total,
        remain_hours: remain,
        consumed_hours: Math.max(0, total - remain),
        amount: canSeeAmount ? Number(o.amount || 0) : null,
        paid: canSeeAmount ? paid : null,
        balance: canSeeAmount ? balance : null,
        consumed_amount: canSeeAmount ? round2(paid - balance) : null,
        formula: canSeeAmount
          ? `实缴 ${paid} × 剩余课时 ${remain} ÷ 总课时 ${total} = ${balance}`
          : null
      };
    });

  // ── 资金与课时汇总 ─────────────────────────────────────────────────
  // ★ 口径透明化（2026-10-12 用户实测反馈）：
  //   此前只返回「在读」口径 → 学员唯一订单若是退班，四张卡全是 0，
  //   而下方表格列的是**全部**订单（总 16 / 剩 16），两边数字自相矛盾，
  //   用户读成「这个学生没有信息」。
  //   现在**主口径仍是「在读」**（金额口径受 ADR-003 约束，不得放宽），
  //   同时**增补全量口径**字段供界面做对照说明 —— 原字段一律不改，向后兼容。
  const activeOrders = orders.filter(o => o.status === "在读");
  const closedOrders = orders.filter(o => o.status !== "在读");
  const sum = (arr, k) => arr.reduce((s, o) => s + Number(o[k] || 0), 0);
  const hoursScope = {
    total_hours: sum(activeOrders, "total_hours"),
    remain_hours: sum(activeOrders, "remain_hours"),
    consumed_hours: sum(activeOrders, "consumed_hours"),
    // 全量口径（含结业/退班），仅作对照参考
    total_hours_all: sum(orders, "total_hours"),
    remain_hours_all: sum(orders, "remain_hours"),
    consumed_hours_all: sum(orders, "consumed_hours"),
    active_order_count: activeOrders.length,
    closed_order_count: closedOrders.length
  };

  let summary;
  if (canSeeAmount) {
    const paidTotal = Number(
      db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE student_id = ?"
        )
        .get(id).s
    );
    const refundedTotal = Number(
      db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS s FROM refunds WHERE student_id = ? AND status = '通过'"
        )
        .get(id).s
    );
    summary = {
      paid_total: round2(paidTotal),
      refunded_total: round2(refundedTotal),
      net_paid: round2(paidTotal - refundedTotal),
      order_amount_total: round2(
        orders.reduce((s, o) => s + Number(o.amount || 0), 0)
      ),
      // 汇总口径：只统计「在读」订单的余额（结业/退班的课时包已失效）
      balance_total: round2(sum(activeOrders, "balance")),
      balance_total_all: round2(sum(orders, "balance")),
      ...hoursScope
    };
  } else {
    // teacher：只给课时（不含任何金额）
    summary = {
      paid_total: null,
      refunded_total: null,
      net_paid: null,
      order_amount_total: null,
      balance_total: null,
      balance_total_all: null,
      ...hoursScope
    };
  }

  // ── 考勤明细（含「该次课时是否已扣」）────────────────────────────────
  // ★ 为什么要有这一块：用户实测反馈「学生明明耗课了，档案里却没有信息」。
  //   考勤页签此前只给「累计 N 次 + 状态计数」，看不出**哪一次没扣课时**。
  //   已扣判定**复用 hours-reconcile 的单一权威片段**，不另写第二套口径。
  const attendances = db
    .prepare(
      `SELECT a.id, a.date, a.status, a.remark, a.created_at, a.session_id,
              a.course_id, cu.name AS course_name,
              cs.period, cs.start_time, cs.end_time,
              CASE WHEN ${DEDUCTED_EXISTS} THEN 1 ELSE 0 END AS deducted
       FROM attendances a
       LEFT JOIN courses cu ON cu.id = a.course_id
       LEFT JOIN class_sessions cs ON cs.id = a.session_id
       WHERE a.student_id = ?
       ORDER BY a.date DESC, a.id DESC`
    )
    .all(id)
    .map(a => {
      const should = DEDUCT_STATUSES.includes(a.status);
      const deducted = Number(a.deducted) || 0;
      return {
        ...a,
        should_deduct: should ? 1 : 0,
        deducted,
        // 三个状态互斥、可直接展示：出勤类应扣 → 已扣 / 欠扣；缺勤·请假 → 无需扣
        deduct_state: !should ? "无需扣" : deducted ? "已扣" : "欠扣"
      };
    });

  // ── 考勤统计（按状态计数，保留原字段）──────────────────────────────
  const attendanceStats = attendances.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  // ── 课时流水（最近 100 条）─────────────────────────────────────────
  // attendance_id / session_id 是 v29 新增的**可追溯字段**：出问题时能定位到
  // 「哪次考勤 / 哪节课」产生了这条流水，故一并回传。
  const consumptions = db
    .prepare(
      `SELECT hc.id, hc.order_id, hc.date, hc.hours, hc.type, hc.source,
              hc.attendance_id, hc.session_id,
              cu.name AS course_name
       FROM hour_consumptions hc
       LEFT JOIN courses cu ON cu.id = hc.course_id
       WHERE hc.student_id = ?
       ORDER BY hc.date DESC, hc.id DESC LIMIT 100`
    )
    .all(id);

  res.json({
    success: true,
    data: {
      student,
      can_see_amount: canSeeAmount,
      orders,
      summary,
      attendance_stats: attendanceStats,
      attendances,
      // 欠扣条数 —— 供界面直接给「去课时对账」的引导（静默即缺陷）
      pending_deduct_count: attendances.filter(a => a.deduct_state === "欠扣")
        .length,
      consumptions
    }
  });
});

/** 新增学生（admin / teacher；教师只能分配到本班；家长信息与来源渠道随档案录入） */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const {
    student_no,
    name,
    gender = "男",
    phone = "",
    email = "",
    class_id,
    status = "在读",
    parent_name = "",
    parent_phone = "",
    source_channel = "",
    enroll_date = ""
  } = req.body || {};
  if (!student_no || !name || !class_id) {
    return res
      .status(400)
      .json({ success: false, message: "学号、姓名、班级为必填项" });
  }
  if (!GENDERS.includes(gender) || !STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ success: false, message: "性别或学籍状态不合法" });
  }
  if (!canManageClass(req, class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权将学生分配到该班级" });
  }
  // 边界校验（2026-09-12 全面测试发现：日期与长度此前未校验）
  const nameRes = parseText(name, {
    field: "姓名",
    max: MAX_NAME_LENGTH,
    required: true
  });
  if (!nameRes.ok)
    return res.status(400).json({ success: false, message: nameRes.message });
  const noRes = parseText(student_no, {
    field: "学号",
    max: MAX_CODE_LENGTH,
    required: true
  });
  if (!noRes.ok)
    return res.status(400).json({ success: false, message: noRes.message });
  const enrollRes = parseDate(enroll_date, {
    field: "报名日期",
    required: false
  });
  if (!enrollRes.ok)
    return res.status(400).json({ success: false, message: enrollRes.message });
  try {
    db.exec("BEGIN");
    try {
      const result = db
        .prepare(
          "INSERT INTO students (student_no, name, gender, phone, email, class_id, status, parent_name, parent_phone, source_channel, enroll_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          noRes.value,
          nameRes.value,
          gender,
          String(phone ?? ""),
          String(email ?? ""),
          Number(class_id),
          status,
          String(parent_name ?? ""),
          String(parent_phone ?? ""),
          String(source_channel ?? ""),
          enrollRes.value
        );
      db.exec("COMMIT");
      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "学号已存在" });
    }
    throw err;
  }
});

/** 批量导入学生（前端解析 Excel 后提交 JSON 数组；逐条返回成败明细） */
router.post("/import", auth, requireRole("admin", "teacher"), (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "请先选择要导入的数据" });
  }

  const insert = db.prepare(
    "INSERT INTO students (student_no, name, gender, phone, email, class_id, status, parent_name, parent_phone, source_channel, enroll_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const fails = [];
  let successCount = 0;
  const existing = new Set(
    db
      .prepare("SELECT student_no FROM students")
      .all()
      .map(r => r.student_no)
  );

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const line = row.__line || i + 1;
    const {
      student_no,
      name,
      gender = "男",
      phone = "",
      email = "",
      class_id,
      status = "在读",
      parent_name = "",
      parent_phone = "",
      source_channel = "",
      enroll_date = ""
    } = row;
    let reason = "";
    if (!student_no || !name || !class_id) reason = "学号、姓名、班级为必填项";
    else if (!GENDERS.includes(gender)) reason = "性别不合法（男/女）";
    else if (!STATUSES.includes(status))
      reason = "学籍状态不合法（在读/休学/退学）";
    else if (!canManageClass(req, class_id)) reason = "无权分配到该班级";
    else if (existing.has(String(student_no))) reason = "学号已存在";
    if (reason) {
      fails.push({ line, student_no, name, reason });
      continue;
    }
    // 服务端补校（2026-09-12 全面测试发现）：日期与字符串长度不可直接信任客户端
    const enrollRes = parseDate(enroll_date, {
      field: "报名日期",
      required: false
    });
    if (!enrollRes.ok) {
      fails.push({ line, student_no, name, reason: enrollRes.message });
      continue;
    }
    const nameRes = parseText(name, {
      field: "姓名",
      max: MAX_NAME_LENGTH,
      required: true
    });
    if (!nameRes.ok) {
      fails.push({ line, student_no, name, reason: nameRes.message });
      continue;
    }
    const noRes = parseText(student_no, {
      field: "学号",
      max: MAX_CODE_LENGTH,
      required: true
    });
    if (!noRes.ok) {
      fails.push({ line, student_no, name, reason: noRes.message });
      continue;
    }
    try {
      db.exec("BEGIN");
      try {
        // 注意：列数与绑定值必须一一对应（11 列 / 11 个值）
        insert.run(
          noRes.value,
          nameRes.value,
          gender,
          String(phone ?? ""),
          String(email ?? ""),
          Number(class_id),
          status,
          String(parent_name ?? ""),
          String(parent_phone ?? ""),
          String(source_channel ?? ""),
          enrollRes.value
        );
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      existing.add(String(student_no));
      successCount++;
    } catch (err) {
      fails.push({
        line,
        student_no,
        name,
        reason: isConstraintError(err)
          ? constraintMessage(err)
          : "写入失败，请检查该行数据后重试"
      });
    }
  }

  res.json({
    success: true,
    data: {
      total: records.length,
      successCount,
      failCount: fails.length,
      fails
    }
  });
});

/** 修改学生（admin / teacher，仅可改本班学生；教师只能分配到本班；转班联动订单） */
router.put("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const {
    student_no,
    name,
    gender,
    phone,
    email,
    class_id,
    status,
    parent_name,
    parent_phone,
    source_channel,
    enroll_date
  } = req.body || {};
  if (!student_no || !name || !class_id) {
    return res
      .status(400)
      .json({ success: false, message: "学号、姓名、班级为必填项" });
  }
  if (!canManageStudent(req, id)) {
    return res.status(403).json({ success: false, message: "无权管理该学生" });
  }
  if (!canManageClass(req, class_id)) {
    return res
      .status(403)
      .json({ success: false, message: "无权将学生分配到该班级" });
  }
  try {
    db.exec("BEGIN");
    try {
      const cur = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
      if (!cur) {
        db.exec("ROLLBACK");
        return res.status(404).json({ success: false, message: "学生不存在" });
      }
      db.prepare(
        "UPDATE students SET student_no = ?, name = ?, gender = ?, phone = ?, email = ?, class_id = ?, status = ?, parent_name = ?, parent_phone = ?, source_channel = ?, enroll_date = ? WHERE id = ?"
      ).run(
        student_no,
        name,
        gender ?? cur.gender, // 缺省字段复用原值，避免 undefined 绑定失败（node:sqlite）
        phone ?? cur.phone,
        email ?? cur.email,
        Number(class_id),
        status ?? cur.status,
        parent_name ?? cur.parent_name,
        parent_phone ?? cur.parent_phone,
        source_channel ?? cur.source_channel,
        enroll_date ?? cur.enroll_date,
        id
      );
      // 转班联动：**在读**订单的班级跟随（新班级的剩余课时预警 / 报班列表要能看到他）。
      //
      // ★ 2026-10-18 复核结论：这里只改「在读」订单，**不改历史业绩**——
      //   课消统计（finance/stats/consumption 的 teacher 维度）已改为按
      //   `hour_consumptions.class_id`（写入时的班级快照）归属，
      //   所以转班不会把原班已发生的课消挪到新班。
      //   两处必须配对理解：改这里之前先确认那条统计口径没被改回去。
      if (Number(class_id) !== cur.class_id) {
        db.prepare(
          "UPDATE orders SET class_id = ?, updated_at = datetime('now','localtime') WHERE student_id = ? AND status = '在读'"
        ).run(Number(class_id), id);
      }
      db.exec("COMMIT");
      res.json({ success: true, data: null });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "学号已存在" });
    }
    throw err;
  }
});

/** 删除学生（admin / teacher，仅可删本班学生；级联删除历史业务记录）
 *  删除策略（v30 起 **软删**）：有订单（财务记录）→ 400 保护；其余不再级联清理，
 *  只把 `deleted_at` 置位，历史数据全部保留（可恢复）。
 */
/**
 * 统计某学员关联的历史数据（自动发现，不再硬编码清单）。
 *
 * ★ 2026-10-18 修复：原实现写死 6 张表，而 students 实际被 13 张表引用
 *   （漏了 class_evaluations / kp_assessments / student_timeline），
 *   导致「删除前预览」少报 3 类数据。改用 delete-guard 的自动发现后，
 *   今后迁移新增外键无需再回来改这里。
 */
function buildRelatedImpact(id) {
  return scanReferences("students", id);
}

/**
 * ★ 2026-09-26 新增：删除前预览影响
 * 背景：原先"将级联删除多少历史数据"只在 **DELETE 的响应里**返回 —— 也就是用户
 * 删完才知道删了什么，确认框只有一句写死的文案（见 students/index.vue 的旧实现）。
 *
 * v30 语义变更：删除已改为**软删**，这些数据**不会被删**，仅作「关联情况」展示。
 * 前端据此把确认文案从"将删除 N 条"改为"档案将被移入已删除，历史数据保留"。
 */
router.get(
  "/:id/delete-impact",
  auth,
  requireRole("admin", "teacher"),
  (req, res) => {
    const id = Number(req.params.id);
    if (!canManageStudent(req, id)) {
      return res
        .status(403)
        .json({ success: false, message: "无权管理该学生" });
    }
    const student = db
      .prepare(
        "SELECT id, name, student_no, deleted_at FROM students WHERE id = ?"
      )
      .get(id);
    if (!student) {
      return res.status(404).json({ success: false, message: "学生不存在" });
    }
    const orderCount = db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE student_id = ?")
      .get(id).c;
    const related = buildRelatedImpact(id);
    res.json({
      success: true,
      data: {
        student,
        // v30：保留 `cascade` 字段名以免前端报错，但语义已变为「关联数据条数（不会被删）」
        cascade: Object.fromEntries(related.map(i => [i.label, i.count])),
        related,
        orderCount,
        softDelete: true,
        alreadyDeleted: !!student.deleted_at,
        // 软删不再受订单阻挡（数据都保留），恒为 false；保留字段兼容旧前端
        blocked: false
      }
    });
  }
);

/**
 * 删除学员 —— **软删**（v30）
 *
 * ★ 为什么从硬删改成软删（2026-10-18 用户拍板）：
 *   硬删会按外键 CASCADE 连带清空考勤、请假、补课、课时流水、通知、考试成绩、
 *   课堂评价、知识点测评、成长档案。教务数据通常要留档，
 *   删掉之后"这个孩子以前上过什么课"永久查不到，且无法撤销。
 *
 * ★ 为什么仍有「有订单就拦」：
 *   有未结清订单说明还在履约中，先处理订单再归档是业务顺序问题，与数据安全无关。
 */
router.delete("/:id", auth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  if (!canManageStudent(req, id)) {
    return res.status(403).json({ success: false, message: "无权管理该学生" });
  }
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
  if (!student) {
    return res.status(404).json({ success: false, message: "学生不存在" });
  }
  if (student.deleted_at) {
    return res.status(400).json({
      success: false,
      message: "该学员已在「已删除」中，无需重复删除"
    });
  }
  const orders = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE student_id = ?")
    .get(id).c;
  if (orders > 0) {
    return res.status(400).json({
      success: false,
      message: "该学员存在报班/缴费/退费记录，请先处理相关订单"
    });
  }
  db.prepare(
    "UPDATE students SET deleted_at = datetime('now','localtime') WHERE id = ?"
  ).run(id);
  audit(
    req.user,
    "删除学员档案",
    `学员#${id} ${student.name}（软删，历史数据保留）`
  );
  res.json({
    success: true,
    data: { softDeleted: true, related: buildRelatedImpact(id) }
  });
});

/**
 * 恢复已删除的学员（v30）
 * 仅 admin —— 恢复会让档案重新出现在列表、下拉与点名名单里，属于管理动作。
 */
router.post("/:id/restore", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const student = db
    .prepare("SELECT id, name, deleted_at FROM students WHERE id = ?")
    .get(id);
  if (!student)
    return res.status(404).json({ success: false, message: "学生不存在" });
  if (!student.deleted_at) {
    return res
      .status(400)
      .json({ success: false, message: "该学员未被删除，无需恢复" });
  }
  db.prepare("UPDATE students SET deleted_at = NULL WHERE id = ?").run(id);
  audit(req.user, "恢复学员档案", `学员#${id} ${student.name}`);
  res.json({ success: true, data: null });
});

module.exports = router;
