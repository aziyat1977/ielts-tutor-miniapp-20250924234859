export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/healthz") return new Response("ok");

    if (u.pathname === "/webhook" && request.method === "POST") {
      // Always 200 to keep Telegram happy
      let update; try { update = await request.json(); } catch { return new Response("ok"); }

      const chatId =
        update?.message?.chat?.id ??
        update?.edited_message?.chat?.id ??
        update?.callback_query?.message?.chat?.id;

      const text = update?.message?.text ?? "";

      if (chatId) {
        let reply;
        if (text.startsWith("/start")) {
          reply = "👋 Ready! Send your IELTS Task 1/2 essay as text.\nYou can also send a photo — OCR coming next.";
        } else if (text.length) {
          reply = "✅ Received your message.\nThis minimal build echoes back while we wire scoring.";
        } else {
          reply = "📩 Send text to begin.";
        }

        const body = new URLSearchParams({ chat_id: String(chatId), text: reply });
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, { method: "POST", body });
      }
      return new Response("ok");
    }

    // Mini-app auth stub
    if (u.pathname.startsWith("/api/miniapp/auth")) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" }});
    }

    return new Response("worker alive");
  }
}