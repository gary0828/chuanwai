// 待办自动生成器（L3）
//
// ─────────────────────────────────────────────────────────────────────────────
// ★★ 核心设计：**待办的 owner 由「事件类型」决定，绝不是"生成给所有人"**
//
//   4 类事件的敏感度差别极大，无差别生成会把**财务与招生数据泄漏到工作台**：
//
//   | 事件              | 收件人         | 老师可见 | 依据 |
//   |-------------------|---------------|---------|------|
//   | 学员余额/课时不足  | 仅 admin       | ❌ 绝不给 | 数据源是 `orders`（**财务表**，含 `amount`） |
//   | 线索待跟进         | 仅 admin       | ❌ 绝不给 | `routes/leads.js` **全程 `requireRole("admin")`** |
//   | 连续缺勤           | 班主任 + admin | ✅ 仅本班 | 教学口径，复用 `attendances` |
//   | 课评欠录           | 班主任 + admin | ✅ 仅本班 | 教学口径 |
//
//   ★ 这个"给老师过滤"的思路照抄现有先例 `notifications` 的 `notificationScope`
//     （老师只看 `head_teacher_id = 自己` 的班），不自己发明一套。
//
// ─────────────────────────────────────────────────────────────────────────────
// ★ 幂等：**一条来源 = 一条待办**，靠 L2 已建的唯一索引
//   `(source_type, source_ref_id, owner_id)`（部分索引，`WHERE source_type IS NOT NULL`）。
//
//   已存在且「已完成」→ 回写为「待办」（条件又出现了 → 重新提醒，如学员续费后又用尽）
//   已存在且「待办」  → 跳过
//   不存在            → 插入
//
//   **所以 L3 不需要新迁移**（表结构没动）。
//
// ─────────────────────────────────────────────────────────────────────────────
// ★ 脱敏：待办标题/正文**绝不出现金额、电话** ——
//   `orders.amount`、`leads.phone` 一律不查、不带入文案（ADR-005 白名单外）。
//   课时数是教学口径（教务版 PDF 明确"含课时余量，仅 admin"），且本类待办只发给 admin，故可写。
const db = require("../db");

/** 阈值默认值。可被 `settings` 表同名键覆盖（往 K-V 表加键 = 纯数据写入，**无需迁移**） */
const DEFAULTS = {
  /** 剩余课时 ≤ 此值 → 余额预警 */
  todo_hours_low: 5,
  /** 线索超过此天数未动 → 待跟进 */
  todo_lead_days: 7,
  /** 最近此天数内有课但未写课评 → 欠录 */
  todo_eval_days: 7,
  /** 连续缺勤达到此节数 → 预警（**沿用既有键**，与出勤预警同一个口径） */
  warn_consecutive: 3
};

function setting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS[key];
}

/** 全部 admin 用户 id（全局类事件的收件人） */
function adminIds() {
  return db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map(r => r.id);
}

/** 班级类事件的收件人：该班班主任 + 全部 admin（去重） */
function classOwnerIds(headTeacherId) {
  const ids = adminIds();
  if (headTeacherId && !ids.includes(headTeacherId)) ids.push(headTeacherId);
  return ids;
}

/** 本地日期 `YYYY-MM-DD` */
function fmtDate(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 1) 学员余额/课时不足 —— **仅 admin**（财务口径） */
function detectTuitionLow() {
  const threshold = setting("todo_hours_low");
  const rows = db
    .prepare(
      `SELECT o.student_id, s.name AS student_name, SUM(o.remain_hours) AS remain
       FROM orders o
       JOIN students s ON s.id = o.student_id
       WHERE s.status = '在读' AND o.status = '在读'
       GROUP BY o.student_id
       HAVING SUM(o.remain_hours) <= ?`
    )
    .all(threshold);

  const owners = adminIds();
  return rows.map(r => {
    const remain = Math.max(0, Number(Number(r.remain).toFixed(1)));
    return {
      source_type: "tuition_low",
      source_ref_id: r.student_id,
      title: `学员「${r.student_name}」课时将尽（剩余 ${remain} 课时）`,
      content: "建议尽快联系家长安排续费，避免课时用尽后停课。",
      priority: remain <= 0 ? "紧急" : "重要",
      ownerIds: owners
    };
  });
}

/** 2) 线索待跟进 —— **仅 admin**（线索模块对老师零开放） */
function detectLeadFollow() {
  const days = setting("todo_lead_days");
  // ★ 只取 name / status，**不取 phone**（脱敏）
  const rows = db
    .prepare(
      `SELECT l.id, l.name, l.status
       FROM leads l
       WHERE l.status = '新线索'
         AND julianday('now', 'localtime') - julianday(l.updated_at) >= ?`
    )
    .all(days);

  const owners = adminIds();
  return rows.map(r => ({
    source_type: "lead_follow",
    source_ref_id: r.id,
    title: `线索「${r.name}」已超过 ${days} 天未跟进`,
    content: "建议尽快联系确认意向，或按实际情况更新线索状态。",
    priority: "重要",
    ownerIds: owners
  }));
}

/** 3) 连续缺勤 —— 班主任 + admin（仅本班） */
function detectAbsentStreak() {
  const need = setting("warn_consecutive");

  // 单条查询取回在读学员的考勤，再在 JS 里按人分组统计连续缺勤（避免 N+1）。
  // ★ 用窗口函数**每人只取最近 20 条**：连续缺勤只需最近几节，若拉全量历史
  //   （500 学员 × 3 年 ≈ 15 万行）会白白吃内存。**不能改成按日期窗口过滤** ——
  //   若某班排课稀疏（如每月一次），3 次连续缺勤可能跨越很久，按日期截断会漏判。
  const rows = db
    .prepare(
      `SELECT student_id, date, status FROM (
         SELECT a.student_id, a.date, a.status,
                ROW_NUMBER() OVER (PARTITION BY a.student_id ORDER BY a.date DESC) AS rn
         FROM attendances a
         JOIN students s ON s.id = a.student_id
         WHERE s.status = '在读'
       ) WHERE rn <= 20
       ORDER BY student_id, date DESC`
    )
    .all();

  const byStudent = new Map();
  for (const r of rows) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
    byStudent.get(r.student_id).push(r);
  }

  const info = new Map(
    db
      .prepare(
        `SELECT s.id, s.name, c.name AS class_name, c.head_teacher_id
         FROM students s JOIN classes c ON c.id = s.class_id
         WHERE s.status = '在读'`
      )
      .all()
      .map(r => [r.id, r])
  );

  const out = [];
  for (const [studentId, list] of byStudent) {
    // 按日期倒序，数「最近连续缺勤」几节
    let streak = 0;
    for (const a of list) {
      if (a.status === "缺勤") streak++;
      else break;
    }
    if (streak < need) continue;

    const st = info.get(studentId);
    if (!st) continue;
    out.push({
      source_type: "absent_streak",
      source_ref_id: studentId,
      title: `学员「${st.name}」已连续缺勤 ${streak} 节`,
      content: `所属班级：${st.class_name}。建议尽快与家长沟通，了解原因并评估流失风险。`,
      priority: "紧急",
      ownerIds: classOwnerIds(st.head_teacher_id)
    });
  }
  return out;
}

/** 4) 课评欠录 —— 班主任 + admin（仅本班） */
function detectEvalMissing() {
  const days = setting("todo_eval_days");

  // 课表是「周几」模板（1=周一 … 7=周日，见前端 `weekDays[dow-1]`），不是具体日期
  const scheds = db
    .prepare(
      `SELECT sc.class_id, sc.day_of_week, c.name AS class_name, c.head_teacher_id
       FROM schedules sc JOIN classes c ON c.id = sc.class_id`
    )
    .all();
  if (!scheds.length) return [];

  // 每班有课的星期集合
  const classDows = new Map();
  for (const s of scheds) {
    if (!classDows.has(s.class_id)) {
      classDows.set(s.class_id, { dows: new Set(), meta: s });
    }
    classDows.get(s.class_id).dows.add(Number(s.day_of_week));
  }

  // 已有课评的 (class_id, eval_date) 集合
  const hasEval = new Set(
    db
      .prepare("SELECT DISTINCT class_id, eval_date FROM class_evaluations")
      .all()
      .map(r => `${r.class_id}|${r.eval_date}`)
  );

  // 最近 days 天里，各班最近一次「有课但无课评」的日期
  const missed = new Map(); // class_id -> date（取最近的一次）
  for (let i = 1; i <= days; i++) {
    const d = new Date(Date.now() - i * 86400_000);
    const iso = d.getDay() === 0 ? 7 : d.getDay(); // JS 0=周日 → 转 ISO 7
    const ds = fmtDate(d);
    for (const [classId, { dows, meta }] of classDows) {
      if (!dows.has(iso)) continue;
      if (hasEval.has(`${classId}|${ds}`)) continue;
      if (!missed.has(classId) || ds > missed.get(classId).date) {
        missed.set(classId, { date: ds, meta });
      }
    }
  }

  return [...missed.entries()].map(([classId, { date, meta }]) => ({
    source_type: "eval_missing",
    source_ref_id: classId,
    title: `班级「${meta.class_name}」${date} 的课评未录入`,
    content: "建议尽快补录课堂评价与知识点评定，这是学生成长路径的过程证据。",
    priority: "普通",
    ownerIds: classOwnerIds(meta.head_teacher_id)
  }));
}

/**
 * 幂等落库：一条来源 = 一条待办。
 * @returns {{created:number, reopened:number, skipped:number}}
 */
function persist(candidates) {
  const find = db.prepare(
    `SELECT id, status FROM todos
     WHERE source_type = ? AND source_ref_id = ? AND owner_id = ?`
  );
  const insert = db.prepare(
    `INSERT INTO todos (title, content, owner_id, creator_id, source, source_type, source_ref_id, status, priority, due_date)
     VALUES (?, ?, ?, NULL, 'auto', ?, ?, '待办', ?, ?)`
  );
  const reopen = db.prepare(
    `UPDATE todos SET status = '待办', title = ?, content = ?, priority = ?,
       completed_at = NULL, updated_at = datetime('now','localtime')
     WHERE id = ?`
  );

  let created = 0;
  let reopened = 0;
  let skipped = 0;

  // ★ 本项目 db 是 `node:sqlite` 的裸封装（`module.exports = db`），**没有 better-sqlite3 的
  //   `db.transaction()`**。按项目既有写法（`migrations/index.js`）手工 BEGIN/COMMIT/ROLLBACK。
  db.exec("BEGIN");
  try {
    for (const c of candidates) {
      for (const ownerId of c.ownerIds) {
        const exist = find.get(c.source_type, c.source_ref_id, ownerId);
        if (!exist) {
          insert.run(c.title, c.content, ownerId, c.source_type, c.source_ref_id, c.priority, c.dueDate || null);
          created++;
        } else if (exist.status === "已完成") {
          // 条件又出现了（如学员续费后又用尽）→ 重开同一条，不新增
          reopen.run(c.title, c.content, c.priority, exist.id);
          reopened++;
        } else {
          skipped++;
        }
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { created, reopened, skipped };
}

/** 节流：同一进程内至少间隔这么久才重跑一次（按需触发会随铃铛打开而频繁发生） */
const MIN_INTERVAL_MS = 60 * 1000;
let lastRunAt = 0;

/**
 * 跑一遍全部检测器并落库。**幂等**，可反复调用。
 * 触发点：① 打开待办/铃铛时（按需，**默认节流 60s**）② 定时任务 ③ admin 手动（`force` 跳过节流）
 */
function generateTodos({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRunAt < MIN_INTERVAL_MS) {
    return { created: 0, reopened: 0, skipped: 0, candidates: 0, throttled: true };
  }
  lastRunAt = now;

  const candidates = [
    ...detectTuitionLow(),
    ...detectLeadFollow(),
    ...detectAbsentStreak(),
    ...detectEvalMissing()
  ];
  const result = persist(candidates);
  return { ...result, candidates: candidates.length, throttled: false };
}

module.exports = { generateTodos, setting, DEFAULTS };
