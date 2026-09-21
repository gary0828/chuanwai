// v19：待办（todos）
//
// 背景（2026-09-21）：系统此前**没有任何「待办」概念** —— 业务风险（学员余额将尽、
// 连续缺勤、线索未跟进、课评欠录）散落各页，没有机制告诉使用者"今天该做什么"。
// 顶栏铃铛的「待办」tab 长期显示的是模板演示数据。
//
// 设计：
// - **一张表 + 按角色过滤**：教务端（校区负责人）与 AI 工作台（一线老师）读**同一张表**，
//   靠 `owner_id` 区分归属；而不是两套表 —— 否则生成逻辑 / 权限 / 完成语义都要写两遍。
//   （用户 2026-09-21 拍板）
// - `source` = `manual`（手工创建）｜`auto`（L3 由业务事件自动生成）；
// - ★ `(source_type, source_ref_id, owner_id)` 建**部分唯一索引** —— 这是 L3 自动生成的
//   **幂等去重键**（同一来源对同一负责人只产生一条）。**在 L2 就建好，L3 无需再迁移**；
// - `priority` / `due_date`：用户拍板保留（"全要"）。
//
// 完整设计见 `docs/ROADMAP.md`「五之二、通知铃铛 + 待办功能」。
module.exports = {
  version: 19,
  name: "待办",
  up(db) {
    db.exec(`
      CREATE TABLE todos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT NOT NULL,
        content       TEXT NOT NULL DEFAULT '',
        owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        creator_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
        source_type   TEXT,
        source_ref_id INTEGER,
        status        TEXT NOT NULL DEFAULT '待办' CHECK (status IN ('待办', '已完成')),
        priority      TEXT NOT NULL DEFAULT '普通' CHECK (priority IN ('普通', '重要', '紧急')),
        due_date      TEXT,
        completed_at  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );

      -- 最高频查询：某人的待办列表（按状态过滤）
      CREATE INDEX idx_todos_owner_status ON todos (owner_id, status);
      -- 按截止日期排序 / 找逾期
      CREATE INDEX idx_todos_due ON todos (due_date);

      -- ★ L3 幂等去重键：同一来源 + 同一负责人，只允许存在一条自动待办。
      --   用部分索引（只约束 source_type 非空的自动待办），手工待办不受影响。
      CREATE UNIQUE INDEX uniq_todos_source
        ON todos (source_type, source_ref_id, owner_id)
        WHERE source_type IS NOT NULL;
    `);
  }
};
