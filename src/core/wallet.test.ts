import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { p2wpkh } from "@scure/btc-signer/payment.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletBackend } from "../backend/backend";
import { fakeBackend, fakeEsplora, type FakeBackend } from "../backend/fake";
import { createVault, destroyVault, type Vault } from "../vault/vault";
import { descriptorFromExtendedKey, parseDescriptor } from "../wallet/descriptor";
import { derivePublicKeys } from "../wallet/derive";
import { selectCoins } from "../wallet/select";
import { BIP84_ZPUB, BIP86_XPUB } from "../wallet/vectors";
import { parseBip329 } from "./bip329";
import { openWallet, type WalletSession, type WalletSnapshot } from "./wallet";
import {
  createWallet,
  deleteWallet,
  getSettings,
  listWallets,
  renameWallet,
  saveSettings,
} from "./wallets";

const CHEAP = { m: 8, t: 1, p: 1 };
const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};
const DESCRIPTOR = `wpkh([d34db33f/84h/0h/0h]${BIP84_ZPUB}/<0;1>/*)`;
const ours = parseDescriptor(DESCRIPTOR, "mainnet");
const others = descriptorFromExtendedKey(BIP86_XPUB, "mainnet", "wpkh");

const mine = (chain: number, index: number) =>
  p2wpkh(derivePublicKeys(ours, "mainnet", chain, index)[0]!).script;
const theirs = (index: number) => p2wpkh(derivePublicKeys(others, "mainnet", 0, index)[0]!).script;

function tx(inputs: [string, number][], outputs: [Uint8Array, number][]): Uint8Array {
  const t = new Transaction(PARSE);
  for (const [txid, index] of inputs) t.addInput({ txid, index });
  for (const [script, amount] of outputs) t.addOutput({ script, amount: BigInt(amount) });
  return t.unsignedTx;
}
const id = (raw: Uint8Array) => Transaction.fromRaw(raw, PARSE).id;

const tap = theirs(0);
const faucet = tx(
  [["00".repeat(32), 0xffffffff]],
  Array.from({ length: 600 }, (): [Uint8Array, number] => [tap, 1_000_000]),
);
const FAUCET = id(faucet);
const pay1 = tx([[id(faucet), 0]], [[mine(0, 0), 100_000], [theirs(1), 899_000]]);
const pay2 = tx([[id(faucet), 1]], [[mine(0, 1), 50_000], [theirs(2), 949_000]]);
const spend = tx([[id(pay1), 0]], [[theirs(3), 60_000], [mine(1, 0), 39_000]]);
const foreignPay = tx([[id(faucet), 2]], [[mine(0, 2), 20_000], [theirs(4), 979_000]]);
const ownChange = tx([[id(spend), 1]], [[theirs(5), 10_000], [mine(1, 1), 28_000]]);
const foreignParent = tx([[id(faucet), 3]], [[theirs(6), 999_000]]);
const child = tx([[id(foreignParent), 0]], [[mine(0, 3), 5_000], [theirs(7), 993_000]]);

/** Heights 100 to 103. */
function chain(serve = (backend: FakeBackend) => backend): FakeBackend {
  return serve(fakeBackend({ startHeight: 100, blocks: [[faucet], [pay1], [pay2], [spend]] }));
}

function withMempool(serve?: (backend: FakeBackend) => FakeBackend): FakeBackend {
  const backend = chain(serve);
  for (const raw of [foreignPay, ownChange, foreignParent, child]) backend.addToMempool(raw);
  return backend;
}

const SERVERS: [string, (backend: FakeBackend) => FakeBackend][] = [
  ["the fake", (backend) => backend],
  ["Esplora", (backend) => fakeEsplora(backend)],
];

/** Records every call through the seam. */
function counting(backend: WalletBackend) {
  const calls: Record<string, unknown[][]> = {};
  const proxy = new Proxy(backend, {
    get(target, key: string) {
      const value = target[key as keyof WalletBackend];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        (calls[key] ??= []).push(args);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { backend: proxy, calls };
}

let vault: Vault;
let walletId: string;
const sessions: WalletSession[] = [];

beforeEach(async () => {
  vault = await createVault("passphrase", CHEAP);
  walletId = (await createWallet(vault, { name: "Savings", descriptor: DESCRIPTOR, network: "mainnet" })).id;
});

afterEach(async () => {
  for (const s of sessions.splice(0)) s.close();
  vault.lock();
  await destroyVault();
});

async function open(backend: WalletBackend, id = walletId, now = () => 1234) {
  await backend.connect();
  const session = await openWallet(vault, id, backend, { now });
  sessions.push(session);
  await session.settled();
  return session;
}

/** The 50,000 sat coin `pay2` paid to receive address 1. */
const received = (s: WalletSnapshot) => s.coins.find((c) => c.txid === id(pay2))!;

const coinsOf = (s: WalletSnapshot) =>
  s.coins.map((c) => [`${c.chain}/${c.index}`, c.value, c.status]).sort();

describe.each(SERVERS)("a wallet with a known history, served by %s", (_, serve) => {
  it("has exactly the expected coins, statuses and balance", async () => {
    const snapshot = (await open(withMempool(serve))).getSnapshot();
    expect(snapshot.error).toBeNull();
    expect(coinsOf(snapshot)).toEqual([
      ["0/1", 50_000, "confirmed"],
      ["0/2", 20_000, "foreign-unconfirmed"],
      ["0/3", 5_000, "unconfirmed-parents"],
      ["1/1", 28_000, "own-change"],
    ]);
    expect(snapshot.balance).toEqual({
      confirmed: 50_000,
      unconfirmed: 53_000,
      frozen: 0,
      spendable: 78_000,
      foreign: 20_000,
    });
  });

  it("lists transactions newest first with amounts, fees and dates", async () => {
    const backend = withMempool(serve);
    const snapshot = (await open(backend)).getSnapshot();
    const txids = snapshot.transactions.map((t) => t.txid);
    expect(new Set(txids.slice(0, 3))).toEqual(new Set([foreignPay, ownChange, child].map(id)));
    expect(txids.slice(3)).toEqual([spend, pay2, pay1].map(id));

    const sent = snapshot.transactions[3]!;
    const [header] = await backend.blockHeaders([103]);
    expect(sent).toMatchObject({
      height: 103,
      confirmations: 1,
      net: -61_000,
      fee: 1_000,
      time: new DataView(header!.buffer).getUint32(68, true),
      label: null,
    });
    expect(sent.inputs[0]).toMatchObject({ value: 100_000, mine: { chain: 0, index: 0 } });
    expect(sent.outputs.map((o) => o.mine?.path ?? null)).toEqual([null, "m/84h/0h/0h/1/0"]);
    expect(snapshot.transactions.find((t) => t.txid === id(ownChange))).toMatchObject({
      height: null,
      confirmations: 0,
      seenAt: 1234,
      net: -11_000,
      fee: 1_000,
    });
  });

  it("knows which addresses are used and which receive address is next", async () => {
    const { addresses, nextReceive } = (await open(withMempool(serve))).getSnapshot();
    expect(addresses.receive.slice(0, 5).map((a) => a.used)).toEqual([true, true, true, true, false]);
    expect(addresses.change.slice(0, 3).map((a) => a.txCount)).toEqual([2, 1, 0]);
    expect(nextReceive).toMatchObject({ index: 4, path: "m/84h/0h/0h/0/4", used: false });
    expect(addresses.receive.length).toBeGreaterThanOrEqual(24);
  });

  it("flags a reused address", async () => {
    const backend = chain(serve);
    backend.addBlock([tx([[id(faucet), 9]], [[mine(0, 1), 7_000]])]);
    const { addresses } = (await open(backend)).getSnapshot();
    expect(addresses.receive.slice(0, 3).map((a) => a.reused)).toEqual([false, true, false]);
  });
});

describe.each(SERVERS)("scanning, served by %s", (_, serve) => {
  it("finds a coin beyond the gap limit only on a deeper scan", async () => {
    const backend = chain(serve);
    backend.addBlock([tx([[id(faucet), 9]], [[mine(0, 45), 7_000]])]);
    const session = await open(backend);
    expect(session.getSnapshot().balance.confirmed).toBe(89_000);

    expect(await session.scanDeeper(10)).toBe(1);
    expect(session.getSnapshot().balance.confirmed).toBe(96_000);
    expect(session.getSnapshot().nextReceive.index).toBe(46);
    expect(session.getSnapshot().addresses.receive).toHaveLength(66);

    expect(await session.scanDeeper(10)).toBe(0);
    expect(session.getSnapshot().addresses.receive).toHaveLength(66);
  });

  it("fetches only what changed on a second load", async () => {
    const backend = withMempool(serve);
    (await open(backend)).close();

    const quiet = counting(backend);
    await open(quiet.backend);
    expect(quiet.calls.history).toHaveLength(1);
    expect(quiet.calls.transactions).toBeUndefined();
    expect(quiet.calls.blockHeaders).toBeUndefined();
    sessions.pop()!.close();

    const pay3 = tx([[id(faucet), 4]], [[mine(0, 4), 30_000]]);
    backend.addBlock([pay3]);
    const busy = counting(backend);
    const session = await open(busy.backend);
    expect(busy.calls.history).toHaveLength(1);
    expect(busy.calls.transactions).toEqual([[[id(pay3)]]]);
    expect(busy.calls.blockHeaders).toEqual([[[104]]]);
    expect(session.getSnapshot().balance.confirmed).toBe(80_000);
  });

  it("measures a first sync of 500 transactions", async () => {
    const payments = Array.from({ length: 500 }, (_, i) =>
      tx([[FAUCET, i]], [[mine(0, i), 1_000 + i], [theirs(1), 990_000]]),
    );
    const blocks = [[faucet], ...Array.from({ length: 50 }, (_, b) => payments.slice(b * 10, b * 10 + 10))];
    const { backend, calls } = counting(serve(fakeBackend({ startHeight: 100, blocks })));
    const started = performance.now();
    const session = await open(backend);
    const ms = Math.round(performance.now() - started);

    const batches = Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v.length]));
    const sizes = (calls.history ?? []).map((args) => (args[0] as string[]).length);
    console.log("500-transaction first sync", { ms, batches, historyBatchSizes: sizes });
    expect(session.getSnapshot().transactions).toHaveLength(500);
    expect(calls.transactions).toHaveLength(2);
    expect(calls.blockHeaders).toHaveLength(1);
    expect(calls.history!.length).toBeLessThanOrEqual(8);
  }, 60_000);
});

describe("staying current", () => {
  it("shows a mempool payment and its confirmation without a refresh", async () => {
    const backend = chain();
    const session = await open(backend);
    const pay = tx([[id(faucet), 5]], [[mine(0, 5), 12_000]]);

    backend.addToMempool(pay);
    await session.settled();
    expect(session.getSnapshot().coins.find((c) => c.txid === id(pay))?.status).toBe(
      "foreign-unconfirmed",
    );

    backend.addBlock([pay]);
    await session.settled();
    const snapshot = session.getSnapshot();
    expect(snapshot.tip?.height).toBe(104);
    expect(snapshot.transactions[0]).toMatchObject({ txid: id(pay), confirmations: 1 });
  });

  it("over Esplora, shows a mempool payment on refresh and its confirmation at the next poll", async () => {
    const backend = chain((fake) => fakeEsplora(fake, 10));
    const session = await open(backend);
    const pay = tx([[id(faucet), 5]], [[mine(0, 5), 12_000]]);

    backend.addToMempool(pay);
    await session.refresh();
    expect(session.getSnapshot().coins.find((c) => c.txid === id(pay))?.status).toBe("foreign-unconfirmed");

    backend.addBlock([pay]);
    await vi.waitFor(() => expect(session.getSnapshot().transactions[0]).toMatchObject({ txid: id(pay), confirmations: 1 }));
    backend.close();
  });

  it("polls an address outside the subscribed window on the next block", async () => {
    const backend = chain();
    const session = await open(backend);
    const reuse = tx([[id(faucet), 6]], [[mine(0, 0), 3_000]]);

    backend.addToMempool(reuse);
    await session.settled();
    expect(session.getSnapshot().balance.unconfirmed).toBe(0);

    backend.addBlock([]);
    await session.settled();
    expect(session.getSnapshot().balance.unconfirmed).toBe(3_000);
  });

  it("shows a just-broadcast transaction straight away", async () => {
    const session = await open(chain());
    const outgoing = tx([[id(pay2), 0]], [[theirs(8), 30_000], [mine(1, 1), 19_000]]);

    const added = session.addTransaction(outgoing);
    expect(session.getSnapshot().transactions[0]).toMatchObject({
      txid: id(outgoing),
      height: null,
      net: -31_000,
      fee: 1_000,
    });
    expect(coinsOf(session.getSnapshot())).toEqual([
      ["1/0", 39_000, "confirmed"],
      ["1/1", 19_000, "own-change"],
    ]);
    await added;
  });
  it("drops the transaction a just-broadcast replacement conflicts with", async () => {
    const session = await open(chain());
    const original = tx([[id(pay2), 0]], [[theirs(8), 30_000], [mine(1, 1), 19_000]]);
    const replacement = tx([[id(pay2), 0]], [[theirs(8), 30_000], [mine(1, 1), 18_000]]);

    await session.addTransaction(original);
    await session.addTransaction(replacement);
    const txids = session.getSnapshot().transactions.map((t) => t.txid);
    expect(txids).toContain(id(replacement));
    expect(txids).not.toContain(id(original));
    expect(coinsOf(session.getSnapshot())).toEqual([
      ["1/0", 39_000, "confirmed"],
      ["1/1", 18_000, "own-change"],
    ]);
  });

  it("refuses a transaction the server sends under another txid", async () => {
    const backend = chain();
    const lying = { ...backend, transactions: async (txids: string[]) => txids.map(() => pay1) } as WalletBackend;
    const session = await open(lying);
    expect(session.getSnapshot()).toMatchObject({ error: expect.stringMatching(/different transaction/) });
    expect(session.getSnapshot().coins).toEqual([]);
  });
});

describe("reorgs", () => {
  const replacement = tx([[id(pay1), 0]], [[theirs(9), 99_000]]);
  const expectRecovered = (s: WalletSnapshot) => {
    expect(s.reorg).not.toBeNull();
    expect(coinsOf(s)).toEqual([["0/1", 50_000, "confirmed"]]);
    expect(s.transactions.map((t) => t.txid)).not.toContain(id(spend));
  };

  it("notices a reorg while open, re-syncs and says so", async () => {
    const backend = chain();
    const session = await open(backend);
    backend.reorg(103, [[replacement], []]);
    await session.settled();
    expectRecovered(session.getSnapshot());
    expect(session.getSnapshot().reorg).toEqual({ height: 104, at: 1234 });

    session.dismissReorg();
    expect(session.getSnapshot().reorg).toBeNull();
  });

  it("notices a reorg that happened while closed", async () => {
    const backend = chain();
    (await open(backend)).close();
    backend.reorg(103, [[replacement]]);
    expectRecovered((await open(backend)).getSnapshot());
  });
});

describe("frozen coins", () => {
  it("are excluded from the spendable balance and from selection, and stay frozen", async () => {
    const backend = chain();
    const session = await open(backend);
    const coin = received(session.getSnapshot());
    await session.setFrozen(coin, true);

    const { balance, coins } = session.getSnapshot();
    expect(balance).toMatchObject({ confirmed: 89_000, frozen: 50_000, spendable: 39_000 });
    const payment = {
      recipients: [{ script: hex.encode(theirs(1)), value: 45_000 }],
      feeRate: 1,
      scriptType: "wpkh" as const,
    };
    expect(selectCoins(coins, payment, "seed").problem?.kind).toBe("insufficient");

    session.close();
    expect(received((await open(backend)).getSnapshot()).frozen).toBe(true);
  });
});

// The test vector fragment from BIP329:
// https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki#test-vectors
const BIP329_EXAMPLE = `{ "type": "tx", "ref": "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd", "label": "Transaction", "origin": "wpkh([d34db33f/84'/0'/0'])" }
{ "type": "addr", "ref": "bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c", "label": "Address" }
{ "type": "pubkey", "ref": "0283409659355b6d1cc3c32decd5d561abaac86c37a353b52895a5e6c196d6f448", "label": "Public Key" }
{ "type": "input", "ref": "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:0", "label": "Input" }
{ "type": "output", "ref": "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:1", "label": "Output", "spendable": false }
{ "type": "xpub", "ref": "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8", "label": "Extended Public Key" }
{ "type": "spscan", "ref": "spscan1q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9q5zsq9q6qjevn2kmdrnpuxt0v6h2kr2a2epkr0g6nk55ftf0xcxtddazgkrth3e", "label": "Silent Payments Scan Key Expression" }
{ "type": "tx", "ref": "f546156d9044844e02b181026a1a407abfca62e7ea1159f87bbeaa77b4286c74", "label": "Account #1 Transaction", "origin": "wpkh([d34db33f/84'/0'/1'])" }
`;

describe("labels", () => {
  it("label transactions, addresses and outputs, and survive a reload", async () => {
    const backend = chain();
    const session = await open(backend);
    const coin = received(session.getSnapshot());
    await session.setLabel("tx", id(pay2), "Rent refund");
    await session.setLabel("addr", coin.address, "From landlord");
    await session.setLabel("output", `${coin.txid}:${coin.vout}`, "Keep separate");
    session.close();

    const s = (await open(backend)).getSnapshot();
    expect(s.transactions.find((t) => t.txid === id(pay2))?.label).toBe("Rent refund");
    expect(s.addresses.receive[1]?.label).toBe("From landlord");
    expect(received(s).label).toBe("Keep separate");
    expect(s.transactions.find((t) => t.txid === id(pay2))?.outputs[0]?.label).toBe("Keep separate");
  });

  it("imports the BIP329 example, skipping another account's record, and exports it back", async () => {
    const session = await open(chain());
    expect(await session.importLabels(BIP329_EXAMPLE)).toEqual({ imported: 7, skipped: 1 });

    const origin = "wpkh([d34db33f/84'/0'/0'])";
    const expected = parseBip329(BIP329_EXAMPLE).records.slice(0, 7).map((r) => ({ ...r, origin }));
    expect(parseBip329(session.exportLabels()).records).toEqual(expected);
  });

  it("round-trips labels, frozen and KYC flags into another wallet", async () => {
    const backend = chain();
    const session = await open(backend);
    await session.setLabel("tx", id(pay2), "Rent refund");
    await session.setFrozen(received(session.getSnapshot()), true);
    await session.setKyc([received(session.getSnapshot())], true);
    expect(received(session.getSnapshot()).kyc).toBe(true);
    const exported = session.exportLabels();

    const twin = await createWallet(vault, { name: "Twin", descriptor: DESCRIPTOR, network: "mainnet" });
    const other = await open(chain(), twin.id);
    expect(await other.importLabels(exported + "not json\n")).toEqual({ imported: 2, skipped: 1 });
    const s = other.getSnapshot();
    expect(s.transactions.find((t) => t.txid === id(pay2))?.label).toBe("Rent refund");
    expect(received(s).frozen).toBe(true);
    expect(received(s).kyc).toBe(true);
    expect(other.exportLabels()).toBe(exported);
  });
});

describe("wallet records", () => {
  it("creates, lists, renames and deletes wallets with everything they own", async () => {
    const second = await createWallet(
      vault,
      { name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" },
      () => 0,
    );
    await expect(
      createWallet(vault, { name: "Bad", descriptor: BIP86_XPUB, network: "mainnet" }),
    ).rejects.toThrow(/script type/);
    await renameWallet(vault, walletId, "Cold");
    expect((await listWallets(vault)).map((w) => w.name)).toEqual(["Cold", "Spending"]);

    const session = await open(chain());
    await session.setLabel("tx", id(pay1), "x");
    await session.setFrozen(session.getSnapshot().coins[0]!, true);
    await session.setKyc([session.getSnapshot().coins[0]!], true);
    session.close();
    expect(await vault.keys(`cache/${walletId}/`)).not.toEqual([]);

    await deleteWallet(vault, walletId);
    const left = await vault.keys();
    expect(left.filter((k) => k.includes(walletId))).toEqual([]);
    expect(left).toContain(`wallet/${second.id}`);
  });

  it("keeps the server setting", async () => {
    expect(await getSettings(vault)).toEqual({ server: null });
    await saveSettings(vault, { server: "wss://node.example:50004" });
    expect(await getSettings(vault)).toEqual({ server: "wss://node.example:50004" });
  });
});
