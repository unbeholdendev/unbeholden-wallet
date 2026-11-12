import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

async function start(env: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "serve-"));
  writeFileSync(join(root, "index.html"), "<!doctype html>");
  const port = await freePort();
  const child = spawn("bun", [join(import.meta.dirname, "serve.ts")], {
    env: { ...process.env, ROOT: root, HOST: "127.0.0.1", PORT: String(port), ...env },
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (chunk: Buffer) => chunk.toString().includes('"listening"') && resolve());
    child.on("exit", reject);
  });
  return { child, port };
}

function send(port: number, path: string, headers: Record<string, string>, method = "GET", body?: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("serve.ts with the Electrum bridge on", () => {
  let server: { child: ChildProcess; port: number };
  // Nothing listens on port 1, so a request that gets past the checks fails to reach Electrum.
  beforeAll(
    async () => (server = await start({ ELECTRUM: "127.0.0.1:1", ALLOWED_HOSTS: "wallet.example, other.example" })),
  );
  afterAll(() => server.child.kill());

  it("refuses a name it wasn't told about, as a DNS rebinding page sends", async () => {
    const host = `evil.example:${server.port}`;
    expect(await send(server.port, "/", { Host: host })).toBe(403);
    const upgrade = { Host: host, Origin: `http://${host}`, Upgrade: "websocket", Connection: "Upgrade" };
    expect(await send(server.port, "/electrum", upgrade)).toBe(403);
  });

  it("serves IP addresses, localhost and the names in ALLOWED_HOSTS", async () => {
    for (const host of ["127.0.0.1", "[::1]", "192.168.1.20", "localhost", "wallet.example", "other.example"]) {
      expect(await send(server.port, "/", { Host: `${host}:${server.port}` }), host).toBe(200);
    }
  });

  it("refuses a request from another site's page", async () => {
    const host = `127.0.0.1:${server.port}`;
    expect(await send(server.port, "/log", { Host: host, Origin: "http://attacker.invalid" }, "POST", "{}")).toBe(403);
    expect(await send(server.port, "/log", { Host: host, Origin: `http://${host}` }, "POST", "{}")).toBe(204);
  });
});

describe("serve.ts without the Electrum bridge", () => {
  let server: { child: ChildProcess; port: number };
  beforeAll(async () => (server = await start({ ELECTRUM: "" })));
  afterAll(() => server.child.kill());

  it("serves any name, since there is no relay to protect", async () => {
    expect(await send(server.port, "/", { Host: "app.wallet.unbeholden.dev" })).toBe(200);
  });

  it("still refuses another site's page", async () => {
    const headers = { Host: "app.wallet.unbeholden.dev", Origin: "http://attacker.invalid" };
    expect(await send(server.port, "/log", headers, "POST", "{}")).toBe(403);
  });
});
