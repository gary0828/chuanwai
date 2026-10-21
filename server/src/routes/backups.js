// 数据备份管理（仅 admin）：列表 / 手动备份 / 恢复 / 删除
//
// ★ 2026-10-18（备份/恢复安全）：恢复前校验（完整性/版本/核心表）在
//   utils/backup.js 内完成，失败会抛带 status 的错误；这里统一转成
//   400/404/500 的**中文 JSON 提示**，绝不把异常裸抛给统一错误处理。
//   恢复成功后的响应体保持原样（前端依赖它提示「服务即将重启」）。
const express = require("express");
const { auth, requireRole } = require("../middleware/auth");
const {
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup
} = require("../utils/backup");

const router = express.Router();

/** 备份列表 */
router.get("/", auth, requireRole("admin"), (_req, res) => {
  res.json({ success: true, data: listBackups() });
});

/** 手动备份 */
router.post("/", auth, requireRole("admin"), (_req, res) => {
  const info = createBackup();
  res.json({ success: true, data: info });
});

/** 恢复备份（恢复后进程退出，由容器自动重启加载备份库） */
router.post("/:filename/restore", auth, requireRole("admin"), (req, res) => {
  try {
    restoreBackup(req.params.filename);
  } catch (e) {
    // 校验失败（损坏/版本过高/非本系统备份）→ 400；文件不存在 → 404；
    // 写库失败 → 500。统一返回中文 message，前端可直接展示。
    const status = Number.isInteger(e?.status) ? e.status : 500;
    const message =
      status >= 500 ? `恢复失败：${e?.message || "服务器内部错误"}` : e.message;
    if (status >= 500) console.error("[backup] 恢复失败:", e);
    return res.status(status).json({ success: false, message });
  }
  // 先响应，再退出进程触发容器重启（响应体保持不变）
  res.json({
    success: true,
    message: "恢复成功，服务即将自动重启，请稍后刷新页面"
  });
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

/** 删除备份 */
router.delete("/:filename", auth, requireRole("admin"), (req, res) => {
  deleteBackup(req.params.filename);
  res.json({ success: true, data: null });
});

module.exports = router;
