// 版本化迁移执行器：按 PRAGMA user_version 顺序执行增量迁移
// 规则：
// - 迁移版本必须连续递增（禁止跳过或回退）
// - 每个迁移在事务内执行，失败自动回滚并终止启动
// - 需要重建表的迁移（如 v2）声明 disableForeignKeys，由本执行器在事务外切换
//   （PRAGMA foreign_keys 在事务内是 no-op）
//
// ★ 2026-10-18（深度测试 P2-10）：本模块额外暴露「代码期望的最新版本」与
//   「当前库待执行的迁移清单」，供 db.js 在**真正改库之前**做一致性备份
//   （见 db.js 的 preMigrateBackup）。备份/恢复校验也依赖 latestVersion
//   （备份 user_version 不得高于它）。
const migrations = [
  require("./001-init"),
  require("./002-user-role"),
  require("./003-class-head-teacher"),
  require("./004-schedules"),
  require("./005-terms"),
  require("./006-settings-notices"),
  require("./007-audit-logs"),
  require("./008-finance"),
  require("./009-hours-leads"),
  require("./010-family-reports"),
  require("./011-teaching-consumption"),
  require("./012-schedule-makeup"),
  require("./013-user-student-link"),
  require("./014-staff-only-crm"),
  require("./015-token-version"),
  require("./016-feedback"),
  require("./017-ai-settings"),
  require("./018-growth-timeline"),
  require("./019-todos"),
  require("./020-user-avatar"),
  require("./021-sessions-assignments"),
  require("./022-session-reschedule-rename"),
  require("./023-rooms"),
  require("./024-configurable-periods"),
  require("./025-period-constraints-schedules"),
  require("./026-question-bank"),
  require("./027-question-bank-recycle"),
  require("./028-question-subjects"),
  require("./029-hours-consumption-source"),
  require("./030-session-hours-soft-delete")
];

/** 代码内置的最新迁移版本（= 迁移列表里的最大 version） */
const latestVersion = migrations.reduce(
  (max, m) => Math.max(max, m.version),
  0
);

/** 读取数据库当前版本（PRAGMA user_version，缺省 0） */
function currentVersion(db) {
  return Number(db.prepare("PRAGMA user_version").get().user_version) || 0;
}

/**
 * 当前库待执行的迁移清单（按版本升序）。空数组 = 已是代码最新版本。
 * 注意：只读查询，不改库；db.js 用它在迁移前判断是否需要备份。
 */
function pending(db) {
  const current = currentVersion(db);
  return migrations.filter(m => m.version > current);
}

/**
 * 执行全部待迁移项。返回 { from, to }（迁移前后的 user_version），
 * 供调用方记录日志；失败仍按原约定抛错终止启动。
 */
function migrate(db) {
  const from = currentVersion(db);
  let current = from;

  for (const m of migrations) {
    if (m.version <= current) continue;
    if (m.version !== current + 1) {
      throw new Error(
        `迁移版本不连续：当前 v${current}，无法跳级执行 v${m.version}`
      );
    }

    if (m.disableForeignKeys) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
      current = m.version;
      console.log(`[migrate] 数据库已升级到 v${m.version}（${m.name}）`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(
        `迁移 v${m.version}（${m.name}）失败，已回滚：${e.message}`
      );
    } finally {
      if (m.disableForeignKeys) db.exec("PRAGMA foreign_keys = ON");
    }
  }

  return { from, to: current };
}

module.exports = {
  migrate,
  migrations,
  latestVersion,
  currentVersion,
  pending
};
