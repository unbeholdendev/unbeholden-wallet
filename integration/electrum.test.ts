import { hex } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BroadcastError,
  scriptHash,
  type BlockHeader,
  type HistoryEntry,
} from "../src/backend/backend";
import { electrumBackend, type ElectrumBackend } from "../src/backend/electrum";
import {
  address,
  BIP84,
  BIP86,
  buildFixture,
  coin,
  ELECTRUM_WS,
  mine,
  reorg,
  rpc,
  script,
  sign,
  type Fixture,
  type TestWallet,
} from "../scripts/regtest/fixture";

// Field offsets: https://developer.bitcoin.org/reference/block_chain.html
function blockHash(header: Uint8Array): string {
  return hex.encode(sha256(sha256(header)).reverse());
}

function previousHash(header: Uint8Array): string {
  return hex.encode(header.slice(4, 36).reverse());
}

const ADDRESSES: [TestWallet, number, number][] = [
  [BIP84, 0, 0],
  [BIP84, 0, 1],
  [BIP84, 0, 2],
  [BIP84, 0, 3],
  [BIP84, 0, 4],
  [BIP84, 1, 0],
  [BIP84, 1, 1],
  [BIP86, 0, 0],
  [BIP86, 0, 1],
  [BIP86, 1, 0],
];
const HASHES = ADDRESSES.map(([wallet, chain, index]) =>
  scriptHash(script(wallet, chain, index)),
);

const byPosition = (a: HistoryEntry, b: HistoryEntry) =>
  (a.height ?? Infinity) - (b.height ?? Infinity) || a.txid.localeCompare(b.txid);

/** Each scripthash's history as bitcoind sees it, from outputs and prevouts. */
async function bitcoindHistory(txids: string[]): Promise<HistoryEntry[][]> {
  const histories = new Map<string, HistoryEntry[]>(HASHES.map((hash) => [hash, []]));
  for (const txid of txids) {
    const tx = await rpc("getrawtransaction", txid, true);
    const height = tx.blockhash
      ? (await rpc("getblockheader", tx.blockhash)).height
      : null;
    const unconfirmedParents =
      height === null && (await rpc("getmempoolentry", txid)).depends.length > 0;
    const spent = await Promise.all(
      tx.vin.map(async (input: any) =>
        (await rpc("getrawtransaction", input.txid, true)).vout[input.vout],
      ),
    );
    const scripts = [...tx.vout, ...spent].map((out: any) => out.scriptPubKey.hex);
    const touched = new Set(scripts.map((s: string) => scriptHash(hex.decode(s))));
    for (const hash of touched) {
      histories.get(hash)?.push({ txid, height, unconfirmedParents });
    }
  }
  return HASHES.map((hash) => histories.get(hash)!.sort(byPosition));
}

async function electrumHistory(backend: ElectrumBackend) {
  return (await backend.history(HASHES)).map((entries) => entries.sort(byPosition));
}

async function caughtUp(backend: ElectrumBackend, txids: string[]) {
  const expected = await bitcoindHistory(txids);
  await vi.waitFor(async () => {
    expect(await electrumHistory(backend)).toEqual(expected);
  }, { timeout: 10_000, interval: 200 });
}

let fixture: Fixture;
let backend: ElectrumBackend;

beforeAll(async () => {
  fixture = await buildFixture();
  backend = electrumBackend(ELECTRUM_WS);
  await backend.connect();
  await caughtUp(backend, fixture.txids);
});

afterAll(() => backend.close());

describe("the fixture's wallet", () => {
  it("has the history bitcoind has, for every scripthash", async () => {
    const histories = await electrumHistory(backend);
    expect(histories).toEqual(await bitcoindHistory(fixture.txids));

    const entry = (txid: string) =>
      histories.flat().find((e) => e.txid === txid);
    expect(entry(fixture.confirmedSpend)?.height).toBeGreaterThan(0);
    expect(entry(fixture.unconfirmedChange)).toMatchObject({ height: null, unconfirmedParents: false });
    expect(entry(fixture.unconfirmedIncoming)).toMatchObject({ height: null, unconfirmedParents: false });
    expect(entry(fixture.unconfirmedParents)).toMatchObject({ height: null, unconfirmedParents: true });
  });

  it("has the transactions bitcoind has", async () => {
    const raws = await backend.transactions(fixture.txids);
    const expected = await Promise.all(
      fixture.txids.map((txid) => rpc("getrawtransaction", txid)),
    );
    expect(raws.map((raw) => hex.encode(raw))).toEqual(expected);
  });

  it("has the headers bitcoind has, tip included", async () => {
    const tip = await backend.chainTip();
    const heights = Array.from({ length: tip.height + 1 }, (_, h) => h);
    const headers = await backend.blockHeaders(heights);
    const expected = await Promise.all(
      heights.map(async (h) => rpc("getblockheader", await rpc("getblockhash", h), false)),
    );
    expect(headers.map((header) => hex.encode(header))).toEqual(expected);
    expect(blockHash(tip.header)).toBe(await rpc("getbestblockhash"));
  });

  it("serves a fee histogram", async () => {
    for (const { feeRate, vsize } of await backend.feeHistogram()) {
      expect(feeRate).toBeGreaterThan(0);
      expect(vsize).toBeGreaterThan(0);
    }
  });
});

describe("subscriptions", () => {
  it("hear a new block", async () => {
    const tips: BlockHeader[] = [];
    const unsubscribe = await backend.subscribeHeaders((tip) => tips.push(tip));
    const [hash] = await mine();
    await vi.waitFor(() => expect(tips.map((t) => blockHash(t.header))).toContain(hash));
    expect((await backend.chainTip()).height).toBe(await rpc("getblockcount"));
    unsubscribe();
    await caughtUp(backend, fixture.txids);
  });

  it("hear a payment arrive in the mempool, and confirm", async () => {
    const watched = scriptHash(script(BIP84, 0, 4));
    const heard: string[] = [];
    const unsubscribe = await backend.subscribeScriptHashes(
      [watched, scriptHash(script(BIP86, 0, 1))],
      (hash) => heard.push(hash),
    );
    const txid = await rpc("sendtoaddress", address(BIP84, 0, 4), 0.01);
    fixture.txids.push(txid);
    await vi.waitFor(() => expect(heard).toEqual([watched]));
    await mine();
    await vi.waitFor(() => expect(heard).toEqual([watched, watched]));
    unsubscribe();
    await caughtUp(backend, fixture.txids);
  });
});

describe("a reorg", () => {
  it("shows as a tip that does not extend the previous one", async () => {
    const before = await backend.chainTip();
    const tips: BlockHeader[] = [];
    const unsubscribe = await backend.subscribeHeaders((tip) => tips.push(tip));
    await reorg(1);

    await vi.waitFor(() => expect(tips.at(-1)?.height).toBe(before.height + 1));
    const after = tips.at(-1)!;
    expect(previousHash(after.header)).not.toBe(blockHash(before.header));
    expect(blockHash(after.header)).toBe(await rpc("getbestblockhash"));
    unsubscribe();
    await caughtUp(backend, fixture.txids);
  });
});

describe("broadcasting", () => {
  it("hands a transaction to the node and returns its txid", async () => {
    const tx = sign(
      [await coin(fixture.unspentFunding, BIP84, 0, 1)],
      [{ address: address(BIP84, 1, 1), amount: 50_000_000n - 1_000n }],
    );
    expect(await backend.broadcast(tx.extract())).toBe(tx.id);
    expect(await rpc("getmempoolentry", tx.id)).toBeTruthy();
    fixture.txids.push(tx.id);
    await caughtUp(backend, fixture.txids);
  });

  it("carries bitcoind's reason when the node rejects it", async () => {
    const doubleSpend = sign(
      [await coin(fixture.spentFunding, BIP84, 0, 0)],
      [{ address: address(BIP86, 0, 1), amount: 100_000_000n - 2_000n }],
    );
    const error = await backend.broadcast(doubleSpend.extract()).catch((e: unknown) => e);
    const reason = await rpc("sendrawtransaction", doubleSpend.hex).catch(
      (e: Error) => e.message,
    );
    expect(error).toBeInstanceOf(BroadcastError);
    expect(reason).toMatch(/missingorspent/);
    expect((error as BroadcastError).message).toContain(reason);
  });
});
