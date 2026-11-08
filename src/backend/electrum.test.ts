import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, NotFoundError } from "./backend";
import { electrumBackend } from "./electrum";

describe("connecting from an https page", () => {
  afterEach(() => vi.unstubAllGlobals());

  function failure(url: string) {
    vi.stubGlobal("location", { protocol: "https:" });
    let tried = false;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          tried = true;
          throw new Error("No network in this test");
        }
      },
    );
    return electrumBackend(url)
      .connect()
      .then(
        () => null,
        (thrown: unknown) => ({
          failure: (thrown as Partial<ConnectionError>).failure,
          tried,
        }),
      );
  }

  it("refuses a plain ws:// server without trying it", async () => {
    expect(await failure("ws://node.example:50003")).toEqual({
      failure: "mixed-content",
      tried: false,
    });
  });

  it("still tries a plain ws:// server on this machine", async () => {
    expect((await failure("ws://127.0.0.1:50003"))?.tried).toBe(true);
  });
});

describe("a server that stops answering", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails the request instead of waiting forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      class {
        onopen?: () => void;
        onmessage?: (event: { data: string }) => void;
        constructor() {
          setTimeout(() => this.onopen?.(), 0);
        }
        send(text: string) {
          const { id, method } = JSON.parse(text);
          const result = { "server.version": ["Fulcrum 2.1.3", "1.4"], "blockchain.headers.subscribe": { height: 1, hex: "00".repeat(80) } }[
            method as string
          ];
          if (result) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id, result }) }), 0);
        }
        close() {}
      },
    );
    const backend = electrumBackend("ws://127.0.0.1:50003", { timeout: 1000 });
    const connecting = backend.connect();
    await vi.advanceTimersByTimeAsync(10);
    await connecting;
    const history = backend.history(["00".repeat(32)]);
    const failed = expect(history).rejects.toThrow("The server didn't answer in time");
    await vi.advanceTimersByTimeAsync(6000);
    await failed;
  });
});

describe("transaction RPC failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  // https://github.com/bitcoin/bitcoin/blob/master/src/rpc/rawtransaction.cpp
  // https://github.com/cculianu/Fulcrum/blob/master/src/Servers.cpp
  it.each([
    { code: -32603, message: "internal error", data: { retry: true } },
    { code: 2, message: "No such mempool or blockchain transaction. Use gettransaction for wallet transactions." },
    { code: 2, message: "daemon error: {'code': -5, 'message': 'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.'}" },
    { code: 2, message: "daemon error: connection refused" },
    { code: 2, message: "No such mempool transaction. Blockchain transactions are still in the process of being indexed" },
  ])("classifies $message", async (error) => {
    vi.stubGlobal("WebSocket", class {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor() { setTimeout(() => this.onopen?.(), 0); }
      send(text: string) {
        const { id, method } = JSON.parse(text);
        const result = method === "server.version" ? ["Fulcrum 2.1.3", "1.4"] : { height: 1, hex: "00".repeat(80) };
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
          method === "blockchain.transaction.get" ? { id, error } : { id, result },
        ) }));
      }
      close() {}
    });
    const backend = electrumBackend("ws://127.0.0.1:50003");
    await backend.connect();
    try {
      if (error.message.includes("No such mempool or blockchain transaction")) {
        await expect(backend.transactions(["ab".repeat(32)])).rejects.toBeInstanceOf(NotFoundError);
      } else {
        await expect(backend.transactions(["ab".repeat(32)])).rejects.toMatchObject(error);
        await expect(backend.transactions(["ab".repeat(32)])).rejects.not.toBeInstanceOf(NotFoundError);
      }
    } finally {
      backend.close();
    }
  });
});
