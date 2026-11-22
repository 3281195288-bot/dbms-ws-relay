// 众包骑手模拟器 · 联网中继（Cloudflare Workers + Durable Objects，免绑卡）
// 部署：npx wrangler deploy（见 wrangler.toml）
// 地址形如 https://dbms-ws-relay.<你的子域>.workers.dev
// 游戏管理面板填该 https 地址即可（游戏自动转 wss:// 并补 /ws）

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/healthz") {
      const id = env.RELAY.idFromName("global");
      const stub = env.RELAY.get(id);
      const res = await stub.fetch(new Request("https://relay/health")).catch(() => null);
      const body = res ? await res.json().catch(() => ({ ok: true })) : { ok: true };
      return json({ ok: true, service: "dbms-ws-relay", ...body });
    }

    if (url.pathname === "/ws") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const id = env.RELAY.idFromName("global");
      return env.RELAY.get(id).fetch(request);
    }

    return new Response("not found", { status: 404 });
  },
};

export class Relay {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === "/health") {
      return json({ clients: this.state.getWebSockets().length });
    }
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ t: "hello", clients: this.state.getWebSockets().length }));

    return new Response(null, { status: 101, webSocket: client });
  }

  // 收到的合法 JSON 原样广播给其他在线连接
  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    try {
      JSON.parse(message);
    } catch (e) {
      return;
    }
    for (const s of this.state.getWebSockets()) {
      if (s !== ws) {
        try { s.send(message); } catch (e) {}
      }
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "closed"); } catch (e) {}
  }

  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch (e) {}
  }
}
