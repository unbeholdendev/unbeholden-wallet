import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, scriptHash } from "../src/backend/backend";
import { electrumBackend, type ConnectionStatus } from "../src/backend/electrum";
import {
  address,
  BIP84,
  ELECTRUM_WS,
  ELECTRUM_WSS,
  rpc,
  script,
} from "../scripts/regtest/fixture";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(onSocket: (socket: Socket) => void): Promise<number> {
  const server = createServer(onSocket);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function failure(url: string, timeout?: number) {
  const thrown = await electrumBackend(url, { timeout })
    .connect()
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ConnectionError);
  return (thrown as ConnectionError).failure;
}

describe("a failed connection", () => {
  it("is refused when nothing listens", async () => {
    const port = await listen(() => {});
    servers.pop()!.close();
    expect(await failure(`ws://127.0.0.1:${port}`)).toBe("refused");
  });

  it("times out when the host never answers", async () => {
    const port = await listen(() => {});
    expect(await failure(`ws://127.0.0.1:${port}`, 1_000)).toBe("timeout");
  });

  it("is not Electrum when a WebSocket server will not speak it", async () => {
    // https://www.rfc-editor.org/rfc/rfc6455#section-1.3
    const guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const port = await listen((socket) => {
      socket.once("data", (data) => {
        const key = /sec-websocket-key: (.+)\r\n/i.exec(String(data))![1];
        const accept = createHash("sha1").update(key + guid).digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
            `Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
      });
    });
    expect(await failure(`ws://127.0.0.1:${port}`, 1_000)).toBe("not-electrum");
  });

  it("is a rejected certificate against the self-signed wss port", async () => {
    expect(await failure(ELECTRUM_WSS)).toBe("certificate-rejected");
  });

  it("is told apart from a refusal in a real browser too", async () => {
    const closed = await listen(() => {});
    servers.pop()!.close();
    const bundle = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        lib: { entry: "src/backend/electrum.ts", formats: ["iife"], name: "electrum" },
      },
    });
    const { output } = [bundle].flat()[0] as { output: { code: string }[] };
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: output[0]!.code });
      const failures = await page.evaluate(async (urls) => {
        const { electrumBackend } = (window as any).electrum;
        const found = [];
        for (const url of urls) {
          found.push(await electrumBackend(url).connect().catch((e: any) => e.failure));
        }
        return found;
      }, [ELECTRUM_WSS, `ws://127.0.0.1:${closed}`]);
      expect(failures).toEqual(["certificate-rejected", "refused"]);
    } finally {
      await browser.close();
    }
  });
});

describe("a working connection", () => {
  it("knows it is talking to Fulcrum", async () => {
    const backend = electrumBackend(ELECTRUM_WS);
    await backend.connect();
    expect(backend.server()).toEqual({
      software: expect.stringMatching(/^Fulcrum 2\.1\.3/),
      implementation: "Fulcrum",
    });
    backend.close();
  });

  it("reconnects after a drop and keeps its subscriptions", async () => {
    const live = new Set<Socket>();
    const port = await listen((client) => {
      const upstream = connect(50003, "127.0.0.1");
      live.add(client).add(upstream);
      client.pipe(upstream).pipe(client);
      for (const end of [client, upstream]) end.on("error", () => {});
    });
    const backend = electrumBackend(`ws://127.0.0.1:${port}`);
    const statuses: ConnectionStatus[] = [];
    backend.onStatus((status) => statuses.push(status));
    await backend.connect();

    const watched = scriptHash(script(BIP84, 0, 9));
    const heard: string[] = [];
    await backend.subscribeScriptHashes([watched], (hash) => heard.push(hash));

    for (const socket of live) socket.destroy();
    live.clear();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("retrying"));
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connected"), { timeout: 5_000 });
    expect(statuses).toEqual(["connecting", "connected", "retrying", "connected"]);

    await rpc("sendtoaddress", address(BIP84, 0, 9), 0.01);
    await vi.waitFor(() => expect(heard).toEqual([watched]), { timeout: 5_000 });
    backend.close();
    expect(statuses.at(-1)).toBe("disconnected");
  });
});
