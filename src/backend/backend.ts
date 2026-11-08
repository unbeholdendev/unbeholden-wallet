import { hex } from "@scure/base";
import { RawTx } from "@scure/btc-signer";
import { sha256, sha256x2 } from "@scure/btc-signer/utils.js";

/** An 80-byte block header and the height it sits at. */
export type BlockHeader = { height: number; header: Uint8Array };

/** One transaction in a scripthash's history. */
export type HistoryEntry = {
  txid: string;
  /** Null while the transaction is still in the mempool. */
  height: number | null;
  /** Mempool only: at least one input is itself unconfirmed. */
  unconfirmedParents: boolean;
};

/** Sats on a scripthash. `unconfirmed` is what the mempool adds to `confirmed`, and may be negative. */
export type ScriptBalance = { confirmed: number; unconfirmed: number };

/** An output paying a scripthash that nothing has spent, counting the mempool. */
export type Unspent = { txid: string; vout: number; value: number; height: number | null };

/** One bar of the mempool's fee histogram: total vsize paying that rate. */
export type FeeBucket = { feeRate: number; vsize: number };

/**
 * The outcomes the connection screen has to tell apart. `mixed-content` is a
 * `ws://` or `http://` server asked for from an `https:` page, which the
 * browser refuses without trying. `cors` is an HTTP server that answered but
 * did not let this page read the answer.
 */
export type ConnectionFailure =
  | "certificate-rejected"
  | "refused"
  | "timeout"
  | "not-electrum"
  | "not-esplora"
  | "cors"
  | "mixed-content";

export class ConnectionError extends Error {
  readonly failure: ConnectionFailure;

  constructor(failure: ConnectionFailure) {
    super(failure);
    this.name = "ConnectionError";
    this.failure = failure;
  }
}

/** The node turned a transaction down; `message` is its reason, verbatim. */
export class BroadcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BroadcastError";
  }
}

/** The server has no transaction with that txid, in a block or its mempool. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The server would not answer, as for a history it holds too large; `message` is its reason, verbatim. */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedError";
  }
}

export type Unsubscribe = () => void;

/**
 * Everything the wallet asks of the outside world, and the only place it may.
 *
 * Batch-shaped on purpose: batching is the sync performance lever, so a method
 * that took one scripthash at a time would quietly prevent it.
 */
export interface WalletBackend {
  /** @throws {ConnectionError} the connection screen can act on. */
  connect(): Promise<void>;
  close(): void;

  chainTip(): Promise<BlockHeader>;
  subscribeHeaders(
    listener: (tip: BlockHeader) => void,
  ): Promise<Unsubscribe>;

  /** One 80-byte header per height, in the order asked for. */
  blockHeaders(heights: number[]): Promise<Uint8Array[]>;

  /**
   * One history per scripthash, in the order asked for.
   * @throws {RefusedError} when the server will not give one.
   */
  history(scriptHashes: string[]): Promise<HistoryEntry[][]>;
  /** One balance per scripthash, in the order asked for. @throws {RefusedError} */
  balances(scriptHashes: string[]): Promise<ScriptBalance[]>;
  /** One list of unspent outputs per scripthash, in the order asked for. @throws {RefusedError} */
  unspent(scriptHashes: string[]): Promise<Unspent[][]>;
  /**
   * One raw transaction per txid, in the order asked for.
   * @throws {NotFoundError} when the server has one of them nowhere.
   */
  transactions(txids: string[]): Promise<Uint8Array[]>;
  /** The height of the block holding each raw transaction, null for one in the mempool or unknown, in the order asked for. */
  transactionHeights(raws: Uint8Array[]): Promise<(number | null)[]>;
  /** Calls back with the scripthash whose history changed. */
  subscribeScriptHashes(
    scriptHashes: string[],
    listener: (scriptHash: string) => void,
  ): Promise<Unsubscribe>;

  feeHistogram(): Promise<FeeBucket[]>;
  /**
   * @returns the txid of the broadcast transaction.
   * @throws {BroadcastError} carrying the node's reason when it rejects it.
   */
  broadcast(raw: Uint8Array): Promise<string>;
}

/**
 * Electrum addresses an output script by the sha256 of its bytes, written
 * least-significant byte first.
 * https://electrum-protocol.readthedocs.io/en/latest/protocol-basics.html
 */
export function scriptHash(script: Uint8Array): string {
  return hex.encode(sha256(script).reverse());
}

/**
 * The double sha256 of the transaction without its witnesses, written
 * least-significant byte first.
 * https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki#transaction-id
 */
export function txidOf(raw: Uint8Array): string {
  const tx = RawTx.decode(raw);
  return hex.encode(sha256x2(RawTx.encode({ ...tx, segwitFlag: false, witnesses: undefined })).reverse());
}
