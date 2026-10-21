// 统一数据目录解析（唯一来源）
//
// 背景（2026-10-18 深度测试 P1-5）：`DATA_DIR` 此前只有 `db.js` 尊重，
// 备份（utils/backup.js）、头像（routes/auth.js）、站点图片（routes/site-info.js）、
// 题库配图（routes/qbank.js）、静态资源（index.js）都硬编码 `server/data`。
// 结果：用 `DATA_DIR` 起隔离/测试实例时，备份列表读主数据目录、执行「恢复」会覆盖主库
// （假恢复）、上传头像写主数据目录并清理同前缀旧文件（实测误删主头像文件）。
//
// 本文件是**唯一**解析入口：所有需要读写 data/ 的模块必须 require 这里，
// 禁止再写 `path.join(__dirname, "..", "..", "data")`。
const path = require("path");

/** 数据根目录：优先环境变量 DATA_DIR，否则 <repo>/server/data */
const dataDir =
  process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");

/** SQLite 主库 */
const dbPath = path.join(dataDir, "attendance.db");

/** 资产根目录（站点图片 / 头像 / 题库配图，随 data/ 一起备份） */
const assetsDir = path.join(dataDir, "assets");

/** 员工头像 */
const avatarsDir = path.join(assetsDir, "avatars");

/** 站点 Logo / favicon */
const siteAssetsDir = path.join(assetsDir, "site");

/** 题库配图 */
const questionAssetsDir = path.join(assetsDir, "questions");

/** 备份目录 */
const backupsDir = path.join(dataDir, "backups");

module.exports = {
  dataDir,
  dbPath,
  assetsDir,
  avatarsDir,
  siteAssetsDir,
  questionAssetsDir,
  backupsDir
};
