export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/healthz") return new Response("ok");

    if (u.pathname === "/webhook" && request.method === "POST") {
      // Always 200 to keep Telegram satisfied; only process when secret matches
      const secret = u.searchParams.get("secret");
      if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) return new Response("ok");
      let update; try { update = await request.json(); } catch { return new Response("ok"); }

      const msg = update?.message ?? update?.edited_message ?? update?.callback_query?.message;
      const from = update?.message?.from ?? update?.edited_message?.from ?? update?.callback_query?.from;
      const chatId = msg?.chat?.id;
      const text   = update?.message?.text ?? "";

      if (!chatId) return new Response("ok");

      // Upsert user in D1
      try {
        if (env.DB) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO users(tg_id, username, lang) VALUES(?, ?, ?)"
          ).bind(String(from?.id ?? chatId), from?.username ?? null, from?.language_code ?? null).run();
        }
      } catch (_) {}

      // /start handler
      if (text.startsWith("/start")) {
        await sendText(env.TELEGRAM_TOKEN, chatId, "👋 Ready! Send your IELTS Task 1/2 essay as text.\nPhotos (OCR) coming next.");
        return new Response("ok");
      }

      // Minimal scoring for text essays (skip short messages)
      if (text && text.length > 80) {
        let overall = null, criteria = null, rewrite = null, usageTokens = null, rawJson = null;

        try {
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
            model: env.OPENAI_MODEL || "gpt-4.1-mini",
            messages: [
              { role: "system", content: "You are an IELTS Writing examiner. Score strictly by IELTS descriptors (Task 2 default). Output JSON only." },
              { role: "user", content: [
                { type: "text", text: "Essay:" },
                { type: "text", text: text }
              ]}
            ],
            response_format: { type: "json_schema", json_schema: schema }
          };

          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const data = await r.json();
          const content = data?.choices?.[0]?.message?.content ?? "{}";
          rawJson = content;
          usageTokens = data?.usage?.total_tokens ?? null;

          const parsed = JSON.parse(content);
          overall  = parsed.overall;
          criteria = parsed.criteria;
          rewrite  = parsed.rewrite ?? null;

          // Store in D1
          try {
            if (env.DB) {
              await env.DB.prepare(`
                INSERT INTO essays(user_id, task_type, raw_text, tokens_used, band_overall, band_task, band_coherence, band_lexical, band_grammar, feedback_json)
                VALUES((SELECT id FROM users WHERE tg_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                String(from?.id ?? chatId),
                "task2",
                text,
                usageTokens ?? 0,
                Number(overall) ?? null,
                Number(criteria?.task_response?.band) ?? null,
                Number(criteria?.coherence?.band) ?? null,
                Number(criteria?.lexical?.band) ?? null,
                Number(criteria?.grammar?.band) ?? null,
                JSON.stringify(parsed)
              ).run();
            }
          } catch (_) {}

          // Reply
          let out = `🏁 Overall Band: ${overall}\n• Task Response: ${criteria?.task_response?.band}\n• Coherence: ${criteria?.coherence?.band}\n• Lexical: ${criteria?.lexical?.band}\n• Grammar: ${criteria?.grammar?.band}`;
          if (criteria?.task_response?.notes) out += `\n\nNotes:\n${criteria.task_response.notes}`;
          await sendText(env.TELEGRAM_TOKEN, chatId, out);
          if (rewrite) {
            await sendText(env.TELEGRAM_TOKEN, chatId, "✍️ Suggested rewrite:\n\n" + rewrite);
          }
        } catch (err) {
          await sendText(env.TELEGRAM_TOKEN, chatId, "⚠️ Scoring failed. Please send plain text (no photos) and try again.");
        }
        return new Response("ok");
      }

      // Default: prompt user
      await sendText(env.TELEGRAM_TOKEN, chatId, "📩 Send your full IELTS essay as text (≥ 80 chars).");
      return new Response("ok");
    }

    return new Response("worker alive");
  }
}

async function sendText(token, chatId, text) {
  const body = new URLSearchParams({ chat_id: String(chatId), text });
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body });
}