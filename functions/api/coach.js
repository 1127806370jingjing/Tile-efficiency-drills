const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.OPENAI_API_KEY) {
    return json(
      {
        error: "missing_openai_api_key",
        answer: "AI 教练还没有配置 OPENAI_API_KEY。上线到 Cloudflare 后，请在 Pages 项目的环境变量里添加这个 Secret。",
      },
      503,
    );
  }

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

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content:
            "你是福州麻将新手教练。只基于用户提供的手牌、金牌、候选弃牌和规则引擎结果解释牌效。回答要用中文，短句，适合新手。不要编造未提供的牌河、计分或对手信息。若规则引擎已有推荐，优先解释推荐原因；如果用户问他打的牌怎么样，要温和指出优缺点。",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return json(
      {
        error: "openai_error",
        answer: `AI 教练暂时没有连上模型。错误码：${response.status}。`,
        detail: detail.slice(0, 500),
      },
      502,
    );
  }

  const data = await response.json();
  const answer = extractResponseText(data);
  return json({ answer: answer || "我看到了这手牌，但暂时没生成解释。你可以换个问法再试一次。" });
}

export async function onRequestGet() {
  return json({ ok: true, message: "AI 教练接口已启用，请使用 POST 提问。" });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
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
