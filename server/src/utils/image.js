// 图片上传公共能力：魔数判型 + 落盘命名 + 清理旧文件
//
// 为什么抽出来（2026-09-23）：「站点 Logo」与「员工头像」是两处上传，
// 判型与落盘逻辑如果各写一份，将来改允许的格式或大小必然只改一处、另一处漂移 ——
// 与 413 事故同源（三份 nginx 只改一份）。**只允许存在一份判型逻辑**。
//
// 设计（沿用 site-info 既有约定）：
// - 用 express.raw 收原始二进制，**不引 multer**
// - **忽略客户端声明的扩展名 / MIME**，只看文件头魔数
// - 文件名不保留原名（防路径穿越 / 中文兼容问题）
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** 允许落盘的图片扩展名（魔数判型结果必须落在其中） */
const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico"];

/** 单文件上限 2MB（Logo 与头像都是小图，不需要更大） */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * 文件头魔数嗅探，返回可信扩展名（不含点号之外的包装）；无法识别返回 null。
 * @param {Buffer} buf
 * @returns {string|null} 形如 ".png"
 */
function sniffImage(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 8) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return ".png";
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
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00)
    return ".ico";
  // SVG（文本，含 <svg）
  const head = buf.slice(0, 512).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return ".svg";
  return null;
}

/**
 * 校验并落盘一张图片。
 *
 * @param {object} o
 * @param {string} o.dir       落盘目录（绝对路径）
 * @param {string} o.prefix    文件名前缀，同时用作「同前缀旧文件」的清理键
 *                             （站点用 `logo` / `favicon`；头像用 `avatar-<用户id>`）
 * @param {Buffer} o.buf       原始二进制
 * @param {boolean} [o.cleanup] 是否删除同前缀的旧文件（默认 true，防磁盘堆积）
 * @returns {{ ok: true, filename: string, ext: string } | { ok: false, status: number, message: string }}
 */
function saveImage({ dir, prefix, buf, cleanup = true }) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, status: 400, message: "未收到文件内容" };
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    // 注：正常路径下 express.raw 已按同一上限拦截并抛 413（见 index.js 统一错误处理），
    // 这里是双保险，防止将来有人调大 express.raw 的 limit 却忘了同步此处。
    return { ok: false, status: 413, message: "文件过大，上限 2MB" };
  }
  const ext = sniffImage(buf);
  if (!ext || !ALLOWED_EXT.includes(ext)) {
    return {
      ok: false,
      status: 400,
      message: "文件格式不支持（仅 png / jpg / webp / svg / ico）"
    };
  }

  fs.mkdirSync(dir, { recursive: true });
  // 文件名：prefix-时间戳-随机 8 位.ext
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(4).toString("hex");
  const filename = `${prefix}-${stamp}-${rand}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);

  if (cleanup) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${prefix}-`) && f !== filename) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    } catch {
      /* 清理失败不影响主流程 */
    }
  }

  return { ok: true, filename, ext };
}

/** 按文件名删除已落盘的图片（头像清空 / 回滚用）；不存在则静默成功 */
function removeImage(dir, filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(dir, filename));
  } catch {
    /* 文件本就不存在，忽略 */
  }
}

module.exports = {
  ALLOWED_EXT,
  MAX_UPLOAD_BYTES,
  sniffImage,
  saveImage,
  removeImage
};
