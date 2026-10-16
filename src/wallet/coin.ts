/**
 * How far an unspent output can be trusted to stay spendable.
 *
 * - `confirmed`: in a block.
 * - `own-change`: unconfirmed, created by a wallet transaction whose inputs
 *   are all the wallet's own, so nobody else can replace it.
 * - `foreign-unconfirmed`: unconfirmed payment from someone else, who can
 *   still replace it.
 * - `unconfirmed-parents`: its transaction spends an output that is itself
 *   unconfirmed and not the wallet's own change.
 */
export type CoinStatus =
  | "confirmed"
  | "own-change"
  | "foreign-unconfirmed"
  | "unconfirmed-parents";

/** An unspent output the wallet's descriptor can spend. Amounts in sats. */
export type Coin = {
  txid: string;
  vout: number;
  value: number;
  /** Output script, hex. */
  script: string;
  address: string;
  /** Derivation under the descriptor: 0 receive, 1 change. */
  chain: number;
  index: number;
  /** Null while unconfirmed. */
  height: number | null;
  status: CoinStatus;
  frozen: boolean;
};

export const outpoint = (coin: { txid: string; vout: number }) =>
  `${coin.txid}:${coin.vout}`;
