import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { p2wpkh } from "@scure/btc-signer/payment.js";
import { sha256 } from "@scure/btc-signer/utils.js";
import { describe, expect, it } from "vitest";
import { descriptorFromExtendedKey } from "../wallet/descriptor";
import { derivePublicKey } from "../wallet/derive";
import { BIP84_ZPUB } from "../wallet/vectors";
import { BroadcastError, ConnectionError, scriptHash } from "./backend";
import { fakeBackend, fakeEsplora, type FakeBackend } from "./fake";

const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};

function transaction(
  inputs: { txid: string; index: number }[],
  outputs: { script: Uint8Array; amount: bigint }[],
): Uint8Array {
  const tx = new Transaction(PARSE);
  for (const input of inputs) tx.addInput(input);
  for (const output of outputs) tx.addOutput(output);
  return tx.unsignedTx;
}

function txid(raw: Uint8Array): string {
  return Transaction.fromRaw(raw, PARSE).id;
}

/** Its own copy of the header rules, so the fake cannot agree with itself. */
function blockHash(header: Uint8Array): string {
  return hex.encode(sha256(sha256(header)));
}

function previousHash(header: Uint8Array): string {
  return hex.encode(header.slice(4, 36));
}

// https://developer.bitcoin.org/reference/block_chain.html
function blockTime(header: Uint8Array): number {
  return new DataView(header.buffer, header.byteOffset).getUint32(68, true);
}

const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");

function walletScript(chain: number, index: number): Uint8Array {
  return p2wpkh(derivePublicKey(descriptor, "mainnet", chain, index)).script;
}

const RECEIVE = walletScript(0, 0);
const CHANGE = walletScript(1, 0);
const OTHER = walletScript(0, 5);

const funding = transaction(
  [{ txid: "11".repeat(32), index: 0 }],
  [
    { script: RECEIVE, amount: 100_000n },
    { script: OTHER, amount: 50_000n },
  ],
);
const spend = transaction(
  [{ txid: txid(funding), index: 0 }],
  [
    { script: OTHER, amount: 60_000n },
    { script: CHANGE, amount: 39_000n },
  ],
);

/** Received at height 100, partly spent to change at 101. */
async function wallet(serve = (backend: FakeBackend) => backend) {
  const backend = serve(fakeBackend({ startHeight: 100, blocks: [[funding], [spend]] }));
  await backend.connect();
  return backend;
}

const SERVERS: [string, (backend: FakeBackend) => FakeBackend][] = [
  ["the fake", (backend) => backend],
  ["Esplora", (backend) => fakeEsplora(backend)],
];

// The worked example in the Electrum protocol basics:
// https://electrum-protocol.readthedocs.io/en/latest/protocol-basics.html
describe("scriptHash", () => {
  it("hashes a script the way Electrum addresses it", () => {
    const script = hex.decode(
      "76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac",
    );
    expect(scriptHash(script)).toBe(
      "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161",
    );
  });
});

describe("connecting", () => {
  it.each([
    "certificate-rejected",
    "refused",
    "timeout",
    "not-electrum",
    "mixed-content",
  ] as const)("reports a %s failure the user can act on", async (failure) => {
    const error = await fakeBackend({ failure }).connect().then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).failure).toBe(failure);
  });

  it("serves nothing until it is connected", async () => {
    await expect(fakeBackend().chainTip()).rejects.toThrow(/not connected/i);
  });
});

describe.each(SERVERS)("a wallet with history, served by %s", (_, serve) => {
  it("gives every scripthash asked for its own history, in order", async () => {
    const backend = await wallet(serve);
    const [receive = [], change = [], unused = []] = await backend.history([
      scriptHash(RECEIVE),
      scriptHash(CHANGE),
      scriptHash(walletScript(0, 1)),
    ]);
    expect(receive).toEqual([
      { txid: txid(funding), height: 100, unconfirmedParents: false },
      { txid: txid(spend), height: 101, unconfirmedParents: false },
    ]);
    expect(change).toEqual([
      { txid: txid(spend), height: 101, unconfirmedParents: false },
    ]);
    expect(unused).toEqual([]);
  });

  it("gives every transaction asked for, in order", async () => {
    const backend = await wallet(serve);
    expect(await backend.transactions([txid(spend), txid(funding)])).toEqual([
      spend,
      funding,
    ]);
  });

  it("serves the tip of the fixture's chain", async () => {
    const backend = await wallet(serve);
    expect((await backend.chainTip()).height).toBe(101);
  });

  it("serves headers with block times ten minutes apart", async () => {
    const backend = await wallet(serve);
    const [first, second, tip] = await backend.blockHeaders([100, 101, 101]);
    expect(hex.encode(tip!)).toBe(hex.encode((await backend.chainTip()).header));
    expect(previousHash(second!)).toBe(blockHash(first!));
    expect(blockTime(second!) - blockTime(first!)).toBe(600);
    expect(new Date(blockTime(first!) * 1000).getUTCFullYear()).toBeGreaterThan(2009);
  });

  it("serves no header above the tip", async () => {
    const backend = await wallet(serve);
    await expect(backend.blockHeaders([102])).rejects.toThrow(/102/);
  });

  it("serves the fixture's fee histogram", async () => {
    const backend = serve(fakeBackend({ feeHistogram: [{ feeRate: 12, vsize: 8812 }] }));
    await backend.connect();
    expect(await backend.feeHistogram()).toEqual([
      { feeRate: 12, vsize: 8812 },
    ]);
  });
});

describe.each(SERVERS)("the mempool, served by %s", (_, serve) => {
  const child = transaction(
    [{ txid: txid(spend), index: 1 }],
    [{ script: OTHER, amount: 30_000n }],
  );
  const grandchild = transaction(
    [{ txid: txid(child), index: 0 }],
    [{ script: RECEIVE, amount: 20_000n }],
  );

  const arrivals: [string, Uint8Array[]][] = [
    ["parent first", [child, grandchild]],
    ["child first", [grandchild, child]],
  ];

  it.each(arrivals)("marks an unconfirmed parent, %s", async (_, order) => {
    const backend = await wallet(serve);
    for (const raw of order) backend.addToMempool(raw);

    const [change = [], receive = [], other = []] = await backend.history([
      scriptHash(CHANGE),
      scriptHash(RECEIVE),
      scriptHash(OTHER),
    ]);
    expect(change.at(-1)).toEqual({
      txid: txid(child),
      height: null,
      unconfirmedParents: false,
    });
    expect(receive.at(-1)).toEqual({
      txid: txid(grandchild),
      height: null,
      unconfirmedParents: true,
    });
    expect(other.map((entry) => entry.txid)).toContain(txid(grandchild));
  });

  it("takes a broadcast transaction and hands back its txid", async () => {
    const backend = await wallet(serve);
    const raw = transaction(
      [{ txid: txid(spend), index: 1 }],
      [{ script: OTHER, amount: 30_000n }],
    );
    expect(await backend.broadcast(raw)).toBe(txid(raw));
    const [change = []] = await backend.history([scriptHash(CHANGE)]);
    expect(change.at(-1)).toEqual({
      txid: txid(raw),
      height: null,
      unconfirmedParents: false,
    });
  });

  it("hands back the node's reason when it rejects a broadcast", async () => {
    const reason = "insufficient fee, rejecting replacement";
    const backend = serve(fakeBackend({ broadcastRejection: reason }));
    await backend.connect();
    const raw = transaction(
      [{ txid: "44".repeat(32), index: 0 }],
      [{ script: OTHER, amount: 1_000n }],
    );
    const error = await backend.broadcast(raw).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(BroadcastError);
    expect((error as BroadcastError).message).toBe(reason);
    const [other = []] = await backend.history([scriptHash(OTHER)]);
    expect(other.map((entry) => entry.txid)).not.toContain(txid(raw));
  });
});

describe.each(SERVERS)("moving the chain, served by %s", (_, serve) => {
  it("mines a block that extends the tip", async () => {
    const backend = await wallet(serve);
    const before = await backend.chainTip();
    backend.addBlock([]);

    const after = await backend.chainTip();
    expect(after.height).toBe(102);
    expect(previousHash(after.header)).toBe(blockHash(before.header));
  });

  it("reorgs to a chain that does not extend the old tip", async () => {
    const backend = await wallet(serve);
    const before = await backend.chainTip();
    const replacement = transaction(
      [{ txid: txid(funding), index: 0 }],
      [{ script: OTHER, amount: 99_000n }],
    );
    backend.reorg(101, [[replacement], []]);

    const after = await backend.chainTip();
    expect(after.height).toBe(102);
    expect(previousHash(after.header)).not.toBe(blockHash(before.header));

    const [receive = [], change = []] = await backend.history([
      scriptHash(RECEIVE),
      scriptHash(CHANGE),
    ]);
    expect(receive.map((entry) => entry.txid)).toEqual([
      txid(funding),
      txid(replacement),
    ]);
    expect(change).toEqual([]);
  });

  it("replaces a block at the same height, and keeps the ones below", async () => {
    const backend = await wallet(serve);
    const before = await backend.chainTip();
    backend.reorg(101, [[]]);

    const after = await backend.chainTip();
    expect(after.height).toBe(before.height);
    expect(hex.encode(after.header)).not.toBe(hex.encode(before.header));
    const [receive = []] = await backend.history([scriptHash(RECEIVE)]);
    expect(receive).toEqual([
      { txid: txid(funding), height: 100, unconfirmedParents: false },
    ]);
  });
  it("makes a reorg visible even when the replacement block matches", async () => {
    const backend = await wallet(serve);
    backend.reorg(101, [[]]);
    const before = await backend.chainTip();
    backend.reorg(101, [[]]);

    expect(hex.encode((await backend.chainTip()).header)).not.toBe(
      hex.encode(before.header),
    );
  });
});

describe("subscriptions", () => {
  it("reports a new tip to header subscribers, and mempool churn to none", async () => {
    const backend = await wallet();
    const tips: number[] = [];
    await backend.subscribeHeaders((tip) => tips.push(tip.height));

    backend.addBlock([]);
    backend.addToMempool(
      transaction(
        [{ txid: txid(spend), index: 1 }],
        [{ script: OTHER, amount: 30_000n }],
      ),
    );
    expect(tips).toEqual([102]);
  });

  it("reports only the scripthashes whose history changed", async () => {
    const backend = await wallet();
    const seen: string[] = [];
    const unsubscribe = await backend.subscribeScriptHashes(
      [scriptHash(RECEIVE), scriptHash(CHANGE)],
      (hash) => seen.push(hash),
    );

    const payment = transaction(
      [{ txid: "22".repeat(32), index: 0 }],
      [{ script: CHANGE, amount: 10_000n }],
    );
    backend.addBlock([payment]);
    expect(seen).toEqual([scriptHash(CHANGE)]);

    unsubscribe();
    backend.addBlock([
      transaction(
        [{ txid: "33".repeat(32), index: 0 }],
        [{ script: RECEIVE, amount: 10_000n }],
      ),
    ]);
    expect(seen).toEqual([scriptHash(CHANGE)]);
  });
});
