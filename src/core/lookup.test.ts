import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Address, OutScript } from "@scure/btc-signer";
import { BroadcastError, NotFoundError, RefusedError, txidOf, type WalletBackend } from "../backend/backend";
import { electrumBackend } from "../backend/electrum";
import { fakeBackend, fakeEsplora, type FakeBackend } from "../backend/fake";
import { demoBackend, DEMO_FOREIGN, DEMO_TXIDS, DEMO_UNSENT } from "../backend/fixture";
import { NETWORKS } from "../wallet/network";
import { addressAmounts, decodeTransaction, difficulty, lookupAddress, lookupBlock, lookupTransaction } from "./lookup";

/** The fake chain behind a stand-in WebSocket that answers the Electrum calls a lookup makes. */
function fakeElectrum(fake: FakeBackend): WalletBackend {
  const answer = async (method: string, params: any[]): Promise<unknown> => {
    if (method === "server.version") return ["Fulcrum 2.1.3", "1.4"];
    if (method === "blockchain.headers.subscribe") {
      const tip = await fake.chainTip();
      return { height: tip.height, hex: hex.encode(tip.header) };
    }
    if (method === "blockchain.transaction.broadcast") return fake.broadcast(hex.decode(params[0]));
    if (method === "blockchain.block.header") return hex.encode((await fake.blockHeaders([params[0]]))[0]!);
    if (method === "blockchain.scripthash.get_balance") return (await fake.balances([params[0]]))[0];
    if (method === "blockchain.scripthash.listunspent") {
      const [outputs] = await fake.unspent([params[0]]);
      return outputs!.map((o) => ({ tx_hash: o.txid, tx_pos: o.vout, value: o.value, height: o.height ?? 0 }));
    }
    if (method === "blockchain.transaction.get") return hex.encode((await fake.transactions([params[0]]))[0]!);
    if (method === "blockchain.scripthash.get_history") {
      const [entries] = await fake.history([params[0]]);
      return entries!.map((e) => ({ tx_hash: e.txid, height: e.height ?? (e.unconfirmedParents ? -1 : 0) }));
    }
    throw new Error(`Not served: ${method}`);
  };
  vi.stubGlobal(
    "WebSocket",
    class {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      async send(text: string) {
        const requests = [JSON.parse(text)].flat();
        const replies = await Promise.all(
          requests.map(({ id, method, params }) =>
            answer(method, params).then(
              (result) => ({ id, result }),
              (error: Error) => ({ id, error: { code: 2, message: error instanceof NotFoundError ? "No such mempool or blockchain transaction. Use gettransaction for wallet transactions." : error.message } }),
            ),
          ),
        );
        this.onmessage?.({ data: JSON.stringify(replies) });
      }
      close() {}
    },
  );
  void fake.connect();
  return electrumBackend("ws://127.0.0.1:50003");
}

const servers: [string, (fake: FakeBackend) => WalletBackend][] = [
  ["the demo backend", (fake) => fake],
  ["Esplora", (fake) => fakeEsplora(fake)],
  ["Electrum", (fake) => fakeElectrum(fake)],
];

const PARSE = { allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true };

afterEach(() => vi.unstubAllGlobals());

describe.each(servers)("looking a transaction up on %s", (_, server) => {
  async function lookup(txid: string, fake = demoBackend()) {
    const backend = server(fake);
    await backend.connect();
    try {
      return await lookupTransaction(backend, txid, "mainnet");
    } finally {
      backend.close();
    }
  }

  it("gives its inputs with amounts and addresses, its outputs, fee and block", async () => {
    const tx = await lookup(DEMO_FOREIGN.confirmed);
    expect(tx).toMatchObject({
      txid: DEMO_FOREIGN.confirmed,
      // The fixture mines it 30 days of 144 blocks below its tip at 153 500.
      height: 149_180,
      fee: 1_400,
      rbf: true,
      inputs: [{ vout: 8, value: 50_000_000, address: expect.stringMatching(/^bc1q/) }],
      outputs: [
        { vout: 0, value: 12_000_000, address: DEMO_FOREIGN.address },
        { vout: 1, value: 37_998_600, address: expect.stringMatching(/^bc1q/) },
      ],
    });
    expect(tx!.vsize).toBeGreaterThan(0);
  });

  it("finds one still in the mempool, spending another that is too", async () => {
    expect(await lookup(DEMO_FOREIGN.pending)).toMatchObject({
      height: null,
      fee: 1_500,
      inputs: [{ txid: DEMO_TXIDS.meridian, vout: 1, value: 49_698_600 }],
    });
  });

  it("says when the server has no such transaction", async () => {
    expect(await lookup("ab".repeat(32))).toBeNull();
  });

  it("finds the block of one that pays only data, and sees it does not signal replaceability", async () => {
    const parent = new Transaction(PARSE);
    parent.addInput({ txid: "11".repeat(32), index: 0 });
    parent.addOutput({ script: hex.decode("0014" + "22".repeat(20)), amount: 10_000n });
    const burn = new Transaction(PARSE);
    burn.addInput({ txid: parent.id, index: 0, sequence: 0xffffffff });
    // OP_RETURN followed by one pushed byte: https://en.bitcoin.it/wiki/Script#Constants
    burn.addOutput({ script: hex.decode("6a0100"), amount: 0n });
    const fake = fakeBackend({ startHeight: 7, blocks: [[parent.unsignedTx], [burn.unsignedTx]] });
    expect(await lookup(burn.id, fake)).toMatchObject({ height: 8, rbf: false, fee: 10_000, outputs: [{ address: null }] });
  });
});

// The fake server's header time field, read here rather than through the code under test.
// https://developer.bitcoin.org/reference/block_chain.html
const headerTime = async (fake: FakeBackend, height: number) => {
  const [header] = await fake.blockHeaders([height]);
  return new DataView(header!.buffer, header!.byteOffset).getUint32(68, true);
};

describe.each(servers)("looking an address up on %s", (_, server) => {
  async function withBackend<T>(fake: FakeBackend, run: (backend: WalletBackend) => Promise<T>) {
    const backend = server(fake);
    await backend.connect();
    try {
      return await run(backend);
    } finally {
      backend.close();
    }
  }

  it("gives its balances, its history newest first with block times, and its unspent outputs", async () => {
    const fake = demoBackend();
    await fake.connect();
    const time = await headerTime(fake, 149_180);
    const found = await withBackend(fake, (backend) => lookupAddress(backend, DEMO_FOREIGN.address, "mainnet"));
    expect(found.balance).toEqual({ confirmed: 12_000_000, unconfirmed: 40_000_000 });
    expect(found.history).toEqual([
      { txid: DEMO_FOREIGN.pending, height: null, time: null },
      { txid: DEMO_FOREIGN.confirmed, height: 149_180, time },
    ]);
    expect(found.unspent).toEqual([
      { txid: DEMO_FOREIGN.confirmed, vout: 0, value: 12_000_000, height: 149_180 },
      { txid: DEMO_FOREIGN.pending, vout: 0, value: 40_000_000, height: null },
    ]);
  });

  it("fills in amounts a page at a time, fetching a spent coin's transaction from outside the page", async () => {
    const script = hex.decode("0014" + "33".repeat(20));
    const address = Address(NETWORKS.mainnet).encode(OutScript.decode(script));
    const payments = Array.from({ length: 30 }, (_, i) => {
      const t = new Transaction(PARSE);
      t.addInput({ txid: "11".repeat(32), index: i });
      t.addOutput({ script, amount: BigInt(1_000 + i) });
      return t;
    });
    const spend = new Transaction(PARSE);
    spend.addInput({ txid: payments[0]!.id, index: 0 });
    spend.addOutput({ script: hex.decode("0014" + "44".repeat(20)), amount: 900n });
    const fake = fakeBackend({ startHeight: 1, blocks: [...payments.map((p) => [p.unsignedTx]), [spend.unsignedTx]] });

    const [found, first, second] = await withBackend(fake, async (backend) => {
      const found = await lookupAddress(backend, address, "mainnet");
      const txids = found.history.map((entry) => entry.txid);
      return [found, await addressAmounts(backend, found, txids.slice(0, 25)), await addressAmounts(backend, found, txids.slice(25, 50))] as const;
    });
    expect(found.history).toHaveLength(31);
    expect(found.history[0]).toMatchObject({ txid: spend.id, height: 31 });
    expect(found.balance).toEqual({ confirmed: payments.slice(1).reduce((total, p) => total + Number(p.getOutput(0).amount), 0), unconfirmed: 0 });
    expect(found.unspent).toHaveLength(29);
    expect(first.size).toBe(25);
    expect(first.get(spend.id)).toBe(-1_000);
    expect(first.get(payments[29]!.id)).toBe(1_029);
    expect([...second.keys()]).toEqual(payments.slice(0, 6).map((p) => p.id).reverse());
    expect(second.get(payments[0]!.id)).toBe(1_000);
  });

  it("passes on the server's refusal of a history it holds too large, word for word", async () => {
    const fake = demoBackend();
    const refusing = { ...fake, history: () => Promise.reject(new RefusedError("history too large")) };
    const lookup = withBackend(refusing, (backend) => lookupAddress(backend, DEMO_FOREIGN.address, "mainnet"));
    await expect(lookup).rejects.toThrow(RefusedError);
    await expect(lookup).rejects.toThrow(/^history too large$/);
  });
});

describe.each(servers)("broadcasting a raw transaction through %s", (_, server) => {
  async function connected(fake: FakeBackend) {
    const backend = server(fake);
    await backend.connect();
    return backend;
  }

  it("reads its fee from the transactions it spends, then broadcasts it", async () => {
    const backend = await connected(demoBackend());
    const raw = hex.decode(DEMO_UNSENT);
    expect(await decodeTransaction(backend, raw, "mainnet")).toMatchObject({
      txid: txidOf(raw),
      fee: 2_500,
      inputs: [{ txid: DEMO_FOREIGN.confirmed, vout: 1, value: 37_998_600, address: expect.stringMatching(/^bc1q/) }],
      outputs: [{ vout: 0, value: 37_996_100 }],
    });
    expect(await backend.broadcast(raw)).toBe(txidOf(raw));
    expect(await lookupTransaction(backend, txidOf(raw), "mainnet")).toMatchObject({ height: null, fee: 2_500 });
    backend.close();
  });

  it("leaves the amount and fee unknown when the server lacks a transaction it spends", async () => {
    const backend = await connected(demoBackend());
    const orphan = new Transaction(PARSE);
    orphan.addInput({ txid: "ab".repeat(32), index: 0 });
    orphan.addOutput({ script: hex.decode("0014" + "22".repeat(20)), amount: 10_000n });
    expect(await decodeTransaction(backend, orphan.unsignedTx, "mainnet")).toMatchObject({ fee: null, inputs: [{ value: null, address: null }] });
    backend.close();
  });

  it("keeps the amounts of the inputs whose transactions the server has, when it lacks another's", async () => {
    const backend = await connected(demoBackend());
    const mixed = new Transaction(PARSE);
    mixed.addInput({ txid: DEMO_FOREIGN.confirmed, index: 1 });
    mixed.addInput({ txid: "ab".repeat(32), index: 0 });
    mixed.addOutput({ script: hex.decode("0014" + "22".repeat(20)), amount: 10_000n });
    expect(await decodeTransaction(backend, mixed.unsignedTx, "mainnet")).toMatchObject({
      fee: null,
      inputs: [{ value: 37_998_600, address: expect.stringMatching(/^bc1q/) }, { value: null, address: null }],
    });
    backend.close();
  });

  it("hands back the node's reason for refusing it, verbatim", async () => {
    const reason = "bad-txns-inputs-missingorspent";
    const backend = await connected(fakeBackend({ broadcastRejection: reason }));
    const error = await backend.broadcast(hex.decode(DEMO_UNSENT)).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(BroadcastError);
    expect((error as Error).message).toBe(reason);
    backend.close();
  });
});

describe("a block's difficulty", () => {
  it("is the highest target over its own, from the compact bits", () => {
    // https://en.bitcoin.it/wiki/Difficulty#How_is_difficulty_calculated.3F_What_is_the_difference_between_bdiff_and_pdiff.3F
    expect(difficulty(0x1d00ffff)).toBe(1);
    expect(difficulty(0x1b0404cb)).toBeCloseTo(16307.420938523983, 9);
    // https://blockstream.info/api/block/0000000000000acb845049f313d9bc7d020491c49e0663cba1ffa234f596de2c
    expect(difficulty(437129626)).toBeCloseTo(1192497.7500894784, 6);
  });
});

describe.each(servers)("looking a block up on %s", (_, server) => {
  it("gives its hash, time and difficulty from the header", async () => {
    const fake = demoBackend();
    const backend = server(fake);
    await backend.connect();
    try {
      const block = await lookupBlock(backend, 153_499);
      const tip = await fake.chainTip();
      // The previous block's hash, least-significant byte first, at bytes 4 to 36: https://developer.bitcoin.org/reference/block_chain.html
      expect(block.hash).toBe(hex.encode(tip.header.slice(4, 36).reverse()));
      expect(block).toMatchObject({ height: 153_499, time: 1_700_000_000 + 153_499 * 600 });
      expect(block.difficulty).toBeCloseTo(1192497.75, 2);
    } finally {
      backend.close();
    }
  });
});
