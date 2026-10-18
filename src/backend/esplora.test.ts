import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { sha256 } from "@scure/btc-signer/utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, scriptHash } from "./backend";
import { esploraBackend } from "./esplora";
import { fakeBackend, fakeEsplora } from "./fake";

const BASE = "https://esplora.example/api";
const PARSE = { allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true };
// The worked example in the Electrum protocol basics:
// https://electrum-protocol.readthedocs.io/en/latest/protocol-basics.html
const SCRIPT = hex.decode("76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac");

function payment(n: number, script = SCRIPT): Uint8Array {
  const tx = new Transaction(PARSE);
  tx.addInput({ txid: n.toString(16).padStart(64, "0"), index: 0 });
  tx.addOutput({ script, amount: 1_000n });
  return tx.unsignedTx;
}

const failure = (backend: { connect(): Promise<void> }) =>
  backend.connect().then(
    () => null,
    (thrown: ConnectionError) => thrown.failure,
  );

afterEach(() => vi.unstubAllGlobals());

describe("asking an Esplora server", () => {
  it("names a script by its sha256 in byte order, not Electrum's reversed form", async () => {
    const paths: string[] = [];
    const backend = esploraBackend(BASE, {
      fetch: async (url) => {
        paths.push(url.slice(BASE.length));
        if (url.endsWith("/tip/hash")) return new Response("11".repeat(32));
        if (url.endsWith("/header")) return new Response("00".repeat(80));
        if (url.includes("/block/")) return new Response('{"height":1}');
        return new Response('{"chain_stats":{"tx_count":0},"mempool_stats":{"tx_count":0}}');
      },
    });
    await backend.connect();
    // electrs looks a scripthash up as the plain sha256 of the script:
    // https://github.com/Blockstream/electrs/blob/new-index/src/new_index/schema.rs (compute_script_hash)
    expect(await backend.history([scriptHash(SCRIPT)])).toEqual([[]]);
    expect(paths.at(-1)).toBe(`/scripthash/${hex.encode(sha256(SCRIPT))}`);
    backend.close();
  });

  it("pages through an address with more than one page of history", async () => {
    const blocks = Array.from({ length: 60 }, (_, i) => [payment(i + 1)]);
    const backend = fakeEsplora(fakeBackend({ startHeight: 100, blocks }));
    await backend.connect();
    const [history] = await backend.history([scriptHash(SCRIPT)]);
    expect(history!.map((entry) => entry.height)).toEqual(blocks.map((_, i) => 100 + i));
    backend.close();
  });

  it("refuses a history the server cut short rather than show a wrong balance", async () => {
    const tx = { txid: "22".repeat(32), status: { confirmed: true, block_height: 5 }, vin: [] };
    const backend = esploraBackend(BASE, {
      fetch: async (url) => {
        if (url.endsWith("/tip/hash")) return new Response("11".repeat(32));
        if (url.endsWith("/header")) return new Response("00".repeat(80));
        if (url.includes("/block/")) return new Response('{"height":5}');
        if (url.endsWith("/txs")) return new Response(JSON.stringify(Array(10).fill(tx)));
        return new Response('{"chain_stats":{"tx_count":14},"mempool_stats":{"tx_count":0}}');
      },
    });
    await backend.connect();
    await expect(backend.history([scriptHash(SCRIPT)])).rejects.toThrow(/10 of an address's 14 transactions/);
    backend.close();
  });

  it("keeps at most four requests open at once", async () => {
    let open = 0;
    let most = 0;
    const backend = esploraBackend(BASE, {
      fetch: async (url) => {
        most = Math.max(most, ++open);
        await new Promise((resolve) => setTimeout(resolve, 1));
        open--;
        if (url.endsWith("/tip/hash")) return new Response("11".repeat(32));
        if (url.endsWith("/header")) return new Response("00".repeat(80));
        if (url.includes("/block/")) return new Response('{"height":1}');
        return new Response('{"chain_stats":{"tx_count":0},"mempool_stats":{"tx_count":0}}');
      },
    });
    await backend.connect();
    await backend.history(Array.from({ length: 20 }, (_, i) => scriptHash(payment(i))));
    expect(most).toBe(4);
    backend.close();
  });
});

describe("staying current without subscriptions", () => {
  it("announces a new block on the next poll, with every watched address as changed", async () => {
    const backend = fakeEsplora(fakeBackend({ startHeight: 100, blocks: [[payment(1)]] }), 10);
    await backend.connect();
    const tips: number[] = [];
    const changed: string[] = [];
    await backend.subscribeHeaders((tip) => tips.push(tip.height));
    const watched = [scriptHash(SCRIPT), scriptHash(payment(2))];
    await backend.subscribeScriptHashes(watched, (hash) => changed.push(hash));

    backend.addBlock([]);
    await vi.waitFor(() => expect(tips).toEqual([101]));
    expect(changed).toEqual(watched);
    backend.close();
  });

  it("says it is reconnecting while the server is away, and connected when it is back", async () => {
    let down = false;
    const statuses: string[] = [];
    const backend = esploraBackend(BASE, {
      poll: 10,
      fetch: async (url) => {
        if (down) throw new TypeError("Failed to fetch");
        if (url.endsWith("/tip/hash")) return new Response("11".repeat(32));
        if (url.endsWith("/header")) return new Response("00".repeat(80));
        return new Response('{"height":1}');
      },
    });
    backend.onStatus((status) => statuses.push(status));
    await backend.connect();
    down = true;
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("retrying"));
    down = false;
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connected"));
    backend.close();
  });
});

describe("a connection that fails", () => {
  const unreachable = async (_: string, init?: RequestInit) => {
    if (init?.mode === "no-cors") return new Response(null, { status: 200 });
    throw new TypeError("Failed to fetch");
  };

  it("blames CORS when the server answers but the page may not read it", async () => {
    expect(await failure(esploraBackend(BASE, { fetch: unreachable }))).toBe("cors");
  });

  it("says something else answered when it is not an Esplora API", async () => {
    const html = async () => new Response("<!doctype html><title>Explorer</title>");
    expect(await failure(esploraBackend(BASE, { fetch: html }))).toBe("not-esplora");
  });

  it("says so when nothing answers in time", async () => {
    const silent = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    expect(await failure(esploraBackend(BASE, { fetch: silent }))).toBe("timeout");
  });

  it("says the connection was refused when nothing at all is there", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        onerror?: () => void;
        constructor() {
          setTimeout(() => this.onerror?.(), 0);
        }
        close() {}
      },
    );
    const nothing = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await failure(esploraBackend(BASE, { fetch: nothing }))).toBe("refused");
  });
});
