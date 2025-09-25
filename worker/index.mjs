export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/healthz") return new Response("ok");

    if (u.pathname === "/webhook" && request.method === "POST") {
      const secret = u.searchParams.get("secret");
      if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) return new Response("ok"); // ACK anyway
      let update; try { update = await request.json(); } catch { return new Response("ok"); }

      const msg  = update?.message ?? update?.edited_message ?? update?.callback_query?.message;
      const from = update?.message?.from ?? update?.edited_message?.from ?? update?.callback_query?.from;
      const chatId = msg?.chat?.id;
      const textIn = update?.message?.text ?? "";

      if (!chatId) return new Response("ok");

      // Upsert user
      try {
        if (env.DB) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO users(tg_id, username, lang) VALUES(?, ?, ?)"
          ).bind(String(from?.id ?? chatId), from?.username ?? null, from?.language_code ?? null).run();
        }
      } catch {}

      // /start
      if (textIn.startsWith("/start")) {
        await sendText(env.TELEGRAM_TOKEN, chatId, "👋 Send an IELTS Task 1/2 essay:\n• Text (≥ 80 chars)\n• or a Photo (handwritten/chart) — I’ll OCR it.");
        return new Response("ok");
      }

      // PHOTO → OCR
      let essayText = textIn;
      const photos = update?.message?.photo;
      if (!essayText && Array.isArray(photos) && photos.length) {
        try {
          const best = photos[photos.length - 1]; // largest size
          const dataUrl = await downloadTelegramFileAsDataUrl(env.TELEGRAM_TOKEN, best.file_id);
          essayText = await ocrImage(env.OPENAI_API_KEY, dataUrl, env.OPENAI_MODEL || "gpt-4.1-mini");
        } catch {
          // fall through to prompt
        }
      }

      // TEXT → score
      if (essayText && essayText.length > 80) {
        try {
          const { overall, criteria, rewrite, tokens } = await scoreEssay(env.OPENAI_API_KEY, essayText, env.OPENAI_MODEL || "gpt-4.1-mini");
          try {
            if (env.DB) {
              await env.DB.prepare(`
                INSERT INTO essays(user_id, task_type, raw_text, tokens_used, band_overall, band_task, band_coherence, band_lexical, band_grammar, feedback_json)
                VALUES((SELECT id FROM users WHERE tg_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                String(from?.id ?? chatId),
                "task2",
                essayText,
                tokens ?? 0,
                Number(overall) ?? null,
                Number(criteria?.task_response?.band) ?? null,
                Number(criteria?.coherence?.band) ?? null,
                Number(criteria?.lexical?.band) ?? null,
                Number(criteria?.grammar?.band) ?? null,
                JSON.stringify({ overall, criteria, rewrite })
              ).run();
            }
          } catch {}

          let out = `🏁 Overall Band: ${overall}\n• Task Response: ${criteria?.task_response?.band}\n• Coherence: ${criteria?.coherence?.band}\n• Lexical: ${criteria?.lexical?.band}\n• Grammar: ${criteria?.grammar?.band}`;
          if (criteria?.task_response?.notes) out += `\n\nNotes:\n${criteria.task_response.notes}`;
          await sendText(env.TELEGRAM_TOKEN, chatId, out);
          if (rewrite) await sendText(env.TELEGRAM_TOKEN, chatId, "✍️ Suggested rewrite:\n\n" + rewrite);
          return new Response("ok");
        } catch {
          await sendText(env.TELEGRAM_TOKEN, chatId, "⚠️ Scoring failed. Send plain text or a clearer photo and try again.");
          return new Response("ok");
        }
      }

      // Prompt user
      await sendText(env.TELEGRAM_TOKEN, chatId, "📩 Send your full IELTS essay as text (≥ 80 chars) or a photo.");
      return new Response("ok");
    }

    return new Response("worker alive");
  }
}

async function sendText(token, chatId, text) {
  const body = new URLSearchParams({ chat_id: String(chatId), text });
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body });
}

// Download Telegram file -> base64 data URL (avoid leaking token to third parties)
async function downloadTelegramFileAsDataUrl(token, fileId) {
  const gf = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ file_id: fileId })
  }).then(r => r.json());
  const filePath = gf?.result?.file_path;
  if (!filePath) throw new Error("no file_path");
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`; // valid ~1 hour
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const mime = filePath.endsWith(".png") ? "image/png" : filePath.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

// Vision OCR via Chat Completions (image_url data: URL)
async function ocrImage(openaiKey, dataUrl, model) {
  const body = {
    model,
    messages: [
      { role: "system", content: "Extract the full essay text from the image. Return ONLY plain text with newlines where appropriate." },
      { role: "user", content: [
        { type: "text", text: "Read this image and transcribe the essay:" },
        { type: "image_url", image_url: { url: dataUrl } }
      ] }
    ]
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  const txt = data?.choices?.[0]?.message?.content ?? "";
  return txt.trim();
}

// Structured Outputs scoring
async function scoreEssay(openaiKey, essay, model) {
  const schema = {
    name: "ielts_scoring",
    schema: {
      type: "object",
      properties: {
        overall: { type: "number", minimum: 0, maximum: 9 },
        criteria: {
          type: "object",
          properties: {
            task_response: { type: "object", properties: { band: { type: "number" }, notes: { type: "string" } }, required: ["band","notes"] },
            coherence:     { type: "object", properties: { band: { type: "number" }, notes: { type: "string" } }, required: ["band","notes"] },
            lexical:       { type: "object", properties: { band: { type: "number" }, notes: { type: "string" } }, required: ["band","notes"] },
            grammar:       { type: "object", properties: { band: { type: "number" }, notes: { type: "string" } }, required: ["band","notes"] }
          },
          required: ["task_response","coherence","lexical","grammar"]
        },
        rewrite: { type: "string" }
      },
      required: ["overall","criteria"]
    },
    strict: true
  };

  const body = {
    model,
    messages: [
      { role: "system", content: "You are an IELTS Writing examiner. Score strictly by IELTS descriptors (Task 2 default). Output JSON only." },
      { role: "user", content: [{ type: "text", text: essay }] }
    ],
    response_format: { type: "json_schema", json_schema: schema }
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  return { overall: parsed.overall, criteria: parsed.criteria, rewrite: parsed.rewrite ?? null, tokens: data?.usage?.total_tokens ?? null };
}