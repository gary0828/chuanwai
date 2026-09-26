// 通用删除守卫：自动发现「谁引用了我」，避免漏检外键导致静默删/改数据
//
// ★ 为什么需要（K-052 · 2026-09-26 审计发现）：
//   项目里共 80 个外键，相当一部分是 ON DELETE CASCADE（会**连同删除**）
//   或 SET NULL（会**静默置空**）。而多处 DELETE 端点只校验了"显眼的"关联表 ——
//   漏检的后果是：删除"成功"、无任何提示，但关联数据已被改/被删。
//
//   实测案例（最危险的一个）：删课程原先只查 4 张表，实际有 **14 张表**引用 courses，
//   其中 orders.course_id 是 SET NULL → 订单课程被静默置空 →
//   而考勤扣课要求订单 course_id 精确匹配 → **该订单的学员以后点名永不扣课时**。
//
//   与其在每处硬编码表名（必然随迁移增加而漏），不如**让数据库自己告诉我们**。
//
// 用法：
//   const { scanReferences, describeImpacts } = require("../utils/delete-guard");
//   const impacts = scanReferences("courses", id);
//   if (impacts.length) {
//     return res.status(400).json({
//       success: false,
//       message: `该课程仍被以下数据引用，无法删除：${describeImpacts(impacts)}`
//     });
//   }
const db = require("../db");

/** 表名中文标签（提示用；未列出的回退为原表名） */
const TABLE_LABELS = {
  attendances: "考勤记录",
  leaves: "请假记录",
  makeup_classes: "补课记录",
  hour_consumptions: "课时消耗流水",
  notifications: "通知记录",
  exam_scores: "考试成绩",
  orders: "报班订单",
  payments: "缴费记录",
  refunds: "退费记录",
  schedules: "排课模板",
  schedule_adjustments: "调课申请",
  class_sessions: "课次",
  teaching_assignments: "任课关系",
  exams: "考试",
  leads: "招生线索",
  student_timeline: "成长档案",
  knowledge_points: "知识点",
  kp_assessments: "知识点测评",
  class_evaluations: "课堂评价",
  audit_logs: "审计日志",
  todos: "待办",
  notices: "通知公告",
  users: "员工账号",
  classes: "班级",
  courses: "课程",
  terms: "学期",
  students: "学员",
  terms_settings: "系统配置"
};

/** 标识符白名单校验（表名/列名取自 sqlite_master，仍做一次防御） */
function safeIdent(name) {
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`非法的表名/列名：${name}`);
  }
  return name;
}

/**
 * 扫描「哪些表通过外键引用了 targetTable 的这一行」
 * @param {string} targetTable 目标表名（如 "courses"）
 * @param {number|string} id 目标行主键值
 * @returns {Array<{table:string,column:string,action:string,count:number,label:string}>}
 *          仅返回 count > 0 的引用；`action` 为外键的 ON DELETE 行为
 */
function scanReferences(targetTable, id) {
  const target = safeIdent(targetTable);
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    .all();
  const impacts = [];
  for (const { name } of tables) {
    if (name === target) continue;
    let table;
    let fks;
    try {
      table = safeIdent(name);
      fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    } catch {
      continue; // 跳过无法读取 schema 的对象
    }
    for (const fk of fks) {
      if (fk.table !== target) continue;
      let column;
      try {
        column = safeIdent(fk.from);
      } catch {
        continue;
      }
      const count = db
        .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`)
        .get(id).c;
      if (count > 0) {
        impacts.push({
          table,
          column,
          action: fk.on_delete,
          count,
          label: TABLE_LABELS[table] || table
        });
      }
    }
  }
  // 影响大的排前面，便于用户一眼看到主要代价
  return impacts.sort((a, b) => b.count - a.count);
}

/**
 * 把扫描结果格式化成一句中文提示
 * @param {Array} impacts scanReferences 的返回值
 */
function describeImpacts(impacts) {
  return impacts
    .map(i => {
      const effect = i.action === "SET NULL" ? "将被置空" : "将被一并删除";
      return `${i.label} ${i.count} 条（${effect}）`;
    })
    .join("；");
}

/**
 * 只取会「连带删除」的部分（CASCADE）—— 需要更严格提示时用
 */
function destructiveImpacts(impacts) {
  return impacts.filter(i => i.action === "CASCADE");
}

module.exports = { scanReferences, describeImpacts, destructiveImpacts, TABLE_LABELS };
