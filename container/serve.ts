import type { ServerWebSocket, Socket } from "bun";
import { normalize } from "node:path";

const root = process.env.ROOT ?? "dist";
const electrum = process.env.ELECTRUM?.match(/^(?:(tcp|ssl):\/\/)?(.+):(\d+)$/);
if (process.env.ELECTRUM && !electrum) throw new Error("ELECTRUM must be host:port, tcp://host:port or ssl://host:port");

const headers = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const log = (event: string, detail: object = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

type Link = { tcp: Socket; ws: { current?: ServerWebSocket<Link> } };

async function bridge(req: Request, server: Bun.Server<Link>) {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket only", { status: 426, headers });
  const ws: Link["ws"] = {};
  const decoder = new TextDecoder();
  let rest = "";
  const tcp = await Bun.connect({
    hostname: electrum![2]!,
    port: Number(electrum![3]),
    // Electrum servers mostly use self-signed certificates, which clients accept without a CA.
    tls: electrum![1] === "ssl" && { rejectUnauthorized: false },
    socket: {
      data(_, chunk) {
        const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
        rest = lines.pop()!;
        for (const line of lines) if (line.trim()) ws.current?.send(line);
      },
      close: () => ws.current?.close(),
      error: () => ws.current?.close(),
    },
  }).catch((error) => (log("electrum unreachable", { message: String(error?.message ?? error) }), null));
  if (!tcp) return new Response("Electrum server unreachable", { status: 502, headers });
  if (server.upgrade(req, { data: { tcp, ws } })) return undefined;
  tcp.end();
  return new Response("Bad WebSocket handshake", { status: 400, headers });
}

log("listening", { port: 8080, electrum: !!electrum });

Bun.serve<Link>({
  port: 8080,
  maxRequestBodySize: 2000,
  async fetch(req, server) {
    const { pathname, host, protocol } = new URL(req.url);
    if (pathname === "/log" && req.method === "POST") {
      const body = await req.text();
      try {
        log("browser", { browser: JSON.parse(body) });
      } catch {
        return new Response(null, { status: 400, headers });
      }
      return new Response(null, { status: 204, headers });
    }
    log("request", { method: req.method, path: pathname });
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
    open: (ws) => {
      log("electrum open");
      ws.data.ws.current = ws;
    },
    message: (ws, message) => void ws.data.tcp.write(`${message}\n`),
    close: (ws) => {
      log("electrum close");
      ws.data.tcp.end();
    },
  },
});
