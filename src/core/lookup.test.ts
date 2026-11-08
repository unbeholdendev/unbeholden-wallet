import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, type WalletBackend } from "../backend/backend";
import { electrumBackend } from "../backend/electrum";
import { fakeBackend, fakeEsplora, type FakeBackend } from "../backend/fake";
import { demoBackend, DEMO_FOREIGN, DEMO_TXIDS } from "../backend/fixture";
import { difficulty, lookupBlock, lookupTransaction } from "./lookup";

/** The fake chain behind a stand-in WebSocket that answers the Electrum calls a lookup makes. */
function fakeElectrum(fake: FakeBackend): WalletBackend {
  const answer = async (method: string, params: any[]): Promise<unknown> => {
    if (method === "server.version") return ["Fulcrum 2.1.3", "1.4"];
    if (method === "blockchain.headers.subscribe") {
      const tip = await fake.chainTip();
      return { height: tip.height, hex: hex.encode(tip.header) };
    }
    if (method === "blockchain.block.header") return hex.encode((await fake.blockHeaders([params[0]]))[0]!);
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
