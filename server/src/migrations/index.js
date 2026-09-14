// 版本化迁移执行器：按 PRAGMA user_version 顺序执行增量迁移
// 规则：
// - 迁移版本必须连续递增（禁止跳过或回退）
// - 每个迁移在事务内执行，失败自动回滚并终止启动
// - 需要重建表的迁移（如 v2）声明 disableForeignKeys，由本执行器在事务外切换
//   （PRAGMA foreign_keys 在事务内是 no-op）
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
  require("./016-feedback")
];

function migrate(db) {
  let current = db.prepare("PRAGMA user_version").get().user_version;

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
}

module.exports = { migrate, migrations };
