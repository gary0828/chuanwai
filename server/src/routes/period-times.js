// 节次时间表：读取（auth）+ 批量保存 / 新增 / 删除（admin）
//
// ★ v24（2026-10-01）起**节次不再固定 1–8**：校区反馈「机构不是学校，
//   节次数量与时间要能个性化创建」→ 节次数 = 本表的行数，可增可删。
//   范围口径见 `utils/period.js`。
//
// 课次生成时把 start_time/end_time 快照写入，日后改此表不回写历史。
// 响应体统一 { success, data?, message? }。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LABEL_MAX = 20;

/** 校验并规范化一条节次配置 */
function parseItem(it) {
  const period = Number(it.period);
  if (!Number.isInteger(period) || period < 1) {
    return { ok: false, message: "节次必须是不小于 1 的整数" };
  }
  const start = it.start_time == null ? "" : String(it.start_time).trim();
  const end = it.end_time == null ? "" : String(it.end_time).trim();
  const label = it.label == null ? "" : String(it.label).trim();
  if (start && !TIME_RE.test(start)) {
    return { ok: false, message: `第${period}节开始时间格式应为 HH:mm` };
  }
  if (end && !TIME_RE.test(end)) {
    return { ok: false, message: `第${period}节结束时间格式应为 HH:mm` };
  }
  if (label.length > LABEL_MAX) {
    return { ok: false, message: `第${period}节名称过长（上限 ${LABEL_MAX} 字）` };
  }
  return { ok: true, value: { period, start, end, label } };
}

/** 节次时间表（按节次升序，供周历 / 生成快照消费） */
router.get("/", auth, (_req, res) => {
  const list = db
    .prepare("SELECT period, start_time, end_time, label FROM period_times ORDER BY period")
    .all()
    .map(r => ({
      period: Number(r.period),
      start_time: r.start_time || "",
      end_time: r.end_time || "",
      label: r.label || ""
    }));
  res.json({ success: true, data: list });
});

/**
 * 批量保存节次时间（admin）
 * ★ v24：只能修改**已存在**的节次（放开上限后，避免从这条路静默新增出第 99 节）；
 *   要新增请用 POST —— 职责分开，前端也是两个动作。
 */
router.put("/", auth, requireRole("admin"), (req, res) => {
  const items = (req.body || {}).items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "items 不能为空" });
  }
  const cleaned = [];
  for (const it of items) {
    const parsed = parseItem(it);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
    const exists = db.prepare("SELECT 1 FROM period_times WHERE period = ?").get(parsed.value.period);
    if (!exists) {
      return res.status(400).json({
        success: false,
        message: `第${parsed.value.period}节尚未配置 —— 新增节次请点「增加一节」`
      });
    }
    cleaned.push(parsed.value);
  }

  db.exec("BEGIN");
  try {
    const upd = db.prepare(
      `UPDATE period_times SET start_time = ?, end_time = ?, label = ?,
         updated_at = datetime('now','localtime') WHERE period = ?`
    );
    for (const it of cleaned) upd.run(it.start, it.end, it.label, it.period);
    db.exec("COMMIT");
    res.json({ success: true, data: null });
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});

/**
 * 新增一节（admin）
 * 不传 `period` → 自动接在当前最后一节之后（最常用）；也可显式指定节次号。
 */
router.post("/", auth, requireRole("admin"), (req, res) => {
  const body = req.body || {};
  const maxRow = db.prepare("SELECT COALESCE(MAX(period), 0) AS m FROM period_times").get();
  const period = body.period == null || body.period === "" ? Number(maxRow.m) + 1 : body.period;
  const parsed = parseItem({ ...body, period });
  if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
  try {
    db.prepare(
      `INSERT INTO period_times (period, start_time, end_time, label) VALUES (?, ?, ?, ?)`
    ).run(parsed.value.period, parsed.value.start, parsed.value.end, parsed.value.label);
    res.json({ success: true, data: { period: parsed.value.period } });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(400).json({ success: false, message: `第${parsed.value.period}节已存在` });
    }
    throw e;
  }
});

/**
 * 删除一节（admin）
 * ★ 被课次或排课模板引用时**拒绝删除**并说明在哪用了 —— 否则会留下"排了课但课表没有这一行"的悬空数据。
 * ★ 删除后**序号不前移**（避免把已有课次的节次语义整体改掉）；如需也可自行再加。
 */
router.delete("/:period", auth, requireRole("admin"), (req, res) => {
  const period = Number(req.params.period);
  if (!Number.isInteger(period) || period < 1) {
    return res.status(400).json({ success: false, message: "节次不合法" });
  }
  if (!db.prepare("SELECT 1 FROM period_times WHERE period = ?").get(period)) {
    return res.status(404).json({ success: false, message: `第${period}节不存在` });
  }
  const sessCount = db
    .prepare("SELECT COUNT(*) AS c FROM class_sessions WHERE period = ?")
    .get(period).c;
  const schedCount = db
    .prepare("SELECT COUNT(*) AS c FROM schedules WHERE period = ?")
    .get(period).c;
  const parts = [];
  if (sessCount > 0) parts.push(`课次 ${sessCount} 条`);
  if (schedCount > 0) parts.push(`排课模板 ${schedCount} 条`);
  if (parts.length > 0) {
    return res.status(400).json({
      success: false,
      message: `第${period}节仍被以下数据使用，无法删除：${parts.join("、")}。请先处理这些排课/课次`
    });
  }
  db.prepare("DELETE FROM period_times WHERE period = ?").run(period);
  res.json({ success: true, data: null });
});

module.exports = router;
