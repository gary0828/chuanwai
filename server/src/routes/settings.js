// 系统参数：键值对配置（仅 admin 读写；登录用户可读）
// 预置键：warn_rate / warn_consecutive / warn_days / term_id
const express = require("express");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");

const router = express.Router();

/** 读取全部系统参数（登录即可读，供统计页等消费） */
router.get("/", auth, (_req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const data = {};
  rows.forEach(r => (data[r.key] = r.value));
  res.json({ success: true, data });
});

/** 更新系统参数（仅 admin，整体覆盖提交的键） */
router.put("/", auth, requireRole("admin"), (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body).filter(k => typeof body[k] === "string" || typeof body[k] === "number");
  if (keys.length === 0) {
    return res.status(400).json({ success: false, message: "没有可更新的参数" });
  }
  db.exec("BEGIN");
  try {
    const stmt = db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );
    for (const k of keys) stmt.run(k, String(body[k]));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ success: true, data: null });
});

module.exports = router;
