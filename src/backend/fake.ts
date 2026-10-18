import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { sha256x2 } from "@scure/btc-signer/utils.js";
import {
  BroadcastError,
  ConnectionError,
  scriptHash,
  type BlockHeader,
  type ConnectionFailure,
  type FeeBucket,
  type HistoryEntry,
  type Unsubscribe,
  type WalletBackend,
} from "./backend";
import { esploraBackend } from "./esplora";

/** A chain to serve: raw transactions grouped into blocks. */
export type Fixture = {
  /** The height of `blocks[0]`. */
  startHeight: number;
  blocks: Uint8Array[][];
  feeHistogram: FeeBucket[];
  /** Makes `connect` fail this way rather than succeed. */
  failure: ConnectionFailure | null;
  /** Makes `broadcast` reject with this reason rather than accept. */
  broadcastRejection: string | null;
  /** Unconfirmed at the start. */
  mempool: Uint8Array[];
};

export type FakeBackend = WalletBackend & {
  /** Mines a block on top of the tip. */
  addBlock(transactions: Uint8Array[]): void;
  /** Replaces every block from `height` upwards. */
  reorg(height: number, blocks: Uint8Array[][]): void;
  addToMempool(transaction: Uint8Array): void;
};

// A fixture may hold any transaction a real server would serve, including
// scripts this library does not recognise.
const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};

type Block = { transactions: Uint8Array[]; nonce: number };
type Known = {
  raw: Uint8Array;
  tx: Transaction;
  txid: string;
  height: number | null;
};

/**
 * Nothing here verifies the merkle root, so it is a stand-in rather than a
 * merkle tree. It only has to differ when the block's transactions do, and
 * the nonce covers the blocks that are otherwise identical. Blocks are ten
 * minutes apart, from an arbitrary real date.
 *
 * Field offsets and sizes:
 * https://developer.bitcoin.org/reference/block_chain.html
 */
function buildHeader(
  previous: Uint8Array,
  txids: string[],
  height: number,
  nonce: number,
): Uint8Array {
  const header = new Uint8Array(80);
  header.set(previous, 4);
  header.set(sha256x2(hex.decode(txids.join(""))), 36);
  const view = new DataView(header.buffer);
  view.setUint32(68, 1_700_000_000 + height * 600, true);
  view.setUint32(76, nonce, true);
  return header;
}

function digest(entries: HistoryEntry[] | undefined): string {
  return (entries ?? [])
    .map((entry) => `${entry.txid}:${entry.height}:${entry.unconfirmedParents}`)
    .join("|");
}

/** A `WalletBackend` serving a fixture, with the chain movable from a test. */
export function fakeBackend(fixture: Partial<Fixture> = {}): FakeBackend {
  const startHeight = fixture.startHeight ?? 0;
  const feeHistogram = fixture.feeHistogram ?? [];
  const failure = fixture.failure ?? null;
  const mempool = [...(fixture.mempool ?? [])];

  let nonce = 0;
  let blocks: Block[] = (fixture.blocks?.length ? fixture.blocks : [[]]).map(
    (transactions) => ({ transactions, nonce: nonce++ }),
  );

  let connected = false;
  let headers: Uint8Array[] = [];
  let known = new Map<string, Known>();
  let histories = new Map<string, HistoryEntry[]>();
  const headerListeners = new Set<(tip: BlockHeader) => void>();
  const scriptHashListeners = new Set<{
    scriptHashes: Set<string>;
    notify: (scriptHash: string) => void;
  }>();

  function register(raw: Uint8Array, height: number | null): string {
    const tx = Transaction.fromRaw(raw, PARSE);
    known.set(tx.id, { raw, tx, txid: tx.id, height });
    return tx.id;
  }

  function attribute({ tx, txid, height }: Known): void {
    const touched = new Set<string>();
    for (let i = 0; i < tx.outputsLength; i++) {
      touched.add(scriptHash(tx.getOutput(i).script!));
    }
    let unconfirmedParents = false;
    for (let i = 0; i < tx.inputsLength; i++) {
      const input = tx.getInput(i);
      const parent = known.get(hex.encode(input.txid!));
      if (!parent) continue;
      if (height === null && parent.height === null) unconfirmedParents = true;
      touched.add(scriptHash(parent.tx.getOutput(input.index!).script!));
    }
    for (const hash of touched) {
      const history = histories.get(hash) ?? [];
      history.push({ txid, height, unconfirmedParents });
      histories.set(hash, history);
    }
  }

  function reindex(): void {
    known = new Map();
    histories = new Map();
    headers = [];
    let previous = new Uint8Array(32);
    blocks.forEach((block, i) => {
      const txids = block.transactions.map((raw) =>
        register(raw, startHeight + i),
      );
      const header = buildHeader(previous, txids, startHeight + i, block.nonce);
      headers.push(header);
      previous = sha256x2(header);
    });
    for (const raw of mempool) {
      if (!known.has(Transaction.fromRaw(raw, PARSE).id)) register(raw, null);
    }
    // A mempool transaction can reach a server before the one it spends, so
    // nothing is attributed until every transaction is known.
    for (const entry of known.values()) attribute(entry);
  }

  function tip(): BlockHeader {
    return { height: startHeight + blocks.length - 1, header: headers.at(-1)! };
  }

  function update(): void {
    const before = histories;
    const beforeTip = headers.at(-1)!;
    reindex();
    if (!connected) return;
    if (hex.encode(tip().header) !== hex.encode(beforeTip)) {
      for (const listener of headerListeners) listener(tip());
    }
    const keys = new Set([...before.keys(), ...histories.keys()]);
    for (const { scriptHashes, notify } of scriptHashListeners) {
      for (const hash of keys) {
        if (!scriptHashes.has(hash)) continue;
        if (digest(before.get(hash)) !== digest(histories.get(hash))) {
          notify(hash);
        }
      }
    }
  }

  function requireConnection(): void {
    if (!connected) throw new Error("The backend is not connected");
  }

  reindex();

  const backend: FakeBackend = {
    async connect() {
      if (failure) throw new ConnectionError(failure);
      connected = true;
    },

    close() {
      connected = false;
      headerListeners.clear();
      scriptHashListeners.clear();
    },

    async chainTip() {
      requireConnection();
      return tip();
    },

    async subscribeHeaders(listener): Promise<Unsubscribe> {
      requireConnection();
      headerListeners.add(listener);
      return () => void headerListeners.delete(listener);
    },

    async blockHeaders(heights) {
      requireConnection();
      return heights.map((height) => {
        const header = headers[height - startHeight];
        if (!header) throw new Error(`No block at height ${height}`);
        return header;
      });
    },

    async history(scriptHashes) {
      requireConnection();
      return scriptHashes.map((hash) => histories.get(hash) ?? []);
    },

    async transactions(txids) {
      requireConnection();
      return txids.map((txid) => {
        const found = known.get(txid);
        if (!found) throw new Error(`No transaction ${txid}`);
        return found.raw;
      });
    },

    async subscribeScriptHashes(scriptHashes, listener): Promise<Unsubscribe> {
      requireConnection();
      const entry = { scriptHashes: new Set(scriptHashes), notify: listener };
      scriptHashListeners.add(entry);
      return () => void scriptHashListeners.delete(entry);
    },

    async feeHistogram() {
      requireConnection();
      return feeHistogram;
    },

    async broadcast(raw) {
      requireConnection();
      if (fixture.broadcastRejection) {
        throw new BroadcastError(fixture.broadcastRejection);
      }
      backend.addToMempool(raw);
      return Transaction.fromRaw(raw, PARSE).id;
    },

    addBlock(transactions) {
      blocks.push({ transactions, nonce: nonce++ });
      update();
    },

    reorg(height, replacements) {
      blocks = blocks.slice(0, Math.max(0, height - startHeight));
      for (const transactions of replacements) {
        blocks.push({ transactions, nonce: nonce++ });
      }
      update();
    },

    addToMempool(transaction) {
      mempool.push(transaction);
      update();
    },
  };

  return backend;
}

/**
 * The same fake chain behind the Esplora HTTP API, reached through a fake
 * `fetch`, so a test can run against either backend.
 * https://github.com/Blockstream/esplora/blob/master/API.md
 */
export function fakeEsplora(fake: FakeBackend, poll?: number): FakeBackend {
  const heights = new Map<string, number>();
  const blockHash = (header: Uint8Array) => hex.encode(sha256x2(header).reverse());
  const named = (header: Uint8Array, height: number) => {
    const hash = blockHash(header);
    heights.set(hash, height);
    return hash;
  };
  const reply = (body: unknown, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  async function history(esploraHash: string) {
    const [entries] = await fake.history([hex.encode(hex.decode(esploraHash).reverse())]);
    const json = await Promise.all(
      [...entries!].reverse().map(async ({ txid, height }) => {
        const tx = Transaction.fromRaw((await fake.transactions([txid]))[0]!, PARSE);
        const vin = Array.from({ length: tx.inputsLength }, (_, i) => ({ txid: hex.encode(tx.getInput(i).txid!) }));
        return { txid, status: height === null ? { confirmed: false } : { confirmed: true, block_height: height }, vin };
      }),
    );
    return { mempool: json.filter((tx) => !tx.status.confirmed), chain: json.filter((tx) => tx.status.confirmed) };
  }

  async function serve(path: string, init?: RequestInit): Promise<Response> {
    await fake.connect();
    let match: RegExpMatchArray | null;
    if (path === "/blocks/tip/hash") {
      const tip = await fake.chainTip();
      return reply(named(tip.header, tip.height));
    }
    if ((match = path.match(/^\/block-height\/(\d+)$/))) {
      const height = Number(match[1]);
      const header = await fake.blockHeaders([height]).catch(() => null);
      return header ? reply(named(header[0]!, height)) : reply("Block not found", 404);
    }
    if ((match = path.match(/^\/block\/(\w+)(\/header)?$/))) {
      const height = heights.get(match[1]!);
      const [header] = height === undefined ? [] : await fake.blockHeaders([height]).catch(() => []);
      if (!header || blockHash(header) !== match[1]) return reply("Block not found", 404);
      return reply(match[2] ? hex.encode(header) : { id: match[1], height });
    }
    if ((match = path.match(/^\/scripthash\/(\w+)$/))) {
      const { mempool, chain } = await history(match[1]!);
      return reply({ chain_stats: { tx_count: chain.length }, mempool_stats: { tx_count: mempool.length } });
    }
    if ((match = path.match(/^\/scripthash\/(\w+)\/txs$/))) {
      const { mempool, chain } = await history(match[1]!);
      return reply([...mempool.slice(0, 50), ...chain.slice(0, 25)]);
    }
    if ((match = path.match(/^\/scripthash\/(\w+)\/txs\/chain\/(\w+)$/))) {
      const { chain } = await history(match[1]!);
      const after = chain.findIndex((tx) => tx.txid === match![2]) + 1;
      return reply(chain.slice(after, after + 25));
    }
    if ((match = path.match(/^\/tx\/(\w+)\/hex$/))) {
      const found = await fake.transactions([match[1]!]).catch(() => null);
      return found ? reply(hex.encode(found[0]!)) : reply("Transaction not found", 404);
    }
    if ((match = path.match(/^\/tx\/(\w+)\/status$/))) {
      const found = await fake.transactions([match[1]!]).catch(() => null);
      if (!found) return reply("Transaction not found", 404);
      const [entries] = await fake.history([scriptHash(Transaction.fromRaw(found[0]!, PARSE).getOutput(0).script!)]);
      const height = entries!.find((entry) => entry.txid === match![1])!.height;
      return reply(height === null ? { confirmed: false } : { confirmed: true, block_height: height });
    }
    if (path === "/mempool") {
      return reply({ fee_histogram: (await fake.feeHistogram()).map(({ feeRate, vsize }) => [feeRate, vsize]) });
    }
    if (path === "/tx" && init?.method === "POST") {
      try {
        return reply(await fake.broadcast(hex.decode(String(init.body))));
      } catch (error) {
        if (error instanceof BroadcastError) return reply(error.message, 400);
        throw error;
      }
    }
    return reply("Not found", 404);
  }

  const base = "https://esplora.example/api";
  return {
    ...esploraBackend(base, { poll, fetch: (url, init) => serve(url.slice(base.length), init) }),
    addBlock: fake.addBlock,
    reorg: fake.reorg,
    addToMempool: fake.addToMempool,
  };
}
