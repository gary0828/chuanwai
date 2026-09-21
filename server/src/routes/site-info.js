// 站点信息：机构名称 / 标题 / Logo / 页脚 等展示信息 + 图片上传
//
// 设计要点（见 docs/decisions/ADR-008）：
//   1. GET  /api/site-info        —— 免登录公开接口（登录页要用），**字段白名单**，绝不返回内部参数
//   2. GET  /api/site-info/admin  —— 登录后可读全部 site.* 键（供设置页回填）
//   3. PUT  /api/site-info        —— 仅 admin，只允许写 SITE_KEYS 白名单
//   4. POST /api/site-info/upload —— 仅 admin，图片落盘 server/data/assets/site/，DB 只存路径
//
// 说明：数据复用既有 settings 表（key/value），无需新建表、无需迁移。
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../db");
const { auth, requireRole } = require("../middleware/auth");
const { audit } = require("../utils/audit");

const router = express.Router();

// ── 站点信息字段白名单（键名 → 默认值）────────────────────────────────
// 备案类字段默认空串，前端「空值不渲染」，将来商业化填值即自动出现。
const SITE_DEFAULTS = {
  "site.name": "",          // 系统简称（侧边栏 / 登录页）
  "site.title": "",         // 浏览器标签页完整标题
  "site.orgName": "",       // 版权主体：机构全称
  "site.sinceYear": "",     // 起始年份 → 渲染 © 2020-2026
  "site.slogan": "",        // 登录页副标题
  "site.contact": "",       // 联系电话
  "site.address": "",       // 地址
  "site.icp": "",           // ICP 备案号（当前不需要，留空即不显示）
  "site.policeNo": "",      // 公安备案号（同上）
  "site.copyrightExtra": "", // 页脚补充说明（一行自由文本）
  "site.logo": "",          // Logo 图片 URL（相对路径）
  "site.favicon": ""        // 标签页小图标 URL
};

const SITE_KEYS = Object.keys(SITE_DEFAULTS);

// ── 上传配置 ──────────────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, "..", "..", "data", "assets", "site");
const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico"];
// 单文件上限 2MB（Logo 用，不需要更大）
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// 文件头魔数校验，防止改扩展名绕过
function sniffImage(buf) {
  if (buf.length < 8) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  // GIF
  if (buf.slice(0, 3).toString("ascii") === "GIF") return ".gif";
  // WEBP (RIFF....WEBP)
  if (
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  )
    return ".webp";
  // ICO
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return ".ico";
  // SVG（文本，含 <svg）
  const head = buf.slice(0, 512).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return ".svg";
  return null;
}

/** 读取全部站点信息（内部用，返回含默认值） */
function readSiteInfo() {
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${SITE_KEYS.map(() => "?").join(",")})`
    )
    .all(...SITE_KEYS);
  const data = { ...SITE_DEFAULTS };
  rows.forEach(r => {
    if (r.value !== null && r.value !== undefined) data[r.key] = r.value;
  });
  return data;
}

// ── 1. 公开接口：免登录（登录页 / 未登录时用）──────────────────────────
// ★ 只返回**非空**字段：一是避免把「有哪些配置项」这种内网信息暴露给未登录访客，
//   二是让前端能直接用 `if (v)` 判断有无，无需再区分「没配」与「配成空串」。
router.get("/", (_req, res) => {
  const all = readSiteInfo();
  const data = {};
  for (const k of SITE_KEYS) {
    if (all[k] !== "" && all[k] !== null && all[k] !== undefined) data[k] = all[k];
  }
  res.json({ success: true, data });
});

// ── 2. 管理接口：登录后可读（设置页回填用，含全部 site.* 键）──────────
router.get("/admin", auth, (_req, res) => {
  res.json({ success: true, data: readSiteInfo() });
});

// ── 3. 保存：仅 admin，只写 site.* 白名单键 ───────────────────────────
router.put("/", auth, requireRole("admin"), (req, res) => {
  const body = req.body || {};
  const keys = SITE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(body, k));
  if (keys.length === 0) {
    return res.status(400).json({ success: false, message: "没有可更新的站点信息" });
  }
  // 长度上限，防超长文本撑爆配置
  for (const k of keys) {
    const v = String(body[k] ?? "");
    if (v.length > 500) {
      return res.status(400).json({ success: false, message: `${k} 内容过长（上限 500 字）` });
    }
  }
  db.exec("BEGIN");
  try {
    const stmt = db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );
    for (const k of keys) stmt.run(k, String(body[k] ?? ""));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  audit(req.user, "修改站点信息", `更新了 ${keys.length} 项`);
  res.json({ success: true, data: readSiteInfo() });
});

// ── 4. 图片上传：仅 admin ─────────────────────────────────────────────
// 用 express.raw 接收原始二进制（前端直接把 File 作为 body 发送），
// 避免引入 multer 依赖。字段名固定为 logo / favicon 由 query 指定。
router.post(
  "/upload",
  auth,
  requireRole("admin"),
  express.raw({ type: ["image/*", "application/octet-stream"], limit: MAX_UPLOAD_BYTES + 1024 }),
  (req, res) => {
    const kind = String(req.query.kind || "logo");
    if (!["logo", "favicon"].includes(kind)) {
      return res.status(400).json({ success: false, message: "不支持的上传类型" });
    }
    const buf = req.body;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ success: false, message: "未收到文件内容" });
    }
    if (buf.length > MAX_UPLOAD_BYTES) {
      // 注：正常路径下 express.raw 已按同一上限拦截并抛 413（见 index.js 统一错误处理），
      // 这里是双保险，防止将来有人调大 express.raw 的 limit 却忘了同步此处。
      return res.status(413).json({ success: false, message: "文件过大，上限 2MB" });
    }
    // 魔数嗅探，得到可信扩展名（忽略客户端声明）
    const ext = sniffImage(buf);
    if (!ext) {
      return res
        .status(400)
        .json({ success: false, message: "文件格式不支持（仅 png / jpg / webp / svg / ico）" });
    }
    if (!ALLOWED_EXT.includes(ext)) {
      return res.status(400).json({ success: false, message: "文件格式不支持" });
    }

    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    // 文件名：kind-时间戳-随机 8 位.ext（不保留原名，防路径穿越 / 中文兼容问题）
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const rand = crypto.randomBytes(4).toString("hex");
    const filename = `${kind}-${stamp}-${rand}${ext}`;
    const absPath = path.join(ASSETS_DIR, filename);
    fs.writeFileSync(absPath, buf);

    // 清理同 kind 的旧文件（避免磁盘堆积）
    try {
      for (const f of fs.readdirSync(ASSETS_DIR)) {
        if (f.startsWith(`${kind}-`) && f !== filename) {
          fs.unlinkSync(path.join(ASSETS_DIR, f));
        }
      }
    } catch {
      /* 清理失败不影响主流程 */
    }

    const url = `/assets/site/${filename}`;
    // 同时把路径写入 settings，便于前端一次性拿到
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(`site.${kind}`, url);

    audit(req.user, "上传站点图片", `${kind} → ${filename}`);
    res.json({ success: true, data: { url, key: `site.${kind}` } });
  }
);

module.exports = router;
