// 大模型调用封装（OpenAI 兼容协议：DeepSeek / 任意兼容端点）
//
// 设计约束（对应调研报告 D5 / R3 / C4）：
// 1. **Key 只存服务端环境变量**，绝不下发前端 —— 前端存 Key 等于公开；
// 2. 出网内容必须经 utils/redact.js 白名单过滤后再发送，且过滤在服务端做（不依赖前端自律）；
// 3. 未配置 Key 时抛 `LLM_NOT_CONFIGURED`，由调用方决定降级，不阻塞主流程；
// 4. 数值一律由本地指标引擎算出，模型只负责措辞，避免幻觉。
const config = require("../config");
const aiSettings = require("./aiSettings");

/**
 * 生效配置 = 数据库配置（AI 配置中心）优先，缺失回退环境变量。
 * 每次调用实时读取，因此界面上改完立即生效，不必重启容器。
 */
function effective() {
  return aiSettings.resolve();
}

function isConfigured() {
  return Boolean(effective().apiKey);
}

function currentModel() {
  return effective().model;
}

function endpoint() {
  return `${effective().baseUrl.replace(/\/$/, "")}/chat/completions`;
}

/**
 * 成本估算（元）。价格为 2026-08-17 生效的高峰价，取缓存未命中的保守值；
 * 仅用于界面展示量级，不作为对账依据。
 */
const PRICE_PER_MILLION = {
  "deepseek-flash": { input: 3, output: 9 },
  "deepseek-v4-pro": { input: 9, output: 27 }
};

function estimateCost(model, usage) {
  const p = PRICE_PER_MILLION[model] || PRICE_PER_MILLION["deepseek-flash"];
  const inCost = (Number(usage?.prompt_tokens || 0) * p.input) / 1_000_000;
  const outCost = (Number(usage?.completion_tokens || 0) * p.output) / 1_000_000;
  return Math.round((inCost + outCost) * 100000) / 100000;
}

/**
 * 发起一次对话补全。
 * @returns {Promise<{ text: string, model: string, usage: {prompt_tokens:number, completion_tokens:number} }>}
 */
async function chat(messages, options = {}) {
  if (!isConfigured()) {
    const err = new Error("服务端未配置模型（LLM_API_KEY 为空）");
    err.code = "LLM_NOT_CONFIGURED";
    throw err;
  }

  const cfg = effective();
  const {
    temperature = 0.6,
    // 推理型模型的思维链会先消耗输出额度（实测约占 60%），给不足会导致正文被截断为空
    maxTokens = cfg.maxTokens,
    timeoutMs = cfg.timeoutMs
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        // 抑制思维链：实测 reasoning_effort=none 可完全关闭推理（输出 token 直降约 90%），
        // 对文案生成类任务质量无可见下降；需要多步推理时可改为 medium / high
        ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {})
      }),
      signal: controller.signal
    });

    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }

    if (!res.ok) {
      const detail = json?.error?.message || raw.slice(0, 200) || `HTTP ${res.status}`;
      const err = new Error(`模型调用失败：${detail}`);
      err.code = "LLM_HTTP_ERROR";
      err.status = res.status;
      throw err;
    }

    const choice = json?.choices?.[0] || {};
    const content = choice.message?.content;
    if (!content || !String(content).trim()) {
      const reason = choice.finish_reason || "unknown";
      const reasoningLen = String(choice.message?.reasoning_content || "").length;
      const err = new Error(
        reason === "length"
          ? `模型输出被截断（finish_reason=length）：思维链已占满全部 ${maxTokens} 输出额度。请提高 LLM_MAX_TOKENS 或精简提示词`
          : `模型返回内容为空（finish_reason=${reason}，思维链 ${reasoningLen} 字）`
      );
      err.code = "LLM_EMPTY";
      err.finishReason = reason;
      throw err;
    }

    const usedModel = json.model || cfg.model;
    const usage = {
      prompt_tokens: Number(json.usage?.prompt_tokens || 0),
      completion_tokens: Number(json.usage?.completion_tokens || 0),
      // 推理型模型的思维链 token 单独暴露，便于成本分析
      reasoning_tokens: Number(
        json.usage?.completion_tokens_details?.reasoning_tokens || 0
      )
    };

    return {
      text: String(content).trim(),
      model: usedModel,
      cost: estimateCost(usedModel, usage),
      usage
    };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`模型调用超时（${timeoutMs} ms）`);
      timeoutErr.code = "LLM_TIMEOUT";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isConfigured,
  chat,
  currentModel,
  endpoint,
  estimateCost,
  effective
};
