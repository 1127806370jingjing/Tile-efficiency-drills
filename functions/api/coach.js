const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const question = String(payload?.question ?? "").trim();
  if (!question) {
    return json({ error: "missing_question" }, 400);
  }

  const config = getDeepSeekConfig(env);

  if (!config.apiKey) {
    return json(
      {
        error: "missing_api_key",
        answer: `${config.label} 还没有配置 API Key。请在 Cloudflare Pages 的 Secret 环境变量里添加 ${config.secretName}。`,
      },
      503,
    );
  }

  return callDeepSeek(config, payload);
}

export async function onRequestGet() {
  return json({ ok: true, message: "AI 教练接口已启用，请使用 POST 提问。" });
}

async function callDeepSeek(config, payload) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        messages: [
          systemMessage(),
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      }),
    });
  } catch (error) {
    return json(
      {
        error: "provider_fetch_failed",
        answer: `${config.label} 请求失败。请检查 API Key、模型名和服务地址。`,
        detail: String(error).slice(0, 500),
      },
      502,
    );
  }

  if (!response.ok) {
    return providerError(config.label, response);
  }

  const data = await response.json();
  return json({
    answer:
      cleanCoachText(data?.choices?.[0]?.message?.content ?? "") ||
      "我看到了这手牌，但暂时没生成解释。你可以换个问法再试一次。",
    provider: config.provider,
    model: data.model || config.model,
    usage: normalizeUsage(data.usage),
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function getDeepSeekConfig(env) {
  return {
    provider: "deepseek",
    label: "DeepSeek",
    secretName: "DEEPSEEK_API_KEY",
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: env.DEEPSEEK_MODEL || "deepseek-chat",
    maxTokens: Number(env.DEEPSEEK_MAX_OUTPUT_TOKENS || 500),
  };
}

function systemMessage() {
  return {
    role: "system",
    content:
      "你是福州麻将新手教练。只基于用户提供的手牌、金牌、候选弃牌和规则引擎结果解释牌效。回答要用中文，短句，适合新手。不要编造未提供的牌河、计分或对手信息。若规则引擎已有推荐，优先解释推荐原因；如果用户问他打的牌怎么样，要温和指出优缺点。不要使用 Markdown 格式，不要使用 **、#、表格或代码块。",
  };
}

async function providerError(label, response) {
  const detail = await response.text();
  return json(
    {
      error: "provider_error",
      answer: `${label} 暂时没有连上模型。错误码：${response.status}。`,
      detail: detail.slice(0, 500),
    },
    502,
  );
}

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

function cleanCoachText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
