// 节次时间表：读取（auth）+ 批量保存（admin）
//
// 独立结构化配置（非 settings KV）；节次固定 1–8（Q3 不放宽）。
// 课次生成时把 start_time/end_time 快照写入，日后改此表不回写历史。
// 响应体统一 { success, data?, message? }。
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

const PERIOD_MIN = 1;
const PERIOD_MAX = 8;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

/** 批量保存节次时间（admin；仅 1–8 节，时间格式 HH:mm 或空串） */
router.put("/", auth, requireRole("admin"), (req, res) => {
  const items = (req.body || {}).items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "items 不能为空" });
  }
  // 先整体校验，避免写一半才发现非法
  const cleaned = [];
  for (const it of items) {
    const period = Number(it.period);
    if (!Number.isInteger(period) || period < PERIOD_MIN || period > PERIOD_MAX) {
      return res.status(400).json({ success: false, message: `节次范围 ${PERIOD_MIN}-${PERIOD_MAX}` });
    }
    const start = it.start_time == null ? "" : String(it.start_time).trim();
    const end = it.end_time == null ? "" : String(it.end_time).trim();
    const label = it.label == null ? "" : String(it.label).trim();
    if (start && !TIME_RE.test(start)) {
      return res.status(400).json({ success: false, message: `第${period}节开始时间格式应为 HH:mm` });
    }
    if (end && !TIME_RE.test(end)) {
      return res.status(400).json({ success: false, message: `第${period}节结束时间格式应为 HH:mm` });
    }
    if (label.length > 20) {
      return res.status(400).json({ success: false, message: `第${period}节名称过长（上限 20 字）` });
    }
    cleaned.push({ period, start, end, label });
  }

  db.exec("BEGIN");
  try {
    const upsert = db.prepare(
      `INSERT INTO period_times (period, start_time, end_time, label, updated_at)
       VALUES (?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(period) DO UPDATE SET
         start_time = excluded.start_time,
         end_time   = excluded.end_time,
         label      = excluded.label,
         updated_at = excluded.updated_at`
    );
    for (const it of cleaned) upsert.run(it.period, it.start, it.end, it.label);
    db.exec("COMMIT");
    res.json({ success: true, data: null });
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});

module.exports = router;
