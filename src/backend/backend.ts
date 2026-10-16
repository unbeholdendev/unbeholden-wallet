import { hex } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils.js";

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

/** One bar of the mempool's fee histogram: total vsize paying that rate. */
export type FeeBucket = { feeRate: number; vsize: number };

/** The four outcomes the connection screen has to tell apart. */
export type ConnectionFailure =
  | "certificate-rejected"
  | "refused"
  | "timeout"
  | "not-electrum";

export class ConnectionError extends Error {
  readonly failure: ConnectionFailure;

  constructor(failure: ConnectionFailure) {
    super(failure);
    this.name = "ConnectionError";
    this.failure = failure;
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

  /** One history per scripthash, in the order asked for. */
  history(scriptHashes: string[]): Promise<HistoryEntry[][]>;
  /** One raw transaction per txid, in the order asked for. */
  transactions(txids: string[]): Promise<Uint8Array[]>;
  /** Calls back with the scripthash whose history changed. */
  subscribeScriptHashes(
    scriptHashes: string[],
    listener: (scriptHash: string) => void,
  ): Promise<Unsubscribe>;

  feeHistogram(): Promise<FeeBucket[]>;
  /** @returns the txid of the broadcast transaction. */
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
