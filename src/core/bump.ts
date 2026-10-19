import { hex } from "@scure/base";
import { Address, OutScript } from "@scure/btc-signer";
import type { WalletCoin, WalletTx } from "./wallet";
import type { Coin } from "../wallet/coin";
import { NETWORKS, type Network } from "../wallet/network";
import type { ChangeOutput, Recipient } from "../wallet/psbt";
import { CHANGE_SCRIPT_BYTES, dust, spend, type Spend, type WalletKind } from "../wallet/select";

export type BumpProblem =
  | { kind: "confirmed" }
  /** Only a transaction the wallet signed every input of can be redone. */
  | { kind: "not-ours" }
  /** A later wallet transaction spends its outputs and would be dropped. */
  | { kind: "has-children" }
  /** A payment without an address, such as OP_RETURN, which the PSBT builder cannot recreate. */
  | { kind: "unsupported-output" }
  /** An input's previous transaction is not cached. */
  | { kind: "fee-unknown" }
  /** No unspent, unfrozen output of it is this wallet's. */
  | { kind: "nothing-to-spend" }
  | { kind: "below-minimum"; minFeeRate: number }
  | { kind: "insufficient"; missing: number };

export type BumpPlan = {
  oldFee: number;
  oldFeeRate: number;
  /** The lowest rate a node will accept as a replacement. */
  minFeeRate: number;
  spend: Spend;
  coins: Coin[];
  recipients: Recipient[];
  change: ChangeOutput | null;
  problem: BumpProblem | null;
};

/**
 * Plans a BIP125 replacement of an unconfirmed wallet transaction at a higher
 * fee rate. It keeps every input and every payment, takes the extra fee from
 * change, and adds confirmed coins only when change cannot cover it. To
 * cancel, it drops the payments and sends everything back to the wallet.
 * https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki
 */
export function planBump(
  tx: WalletTx,
  coins: WalletCoin[],
  feeRate: number,
  wallet: WalletKind & { network: Network; nextChange: { chain: number; index: number } },
  cancel = false,
): BumpPlan {
  const oldFee = tx.fee ?? 0;
  const oldFeeRate = oldFee / tx.vsize;
  const address = Address(NETWORKS[wallet.network]);
  const changeOut = tx.outputs.find((o) => o.mine?.chain === 1) ?? null;
  const payments = cancel ? [] : tx.outputs.filter((o) => o !== changeOut);
  const changeAt = changeOut?.mine ?? wallet.nextChange;
  const inputs: Coin[] = tx.inputs.flatMap((i) =>
    i.mine && i.value !== null && i.address
      ? [
          {
            txid: i.txid,
            vout: i.vout,
            value: i.value,
            script: hex.encode(OutScript.encode(address.decode(i.address))),
            address: i.address,
            chain: i.mine.chain,
            index: i.mine.index,
            height: null,
            status: "own-change",
            frozen: false,
          },
        ]
      : [],
  );
  const payment = {
    recipients: payments.map((o) => ({ script: o.script, value: o.value! })),
    feeRate,
    scriptType: wallet.scriptType,
    multisig: wallet.multisig,
  };
  // Confirmed only: BIP125 rule 2 forbids new unconfirmed inputs.
  const extra = coins
    .filter((c) => c.status === "confirmed" && !c.frozen && c.txid !== tx.txid)
    .sort((a, b) => b.value - a.value);

  let chosen = inputs;
  let result = spend(chosen, payment);
  for (const coin of extra) {
    if (result.problem?.kind !== "insufficient") break;
    chosen = [...chosen, coin];
    result = spend(chosen, payment);
  }

  // BIP125 rule 4: pay for the replacement's own size at the incremental relay
  // rate of 1 sat/vB on top of the fee it displaces.
  const minFeeRate = Math.max(
    Math.ceil(((oldFee + result.vsize) / result.vsize) * 10) / 10,
    Math.floor(oldFeeRate * 10) / 10 + 0.1,
  );
  const spent = tx.outputs.some(
    (o) => o.mine && !coins.some((c) => c.txid === tx.txid && c.vout === o.vout),
  );
  const problem: BumpProblem | null =
    tx.height !== null
      ? { kind: "confirmed" }
      : inputs.length !== tx.inputs.length || tx.fee === null
        ? { kind: "not-ours" }
        : spent
          ? { kind: "has-children" }
          : payments.some((o) => !o.address)
            ? { kind: "unsupported-output" }
          : feeRate < minFeeRate || result.fee < oldFee + result.vsize
            ? { kind: "below-minimum", minFeeRate }
            : result.problem?.kind === "insufficient"
              ? { kind: "insufficient", missing: result.problem.missing }
              : null;

  return {
    oldFee,
    oldFeeRate,
    minFeeRate,
    spend: result,
    coins: chosen,
    recipients: payments.flatMap((o) => (o.address ? [{ address: o.address, value: o.value! }] : [])),
    change: result.change
      ? { chain: changeAt.chain, index: changeAt.index, value: result.change }
      : null,
    problem,
  };
}

/**
 * Plans a child that spends the wallet's unspent outputs of an unconfirmed
 * transaction back to the wallet, paying enough that parent and child together
 * come to `feeRate`, and the child alone at least 1 sat/vB.
 */
export function planCpfp(
  tx: WalletTx,
  coins: WalletCoin[],
  feeRate: number,
  wallet: WalletKind & { nextChange: { chain: number; index: number } },
): BumpPlan {
  const oldFee = tx.fee ?? 0;
  const oldFeeRate = oldFee / tx.vsize;
  const minFeeRate = Math.floor(oldFeeRate * 10) / 10 + 0.1;
  const mine = coins.filter((c) => c.txid === tx.txid && !c.frozen);
  const sized = spend(mine, { recipients: [], feeRate: 0, scriptType: wallet.scriptType, multisig: wallet.multisig });
  const fee = Math.max(Math.ceil(feeRate * (tx.vsize + sized.vsize)) - oldFee, sized.vsize);
  const available = mine.reduce((a, c) => a + c.value, 0);
  const missing = fee + dust(CHANGE_SCRIPT_BYTES[wallet.scriptType], true) - available;
  const problem: BumpProblem | null =
    tx.height !== null
      ? { kind: "confirmed" }
      : tx.fee === null
        ? { kind: "fee-unknown" }
        : mine.length === 0
          ? { kind: "nothing-to-spend" }
          : feeRate < minFeeRate
            ? { kind: "below-minimum", minFeeRate }
            : missing > 0
              ? { kind: "insufficient", missing }
              : null;
  return {
    oldFee,
    oldFeeRate,
    minFeeRate,
    spend: { ...sized, fee, change: available - fee, total: fee },
    coins: mine,
    recipients: [],
    change: { ...wallet.nextChange, value: available - fee },
    problem,
  };
}
