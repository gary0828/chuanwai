// AI 配置中心的数据层：配置存数据库，优先级高于环境变量，改完立即生效。
//
// 为什么这么做（2026-09-16 校区部署的真实反馈）：
// 改一个 Key 要「编辑 .env → 重建镜像 → 重启容器」，校区老师根本做不到，
// 而我作为开发者每次代劳也不现实。配置必须能在界面上改。
//
// 安全约定：
// 1. 只有白名单里的键可写，杜绝把 AI 配置表当成通用 KV 注入点；
// 2. 敏感值（Key）**永不明文回传**，只给掩码 `sk-****3f2a`；
// 3. 掩码值回传表示「不修改」，避免前端把掩码当成真 Key 存进去。
// 4. 保存时**只落库真正改动的项**：前端整表提交（页面一点保存就回传全部 10 个字段），
//    若照单全收，第一次保存就会把所有值钉进数据库，此后 .env 怎么改都无效。
//    因此与当前生效值相同的项直接跳过，保持「没碰过的项继续跟随环境变量」。
const db = require("../db");
const config = require("../config");

/** 可配置项白名单：键 -> 说明 */
const FIELDS = {
  llmApiKey: { label: "大模型 API Key", secret: true, env: () => config.llm.apiKey },
  llmBaseUrl: { label: "接口地址", secret: false, env: () => config.llm.baseUrl },
  llmModel: { label: "模型名", secret: false, env: () => config.llm.model },
  llmMaxTokens: {
    label: "输出额度上限",
    secret: false,
    env: () => String(config.llm.maxTokens)
  },
  llmReasoningEffort: {
    label: "思维链强度",
    secret: false,
    env: () => config.llm.reasoningEffort || ""
  },
  llmTimeoutMs: {
    label: "超时（毫秒）",
    secret: false,
    env: () => String(config.llm.timeoutMs)
  },
  aiWorkbenchUrl: { label: "工作台地址", secret: false, env: () => config.aiWorkbenchUrl },
  difyEndpoint: { label: "Dify 地址", secret: false, env: () => "" },
  difyApiKey: { label: "Dify 默认 API Key", secret: true, env: () => "" },
  difyWorkflows: { label: "各场景工作流 Key（JSON）", secret: true, env: () => "" }
};

const MASK_PREFIX = "__masked__";

function mask(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (s.length <= 8) return MASK_PREFIX;
  return `${MASK_PREFIX}${s.slice(0, 3)}****${s.slice(-4)}`;
}

function isMask(v) {
  return String(v ?? "").startsWith(MASK_PREFIX);
}

function readMap() {
  const rows = db.prepare("SELECT key, value, updated_by, updated_at FROM ai_settings").all();
  const map = {};
  for (const r of rows) map[r.key] = r;
  return map;
}

/** 给前端：敏感字段只给掩码，并标注「当前是否在用数据库值」 */
function readForDisplay() {
  const map = readMap();
  const fields = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    const row = map[key];
    const fromDb = Boolean(row && String(row.value).length > 0);
    const raw = fromDb ? row.value : def.env();
    fields[key] = {
      label: def.label,
      secret: def.secret,
      value: def.secret ? mask(raw) : raw,
      hasValue: Boolean(String(raw || "").length > 0),
      source: fromDb ? "db" : "env"
    };
  }
  const anyRow = Object.values(map)[0];
  return {
    fields,
    updatedBy: anyRow?.updated_by || "",
    updatedAt: anyRow?.updated_at || ""
  };
}

/** 保存：值为空串表示清除（回退到环境变量）；掩码值表示不修改；未知键忽略；
 *  与当前生效值相同的项不落库，避免「点一次保存就把全部字段钉死、从此 .env 再也改不动」。 */
function save(patch, username) {
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO ai_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  );
  const del = db.prepare("DELETE FROM ai_settings WHERE key = ?");

  const map = readMap();
  const changed = [];
  db.exec("BEGIN");
  try {
    for (const [key, raw] of Object.entries(patch || {})) {
      if (!FIELDS[key]) continue;
      const value = String(raw ?? "").trim();
      const row = map[key];
      const inDb = Boolean(row && String(row.value).length > 0);

      if (value === "") {
        if (inDb) {
          del.run(key);
          changed.push(key);
        }
        continue;
      }
      if (FIELDS[key].secret && isMask(value)) continue; // 前端没改，保持原值

      // 与「本来就会生效的值」相同 → 不写库，保住环境变量的可改性
      const effective = inDb ? String(row.value) : FIELDS[key].env();
      if (!inDb && value === String(effective ?? "").trim()) continue;

      upsert.run(key, value, username || "", now);
      changed.push(key);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return changed;
}

/**
 * 解析出真正生效的配置：数据库值优先，缺失则回退环境变量。
 * 每次调用都直接读库（本地 SQLite，开销可忽略），好处是改完无需重启。
 */
function resolve() {
  const map = readMap();
  const get = k => {
    const v = map[k]?.value;
    return v === undefined || String(v).trim() === "" ? null : String(v);
  };
  const num = (k, fallback) => {
    const v = Number(get(k));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  return {
    apiKey: get("llmApiKey") ?? config.llm.apiKey,
    baseUrl: get("llmBaseUrl") ?? config.llm.baseUrl,
    model: get("llmModel") ?? config.llm.model,
    reasoningEffort: get("llmReasoningEffort") ?? config.llm.reasoningEffort,
    maxTokens: num("llmMaxTokens", config.llm.maxTokens),
    timeoutMs: num("llmTimeoutMs", config.llm.timeoutMs),
    aiWorkbenchUrl: get("aiWorkbenchUrl") ?? config.aiWorkbenchUrl,
    dify: {
      endpoint: get("difyEndpoint") || "",
      apiKey: get("difyApiKey") || "",
      workflows: (() => {
        try {
          return JSON.parse(get("difyWorkflows") || "{}");
        } catch {
          return {};
        }
      })()
    }
  };
}

module.exports = { FIELDS, readForDisplay, save, resolve, mask, isMask };
