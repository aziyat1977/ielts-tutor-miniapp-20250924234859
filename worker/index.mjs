addEventListener("fetch", event => event.respondWith(handle(event.request)));

async function handle(request) {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return new Response("ok");

  if (url.pathname === "/webhook" && request.method === "POST") {
    // Always 200 for Telegram. Secret check is soft.
    const secret = url.searchParams.get("secret");
    try { if (typeof WEBHOOK_SECRET !== "undefined" && secret !== WEBHOOK_SECRET) return new Response("ok"); } catch {}

    let update = {};
    try { update = await request.json(); } catch {}
    const chatId =
      update?.message?.chat?.id ??
      update?.edited_message?.chat?.id ??
      update?.callback_query?.message?.chat?.id;

    if (chatId) {
      const text = update?.message?.text ?? "";
      let reply;
      if (text.startsWith("/start")) {
        reply = "👋 Ready! Send your IELTS Task 1/2 essay as text (photo OCR next).";
      } else if (text.length) {
        reply = "✅ Received. Minimal echo while we wire scoring.";
      } else {
        reply = "📩 Send text to begin.";
      }
      const body = new URLSearchParams({ chat_id: String(chatId), text: reply });
      try {
        await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", { method: "POST", body });
      } catch {}
    }
    return new Response("ok");
  }

  return new Response("worker alive");
}