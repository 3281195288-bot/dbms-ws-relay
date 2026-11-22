// 众包骑手模拟器 · 联网中继服务器（HTTP + WebSocket 广播）
// 部署到 Render / Railway / Fly.io / VPS 后，把 WebSocket 地址填进游戏管理面板。
//
// 本地运行：
//   npm install
//   npm start
// 浏览器里可用 ws://127.0.0.1:10000/ws 测试。
//
// 平台上一般会注入 PORT 环境变量，Node 需监听 0.0.0.0。

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 10000;

// 健康检查：平台探活、也方便浏览器打开确认服务活着
const server = http.createServer((req, res) => {
  try {
    if (req.url === "/" || req.url === "/health" || req.url === "/healthz") {
      const body = JSON.stringify({ ok: true, service: "dbms-ws-relay", clients: clients.size });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (err) {
    console.error("[http] 处理失败：", err);
    try { res.writeHead(500); res.end("error"); } catch (e) {}
  }
});

process.on("uncaughtException", (err) => console.error("[uncaught]", err));

// WebSocket 挂在任意路径上（推荐 /ws）
const wss = new WebSocketServer({ server });

const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[+] 连接建立，当前连接数 ${clients.size}`);

  // 给新连接回一份当前在线快照（可选，客户端也会自行心跳）
  ws.send(JSON.stringify({ t: "hello", clients: clients.size }));

  ws.on("message", (raw) => {
    let text;
    try {
      text = raw.toString();
      JSON.parse(text); // 只转发合法 JSON
    } catch (e) {
      return;
    }
    for (const client of clients) {
      if (client !== ws && client.readyState === 1) client.send(text);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[-] 连接关闭，当前连接数 ${clients.size}`);
  });

  ws.on("error", (err) => {
    console.error("连接错误：", err.message);
    clients.delete(ws);
  });
});

// 保活：清理僵死连接（Render 免费实例空闲 15 分钟会休眠，有 WS 流量可维持）
setInterval(() => {
  for (const ws of clients) if (ws.readyState !== 1) clients.delete(ws);
}, 30000);

// 优雅退出，部署替换实例时不断得难看
process.on("SIGTERM", () => {
  console.log("收到 SIGTERM，正在关闭…");
  for (const ws of clients) { try { ws.close(1001, "server shutdown"); } catch (e) {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ 联网中继已启动：http://0.0.0.0:${PORT}  WebSocket: /ws`);
});
