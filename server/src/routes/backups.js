// 数据备份管理（仅 admin）：列表 / 手动备份 / 恢复 / 删除
const express = require("express");
const { auth, requireRole } = require("../middleware/auth");
const { createBackup, listBackups, deleteBackup, restoreBackup } = require("../utils/backup");

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
  const { filename } = req.params;
  restoreBackup(filename);
  // 先响应，再退出进程触发容器重启
  res.json({ success: true, message: "恢复成功，服务即将自动重启，请稍后刷新页面" });
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
