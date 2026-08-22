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

  const provider = payload?.provider === "deepseek" ? "deepseek" : "openai";
  const config = getProviderConfig(provider, env);

  if (!config.apiKey) {
    return json(
      {
        error: "missing_api_key",
        answer: `${config.label} 还没有配置 API Key。请在 Cloudflare Pages 的 Secret 环境变量里添加 ${config.secretName}。`,
      },
      503,
    );
  }

  return provider === "deepseek"
    ? callDeepSeek(config, payload)
    : callOpenAI(config, payload);
}

export async function onRequestGet() {
  return json({ ok: true, message: "AI 教练接口已启用，请使用 POST 提问。" });
}

async function callOpenAI(config, payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_output_tokens: config.maxTokens,
      input: [
        systemMessage(),
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    return providerError(config.label, response);
  }

  const data = await response.json();
  const answer = extractResponseText(data);
  return json({
    answer: answer || "我看到了这手牌，但暂时没生成解释。你可以换个问法再试一次。",
    provider: config.provider,
    model: data.model || config.model,
    usage: normalizeUsage(data.usage),
  });
}

async function callDeepSeek(config, payload) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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

  if (!response.ok) {
    return providerError(config.label, response);
  }

  const data = await response.json();
  return json({
    answer: data?.choices?.[0]?.message?.content?.trim() || "我看到了这手牌，但暂时没生成解释。你可以换个问法再试一次。",
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

function getProviderConfig(provider, env) {
  if (provider === "deepseek") {
    return {
      provider,
      label: "DeepSeek",
      secretName: "DEEPSEEK_API_KEY",
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
      maxTokens: Number(env.DEEPSEEK_MAX_OUTPUT_TOKENS || env.OPENAI_MAX_OUTPUT_TOKENS || 500),
    };
  }

  return {
    provider: "openai",
    label: "Codex / OpenAI",
    secretName: "OPENAI_API_KEY",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    maxTokens: Number(env.OPENAI_MAX_OUTPUT_TOKENS || 500),
  };
}

function systemMessage() {
  return {
    role: "system",
    content:
      "你是福州麻将新手教练。只基于用户提供的手牌、金牌、候选弃牌和规则引擎结果解释牌效。回答要用中文，短句，适合新手。不要编造未提供的牌河、计分或对手信息。若规则引擎已有推荐，优先解释推荐原因；如果用户问他打的牌怎么样，要温和指出优缺点。",
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

function extractResponseText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();

  const parts = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}
