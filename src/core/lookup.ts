import { hex } from "@scure/base";
import { Address, OutScript, RawTx } from "@scure/btc-signer";
import { NotFoundError, txidOf, type WalletBackend } from "../backend/backend";
import { NETWORKS, type Network } from "../wallet/network";
import { COINBASE, parseTx } from "./view";

export type LookedUpTx = {
  txid: string;
  /** Null while it is in the mempool. */
  height: number | null;
  /** Null for a coinbase, which spends no earlier output. */
  fee: number | null;
  vsize: number;
  /** Signals that it may be replaced, by BIP125's rule. */
  rbf: boolean;
  /** `value` is null for a coinbase's input, which spends nothing. */
  inputs: { txid: string; vout: number; value: number | null; address: string | null }[];
  outputs: { vout: number; value: number; address: string | null }[];
};

// An input signals replaceability with an nSequence below 0xfffffffe:
// https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki#summary
const FINAL = 0xfffffffe;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * A transaction anyone's, read from the server as it is now: one fetch, then
 * one batch for the transactions its inputs spend. Nothing is kept.
 * @returns null when the server has no such transaction.
 */
export async function lookupTransaction(backend: WalletBackend, txid: string, network: Network): Promise<LookedUpTx | null> {
  let raw: Uint8Array;
  try {
    [raw] = (await backend.transactions([txid])) as [Uint8Array];
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
  if (txidOf(raw) !== txid) throw new Error("The server sent a different transaction than the one asked for");
  const tx = parseTx(txid, raw);
  const parentIds = [...new Set(tx.inputs.map((i) => i.txid).filter((id) => id !== COINBASE))];
  const [parentRaws, [height]] = await Promise.all([backend.transactions(parentIds), backend.transactionHeights([raw])]);
  const parents = new Map(
    parentRaws.map((bytes, i) => {
      if (txidOf(bytes) !== parentIds[i]) throw new Error("The server sent a different transaction than the one asked for");
      return [parentIds[i]!, parseTx(parentIds[i]!, bytes)];
    }),
  );

  const addressOf = (script: string) => {
    try {
      return Address(NETWORKS[network]).encode(OutScript.decode(hex.decode(script)));
    } catch {
      return null;
    }
  };
  const inputs = tx.inputs.map((input) => {
    const prevout = parents.get(input.txid)?.outputs[input.vout];
    return { ...input, value: prevout?.value ?? null, address: prevout ? addressOf(prevout.script) : null };
  });
  const outputs = tx.outputs.map((o, vout) => ({ vout, value: o.value, address: addressOf(o.script) }));
  return {
    txid,
    height: height ?? null,
    fee: inputs.every((i) => i.value !== null) ? sum(inputs.map((i) => i.value!)) - sum(outputs.map((o) => o.value)) : null,
    vsize: tx.vsize,
    rbf: RawTx.decode(raw).inputs.some((i) => i.sequence < FINAL),
    inputs,
    outputs,
  };
}
