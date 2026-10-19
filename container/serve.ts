import type { ServerWebSocket, Socket } from "bun";
import { normalize } from "node:path";

const root = process.env.ROOT ?? "dist";
const electrum = process.env.ELECTRUM?.match(/^(.+):(\d+)$/);
if (process.env.ELECTRUM && !electrum) throw new Error("ELECTRUM must be host:port");

const headers = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

type Link = { tcp: Socket; ws: { current?: ServerWebSocket<Link> } };

async function bridge(req: Request, server: Bun.Server<Link>) {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket only", { status: 426, headers });
  const ws: Link["ws"] = {};
  const decoder = new TextDecoder();
  let rest = "";
  const tcp = await Bun.connect({
    hostname: electrum![1]!,
    port: Number(electrum![2]),
    socket: {
      data(_, chunk) {
        const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
        rest = lines.pop()!;
        for (const line of lines) if (line.trim()) ws.current?.send(line);
      },
      close: () => ws.current?.close(),
      error: () => ws.current?.close(),
    },
  }).catch(() => null);
  if (!tcp) return new Response("Electrum server unreachable", { status: 502, headers });
  if (server.upgrade(req, { data: { tcp, ws } })) return undefined;
  tcp.end();
  return new Response("Bad WebSocket handshake", { status: 400, headers });
}

Bun.serve<Link>({
  port: 8080,
  async fetch(req, server) {
    const { pathname, host, protocol } = new URL(req.url);
    if (electrum && pathname === "/electrum") return bridge(req, server);
    if (electrum && pathname === "/electrum.json") {
      return Response.json({ url: `${protocol === "https:" ? "wss" : "ws"}://${host}/electrum` }, { headers });
    }
    const path = normalize(decodeURIComponent(pathname));
    const file = Bun.file(`${root}${path.endsWith("/") ? `${path}index.html` : path}`);
    const found = !path.includes("..") && (await file.exists());
    return new Response(found ? file : Bun.file(`${root}/index.html`), {
      headers: { ...headers, ...(path === "/sw.js" && { "Cache-Control": "no-cache" }) },
    });
  },
  websocket: {
    open: (ws) => void (ws.data.ws.current = ws),
    message: (ws, message) => void ws.data.tcp.write(`${message}\n`),
    close: (ws) => void ws.data.tcp.end(),
  },
});
