// v17：AI 配置中心（数据库化配置 + 用量记录）
//
// 背景（2026-09-16 校区部署反馈）：此前改一个大模型 Key 要走
// 「编辑 .env → 重建镜像 → 重启容器」三步，对交给校区使用的系统不可接受。
//
// 设计：
// - `ai_settings`：键值型配置，**优先级高于环境变量**，改完立即生效、无需重启；
//   留空（删除该行）即回退到环境变量，保证两种配置方式可共存；
// - 只放 AI 相关配置，教务业务配置仍在 settings 表，避免职责混淆；
// - `ai_usage`：每次服务端生成后落一条用量（谁、什么场景、多少 token、多少成本），
//   供配置中心展示「本月用量」，也是后续做预算控制的依据。
module.exports = {
  version: 17,
  name: "AI 配置中心",
  up(db) {
    db.exec(`
      CREATE TABLE ai_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);

    db.exec(`
      CREATE TABLE ai_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL DEFAULT '',
        scene TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    db.exec("CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);");
  }
};
