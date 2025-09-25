export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") return new Response("ok");

    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });

      let update;
      try { update = await request.json(); } catch { return new Response("ok"); }

      const chatId =
        update?.message?.chat?.id ??
        update?.edited_message?.chat?.id ??
        update?.callback_query?.message?.chat?.id;

      if (chatId) {
        const textIn = update?.message?.text;
        const reply =
`✅ Bot deployed on Cloudflare.
Send an IELTS Task 1/2 essay as text or photo to begin scoring.`;
        const body = new URLSearchParams({ chat_id: String(chatId), text: reply });
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
          method: "POST",
          body
        });
      }
      return new Response("ok");
    }

    if (url.pathname.startsWith("/api/miniapp/auth")) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" }});
    }

    return new Response("worker alive");
  }
}