/**
 * 可插拔 AI 底座（对应调研报告方案 C 的"能力内聚、可替换零件"）
 * - rule：规则引擎，零配置、零成本，原型默认
 * - dify：Dify 工作流，配置 endpoint / apiKey / 各场景 workflow id 后启用
 * 业务层只依赖 generate() 的统一出参，换底座不改业务代码。
 */
import type { Section } from "./templates";
import { agentToken, apiBase } from "../session";

/**
 * 底座模式：
 * - rule：规则引擎（零配置，默认）
 * - server：服务端模型（Key 存服务端环境变量，**不下发前端**）← 推荐
 * - dify：Dify 工作流（浏览器直连，需自行配置；生产建议走服务端代理）
 */
export type ProviderMode = "rule" | "server" | "dify";

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

export interface DifyConfig {
  endpoint: string;
  apiKey: string;
  /** 场景 → Dify 工作流 API Key（每个工作流可独立发布） */
  workflows: Partial<Record<SceneKey, string>>;
}

export interface ProviderConfig {
  mode: ProviderMode;
  dify: DifyConfig;
  /** 成本单价（元/百万 tokens），默认取 V4-Flash 高峰价 */
  priceIn: number;
  priceOut: number;
  model: string;
}

const STORAGE_KEY = "ai-workbench:provider";

const DEFAULT_CONFIG: ProviderConfig = {
  mode: "rule",
  dify: { endpoint: "http://127.0.0.1/v1", apiKey: "", workflows: {} },
  priceIn: 3.0,
  priceOut: 9.0,
  model: "deepseek-v4-flash"
};

export function loadConfig(): ProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ProviderConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      dify: { ...DEFAULT_CONFIG.dify, ...(parsed.dify || {}) }
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: ProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export interface RunInput {
  scene: SceneKey;
  /** 规则引擎段落（同时作为 dify 不可用时的回退） */
  ruleSections: Section[];
  /** 已脱敏的载荷，可直接作为 Dify 工作流 inputs */
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

function estimateTokens(text: string): number {
  // 中文约 1.6 字/token 的粗略换算，仅用于成本量级展示
  return Math.max(1, Math.round(text.length / 1.6));
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
    note: "当前为规则引擎生成：数字来自本地指标，文案由模板组织。配置 Dify 后可切换为模型生成。"
  };
}

interface DifyResponse {
  data?: { outputs?: Record<string, unknown>; usage?: Record<string, unknown> };
  message?: string;
}

/** Dify 工作流：需要 endpoint + 对应场景的 apiKey */
async function runDify(input: RunInput, cfg: ProviderConfig): Promise<RunResult> {
  const key = cfg.dify.workflows[input.scene] || cfg.dify.apiKey;
  if (!cfg.dify.endpoint || !key) {
    throw new Error("Dify 未配置（缺少 endpoint 或 apiKey）");
  }

  const res = await fetch(`${cfg.dify.endpoint.replace(/\/$/, "")}/workflows/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      inputs: { ...input.safePayload, scene: input.scene },
      response_mode: "blocking",
      user: "teacher-workbench"
    })
  });

  if (!res.ok) {
    throw new Error(`Dify 调用失败：HTTP ${res.status}`);
  }

  const json = (await res.json()) as DifyResponse;
  const outputs = json.data?.outputs || {};
  const raw = outputs.text ?? outputs.result ?? outputs.answer;

  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Dify 返回内容为空");
  }

  const sections = parseSections(raw);
  const usage = json.data?.usage || {};
  const tokensIn = Number(usage.prompt_tokens ?? estimateTokens(JSON.stringify(input.safePayload)));
  const tokensOut = Number(usage.completion_tokens ?? estimateTokens(raw));

  return {
    sections,
    text: raw,
    mode: "dify",
    model: `Dify · ${cfg.model}`,
    tokensIn,
    tokensOut,
    cost:
      (tokensIn / 1_000_000) * cfg.priceIn + (tokensOut / 1_000_000) * cfg.priceOut,
    note: "由 Dify 工作流生成；数字仍来自本地指标引擎，模型只负责表述。"
  };
}

/**
 * 服务端模型：调用 `/api/ai/generate`，由教务后端持有 Key 并调用大模型。
 * 这是推荐路径 —— Key 留在服务端，前端拿不到。
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

/** 统一入口：按配置选择底座；Dify 失败自动回退规则引擎并说明原因 */
export async function generate(
  input: RunInput,
  cfg: ProviderConfig = loadConfig()
): Promise<GenerateOutcome> {
  const started = performance.now();

  if (cfg.mode === "server" || cfg.mode === "dify") {
    try {
      const r =
        cfg.mode === "server"
          ? await runServer(input, cfg)
          : await runDify(input, cfg);
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
