// 调课申请与审批：教师对本班课表条目发起调课，管理员审批
// 审批通过时事务内同步更新 schedules（原时段释放 / 新时段占用），目标时段冲突则拒绝
// 数据权限：teacher 仅本班；审批仅 admin
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { canManageClass } = require("../utils/scope");
const { audit } = require("../utils/audit");

const router = express.Router();

/** 校验调课申请是否当前用户可管理（admin 恒 true；teacher 仅本班申请的班级） */
function canManageAdjustment(req, adjId) {
  if (req.user.role === "admin") return true;
  const row = db
    .prepare("SELECT class_id, apply_user_id FROM schedule_adjustments WHERE id = ?")
    .get(Number(adjId));
  if (!row) return false;
  // teacher 可查看/撤销自己提交的申请；同班其他 teacher 仅可查看（列表已过滤，此处按班级权限放行查看）
  return canManageClass(req, row.class_id);
}

/** 调课申请列表（分页 + 状态/班级筛选；teacher 仅本班） */
router.get("/", auth, (req, res) => {
  const { status, class_id, page = 1, pageSize = 10 } = req.query;
  const p = Number(page) || 1;
  const ps = Number(pageSize) || 10;
  const offset = (p - 1) * ps;

  let where = "WHERE 1=1";
  const params = [];
  if (req.user.role === "teacher") {
    where += " AND a.class_id IN (SELECT id FROM classes WHERE head_teacher_id = ?)";
    params.push(req.user.id);
  }
  if (status) {
    where += " AND a.status = ?";
    params.push(status);
  }
  if (class_id) {
    where += " AND a.class_id = ?";
    params.push(Number(class_id));
  }

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM schedule_adjustments a JOIN schedules sc ON a.schedule_id = sc.id ${where}`
    )
    .get(...params).c;
  const list = db
    .prepare(
      `SELECT a.id, a.schedule_id, a.class_id, c.name AS class_name, a.course_id, co.name AS course_name,
              a.from_day_of_week, a.from_period, a.to_day_of_week, a.to_period, a.reason, a.status,
              a.apply_user_id, u.name AS apply_user_name, a.approve_user_id, a.apply_time, a.approve_time
       FROM schedule_adjustments a
       JOIN classes c ON a.class_id = c.id
       LEFT JOIN courses co ON a.course_id = co.id
       LEFT JOIN users u ON a.apply_user_id = u.id
       WHERE 1=1${req.user.role === "teacher" ? " AND a.class_id IN (SELECT id FROM classes WHERE head_teacher_id = ?)" : ""}${status ? " AND a.status = ?" : ""}${class_id ? " AND a.class_id = ?" : ""}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ps, offset);

  res.json({ success: true, data: { list, total } });
});

/** 提交调课申请（teacher 仅本班课表；目标时段同班冲突直接拒绝，同教师跨班冲突提示） */
router.post("/", auth, requireRole("admin", "teacher"), (req, res) => {
  const { schedule_id, to_day_of_week, to_period, reason } = req.body || {};
  if (!schedule_id || !to_day_of_week || !to_period) {
    return res.status(400).json({ success: false, message: "课表条目、目标星期、目标节次为必填项" });
  }
  const d = Number(to_day_of_week);
  const per = Number(to_period);
  if (d < 1 || d > 7 || per < 1 || per > 8) {
    return res.status(400).json({ success: false, message: "星期范围 1-7，节次范围 1-8" });
  }
  const sc = db.prepare("SELECT * FROM schedules WHERE id = ?").get(Number(schedule_id));
  if (!sc) return res.status(404).json({ success: false, message: "课表条目不存在" });
  if (!canManageClass(req, sc.class_id)) {
    return res.status(403).json({ success: false, message: "无权为该班级提交调课申请" });
  }
  if (sc.day_of_week === d && sc.period === per) {
    return res.status(400).json({ success: false, message: "目标时段与原时段相同，无需调课" });
  }
  // 待审批去重：同一课表条目存在未处理申请时禁止重复提交
  const pending = db
    .prepare("SELECT id FROM schedule_adjustments WHERE schedule_id = ? AND status = '待审批'")
    .get(Number(schedule_id));
  if (pending) {
    return res.status(400).json({ success: false, message: "该课表条目已有待审批的调课申请，请先处理" });
  }
  // 目标时段同班冲突检测（排除自身条目）
  const conflicts = db
    .prepare(
      `SELECT sc.id, co.name AS course_name FROM schedules sc
       JOIN courses co ON sc.course_id = co.id
       WHERE sc.class_id = ? AND sc.day_of_week = ? AND sc.period = ? AND sc.id != ?`
    )
    .all(sc.class_id, d, per, sc.id);
  if (conflicts.length > 0) {
    return res.status(400).json({ success: false, message: `目标时段已被「${conflicts[0].course_name}」占用，请选择其他时段` });
  }
  const info = db
    .prepare(
      `INSERT INTO schedule_adjustments (schedule_id, class_id, course_id, from_day_of_week, from_period, to_day_of_week, to_period, reason, apply_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sc.id, sc.class_id, sc.course_id, sc.day_of_week, sc.period, d, per, reason || "", req.user.id);
  audit(req.user, "提交调课申请", `申请#${info.lastInsertRowid}`);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});

/** 审批调课申请（仅 admin；通过时事务内同步更新课表，目标时段冲突则失败） */
router.put("/:id/approve", auth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const { action } = req.body || {};
  if (!["通过", "驳回"].includes(action)) {
    return res.status(400).json({ success: false, message: "审批动作仅支持「通过」或「驳回」" });
  }
  const adj = db.prepare("SELECT * FROM schedule_adjustments WHERE id = ?").get(id);
  if (!adj) return res.status(404).json({ success: false, message: "调课申请不存在" });
  if (adj.status !== "待审批") {
    return res.status(400).json({ success: false, message: `该申请已${adj.status}，不可重复审批` });
  }
  if (!canManageClass(req, adj.class_id)) {
    return res.status(403).json({ success: false, message: "无权审批该班级调课申请" });
  }

  db.exec("BEGIN");
  try {
    if (action === "通过") {
      // 目标时段同班冲突检测（排除原条目；同课程同班同段由 UNIQUE 兜底）
      const conflicts = db
        .prepare(
          `SELECT sc.id, co.name AS course_name FROM schedules sc
           JOIN courses co ON sc.course_id = co.id
           WHERE sc.class_id = ? AND sc.day_of_week = ? AND sc.period = ? AND sc.id != ?`
        )
        .all(adj.class_id, adj.to_day_of_week, adj.to_period, adj.schedule_id);
      if (conflicts.length > 0) {
        throw new Error(`CONFLICT:目标时段已被「${conflicts[0].course_name}」占用，无法通过`);
      }
      // 更新课表：原时段释放 / 新时段占用（同课程同班同段冲突由 UNIQUE 约束抛错回滚）
      const result = db
        .prepare("UPDATE schedules SET day_of_week = ?, period = ? WHERE id = ?")
        .run(adj.to_day_of_week, adj.to_period, adj.schedule_id);
      if (result.changes === 0) {
        throw new Error("课表条目不存在或已被删除");
      }
      db.prepare(
        "UPDATE schedule_adjustments SET status = '通过', approve_user_id = ?, approve_time = datetime('now','localtime') WHERE id = ?"
      ).run(req.user.id, id);
    } else {
      db.prepare(
        "UPDATE schedule_adjustments SET status = '驳回', approve_user_id = ?, approve_time = datetime('now','localtime') WHERE id = ?"
      ).run(req.user.id, id);
    }
    db.exec("COMMIT");
    audit(req.user, action === "通过" ? "通过调课申请" : "驳回调课申请", `申请#${id}`);
    res.json({ success: true, data: null });
  } catch (err) {
    db.exec("ROLLBACK");
    if (String(err.message).startsWith("CONFLICT:")) {
      return res.status(400).json({ success: false, message: err.message.replace("CONFLICT:", "") });
    }
    if (String(err.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: "目标时段已与其他课程冲突，无法通过审批" });
    }
    throw err;
  }
});

/** 撤销/删除调课申请（v13：admin 可删除任意状态的记录用于清理历史；非 admin 仅可撤销自己待审批的申请） */
router.delete("/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const adj = db.prepare("SELECT * FROM schedule_adjustments WHERE id = ?").get(id);
  if (!adj) return res.status(404).json({ success: false, message: "调课申请不存在" });
  if (req.user.role !== "admin") {
    if (adj.status !== "待审批") {
      return res.status(400).json({ success: false, message: "仅待审批的申请可撤销" });
    }
    if (adj.apply_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "仅申请人本人或管理员可撤销" });
    }
  }
  db.prepare("DELETE FROM schedule_adjustments WHERE id = ?").run(id);
  audit(req.user, req.user.role === "admin" ? "删除调课记录" : "撤销调课申请", `申请#${id}`);
  res.json({ success: true, data: null });
});

module.exports = router;
