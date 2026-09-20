/**
 * 可插拔 AI 底座（对应调研报告方案 C 的"能力内聚、可替换零件"）
 * 业务层只依赖 generate() 的统一出参，换底座不改业务代码。
 *
 * ★ 安全铁律（2026-09-20 C1 收口）：**密钥一律不得出现在前端**。
 *   本文件曾存在 `dify` 模式：apiKey 存 localStorage + 浏览器直连 Dify 工作流。
 *   该旁路已**彻底移除**，原因有三：
 *     ① apiKey 落在 localStorage，任何能开 DevTools 的人都能读到；
 *     ② 浏览器直连会**绕过服务端二次脱敏**（前端脱敏可被改前端代码绕过）；
 *     ③ 用量不进 `ai_usage` 表，配置中心看不到真实消耗。
 *   现在只有两条路径：**server**（推荐，Key 由教务后端代持）/ **rule**（零配置降级）。
 *   若将来要接 Dify，必须由**服务端**代持其 Key 并转发，不得恢复浏览器直连。
 */
import type { Section } from "./templates";
import { agentToken, apiBase } from "../session";

/**
 * 底座模式：
 * - server：服务端模型（Key 存服务端，**不下发前端**）← 默认、推荐
 * - rule：规则引擎（零配置、零成本，无模型或调用失败时的降级路径）
 */
export type ProviderMode = "rule" | "server";

export type SceneKey =
  | "course_design"
  | "lesson_plan"
  | "teaching_flow"
  | "homework_design"
  | "grading_feedback"
  | "student_insight"
  | "class_diagnosis"
  | "parent_feedback"
  | "report_narrative";

export interface ProviderConfig {
  mode: ProviderMode;
  /** 成本单价（元/百万 tokens），默认取 V4-Flash 高峰价 */
  priceIn: number;
  priceOut: number;
  model: string;
}

const STORAGE_KEY = "ai-workbench:provider";

const VALID_MODES: ProviderMode[] = ["rule", "server"];

const DEFAULT_CONFIG: ProviderConfig = {
  mode: "server",
  priceIn: 3.0,
  priceOut: 9.0,
  model: "deepseek-v4-flash"
};

/** 运行时兜底：任何非白名单模式（如旧版 dify）一律回落到 server */
function normalizeMode(v: unknown): ProviderMode {
  return VALID_MODES.includes(v as ProviderMode) ? (v as ProviderMode) : DEFAULT_CONFIG.mode;
}

export function loadConfig(): ProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ProviderConfig> & {
      dify?: unknown;
    };
    // 兼容旧的 dify 版本配置：老配置里既有残留 apiKey（安全风险），
    // 又有已失效的 mode="dify"。这里把整个 dify 子树丢掉，并把 mode 收敛到白名单，
    // 然后**立刻覆写回去**，避免历史密钥继续留在用户浏览器里。
    const { dify: _drop, ...rest } = parsed;
    const cfg: ProviderConfig = {
      mode: normalizeMode(rest.mode),
      priceIn: typeof rest.priceIn === "number" ? rest.priceIn : DEFAULT_CONFIG.priceIn,
      priceOut: typeof rest.priceOut === "number" ? rest.priceOut : DEFAULT_CONFIG.priceOut,
      model: typeof rest.model === "string" && rest.model ? rest.model : DEFAULT_CONFIG.model
    };
    if ("dify" in parsed || parsed.mode !== cfg.mode) saveConfig(cfg);
    return cfg;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: ProviderConfig): void {
  // 只持久化白名单字段 —— 防止误把新加的敏感字段写进 localStorage 后无人察觉
  const safe: ProviderConfig = {
    mode: normalizeMode(cfg.mode),
    priceIn: cfg.priceIn,
    priceOut: cfg.priceOut,
    model: cfg.model
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

export interface RunInput {
  scene: SceneKey;
  /** 规则引擎段落（同时作为服务端模型不可用时的回退） */
  ruleSections: Section[];
  /** 已脱敏的载荷，作为 `/api/ai/generate` 的 payload（服务端会再脱敏一次） */
  safePayload: Record<string, unknown>;
}

export interface RunResult {
  sections: Section[];
  text: string;
  mode: ProviderMode;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  note: string;
}

export function sectionsToText(sections: Section[]): string {
  return sections.map(s => `【${s.title}】\n${s.body}`).join("\n\n");
}

/** 规则引擎：零依赖降级路径 */
function runRule(input: RunInput, cfg: ProviderConfig): RunResult {
  const text = sectionsToText(input.ruleSections);
  return {
    sections: input.ruleSections,
    text,
    mode: "rule",
    model: "规则引擎 v1（未启用模型）",
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    note: "当前为规则引擎生成：数字来自本地指标，文案由模板组织。切换到「服务端模型」可改为模型生成。"
  };
}

/**
 * 服务端模型：调用 `/api/ai/generate`，由教务后端持有 Key 并调用大模型。
 * 这是**唯一**的模型路径 —— Key 留在服务端，前端拿不到；
 * 服务端还会做二次脱敏（不信任前端）并把用量写入 `ai_usage`。
 */
async function runServer(input: RunInput, cfg: ProviderConfig): Promise<RunResult> {
  const token = agentToken();
  const res = await fetch(`${apiBase()}/api/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      scene: input.scene,
      payload: input.safePayload
    })
  });

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    data?: {
      text?: string;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
  };

  if (!res.ok || !json.success || !json.data?.text) {
    throw new Error(json.message || `服务端生成失败（HTTP ${res.status}）`);
  }

  const text = json.data.text;
  const tokensIn = Number(json.data.usage?.prompt_tokens || 0);
  const tokensOut = Number(json.data.usage?.completion_tokens || 0);

  return {
    sections: parseSections(text),
    text,
    mode: "server",
    model: json.data.model || cfg.model,
    tokensIn,
    tokensOut,
    cost: (tokensIn / 1_000_000) * cfg.priceIn + (tokensOut / 1_000_000) * cfg.priceOut,
    note: "由服务端模型生成；数字仍来自本地指标引擎，模型只负责表述与建议。"
  };
}

/** 把模型输出的纯文本切成段落（支持【标题】\n正文 与 Markdown 二级标题） */
function parseSections(text: string): Section[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let title = "";
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    if (title || body) sections.push({ title: title || "结果", body });
    buf = [];
  };

  for (const line of lines) {
    const bracket = line.match(/^【(.+?)】\s*$/);
    const md = line.match(/^#{2,3}\s*(.+?)\s*$/);
    if (bracket || md) {
      flush();
      title = (bracket ? bracket[1] : md![1]).trim();
    } else {
      buf.push(line);
    }
  }
  flush();

  return sections.length ? sections : [{ title: "结果", body: text.trim() }];
}

export interface GenerateOutcome extends RunResult {
  redacted: string[];
  elapsedMs: number;
  fallbackReason?: string;
}

/** 统一入口：按配置选择底座；服务端不可用时自动回退规则引擎并说明原因 */
export async function generate(
  input: RunInput,
  cfg: ProviderConfig = loadConfig()
): Promise<GenerateOutcome> {
  const started = performance.now();

  if (cfg.mode === "server") {
    try {
      const r = await runServer(input, cfg);
      return { ...r, redacted: [], elapsedMs: Math.round(performance.now() - started) };
    } catch (err) {
      // 模型不可用不阻塞教学流程：自动回退规则引擎，并在界面上标注原因
      const r = runRule(input, cfg);
      return {
        ...r,
        redacted: [],
        elapsedMs: Math.round(performance.now() - started),
        fallbackReason: err instanceof Error ? err.message : "模型调用异常"
      };
    }
  }

  const r = runRule(input, cfg);
  return { ...r, redacted: [], elapsedMs: Math.round(performance.now() - started) };
}
