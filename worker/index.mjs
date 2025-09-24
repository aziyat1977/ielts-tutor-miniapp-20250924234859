export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/webhook") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      if (request.method === "POST") return new Response("ok");
      return new Response("ok");
    }
    if (url.pathname.startsWith("/api/miniapp/auth")) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" }});
    }
    return new Response("worker alive");
  }
}