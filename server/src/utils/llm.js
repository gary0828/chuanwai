// 大模型调用封装（OpenAI 兼容协议：DeepSeek / 任意兼容端点）
//
// 设计约束（对应调研报告 D5 / R3 / C4）：
// 1. **Key 只存服务端环境变量**，绝不下发前端 —— 前端存 Key 等于公开；
// 2. 出网内容必须经 utils/redact.js 白名单过滤后再发送，且过滤在服务端做（不依赖前端自律）；
// 3. 未配置 Key 时抛 `LLM_NOT_CONFIGURED`，由调用方决定降级，不阻塞主流程；
// 4. 数值一律由本地指标引擎算出，模型只负责措辞，避免幻觉。
const config = require("../config");

function isConfigured() {
  return Boolean(config.llm.apiKey);
}

function currentModel() {
  return config.llm.model;
}

function endpoint() {
  return `${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
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

  const {
    temperature = 0.6,
    // 推理型模型的思维链会先消耗输出额度（实测约占 60%），给不足会导致正文被截断为空
    maxTokens = config.llm.maxTokens,
    timeoutMs = config.llm.timeoutMs
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llm.apiKey}`
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        // 抑制思维链：实测 reasoning_effort=none 可完全关闭推理（输出 token 直降约 90%），
        // 对文案生成类任务质量无可见下降；需要多步推理时可改为 medium / high
        ...(config.llm.reasoningEffort
          ? { reasoning_effort: config.llm.reasoningEffort }
          : {})
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

    return {
      text: String(content).trim(),
      model: json.model || config.llm.model,
      usage: {
        prompt_tokens: Number(json.usage?.prompt_tokens || 0),
        completion_tokens: Number(json.usage?.completion_tokens || 0),
        // 推理型模型的思维链 token 单独暴露，便于成本分析
        reasoning_tokens: Number(
          json.usage?.completion_tokens_details?.reasoning_tokens || 0
        )
      }
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

module.exports = { isConfigured, chat, currentModel, endpoint };
