import { hex } from "@scure/base";
import { Address, OutScript, RawTx } from "@scure/btc-signer";
import { sha256x2 } from "@scure/btc-signer/utils.js";
import {
  NotFoundError,
  type ScriptBalance,
  scriptHash,
  txidOf,
  type Unspent,
  type WalletBackend,
} from "../backend/backend";
import { NETWORKS, type Network } from "../wallet/network";
import { blockTime, COINBASE, type Parsed, parseTx } from "./view";

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

/** How many of an address's transactions get their amounts at a time. */
export const AMOUNTS_PAGE = 25;

export type LookedUpAddress = {
  address: string;
  /** Hex. */
  script: string;
  balance: ScriptBalance;
  /** Newest first, the mempool's at the top. `time` is the block's, in unix seconds. */
  history: { txid: string; height: number | null; time: number | null }[];
  unspent: Unspent[];
};

async function fetchParsed(backend: WalletBackend, txids: string[]): Promise<Parsed[]> {
  const raws = await backend.transactions(txids);
  return raws.map((raw, i) => {
    if (txidOf(raw) !== txids[i]) throw new Error("The server sent a different transaction than the one asked for");
    return parseTx(txids[i]!, raw);
  });
}

/** A raw transaction, before it is broadcast: what it spends, pays and leaves as fee. */
export type DecodedTx = Omit<LookedUpTx, "height">;

/**
 * A raw transaction anyone's, with one batch for the transactions its inputs
 * spend. An input whose transaction the server lacks has no value or address.
 */
export async function decodeTransaction(backend: WalletBackend, raw: Uint8Array, network: Network): Promise<DecodedTx> {
  const txid = txidOf(raw);
  const tx = parseTx(txid, raw);
  const parentIds = [...new Set(tx.inputs.map((i) => i.txid).filter((id) => id !== COINBASE))];
  const missing = (error: unknown) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  };
  // One missing transaction fails the whole batch, so only then is each asked for alone.
  const parentRaws: (Uint8Array | null)[] = await backend
    .transactions(parentIds)
    .catch(
      (error) => (
        missing(error),
        Promise.all(parentIds.map((id) => backend.transactions([id]).then(([bytes]) => bytes!, missing)))
      ),
    );
  const parents = new Map(
    parentRaws.flatMap((bytes, i) => {
      if (!bytes) return [];
      if (txidOf(bytes) !== parentIds[i])
        throw new Error("The server sent a different transaction than the one asked for");
      return [[parentIds[i]!, parseTx(parentIds[i]!, bytes)] as const];
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
    fee: inputs.every((i) => i.value !== null)
      ? sum(inputs.map((i) => i.value!)) - sum(outputs.map((o) => o.value))
      : null,
    vsize: tx.vsize,
    rbf: RawTx.decode(raw).inputs.some((i) => i.sequence < FINAL),
    inputs,
    outputs,
  };
}

/**
 * Any address's balance, history and unspent outputs, read from the server as
 * it is now, with one block header per height for the times. Nothing is kept
 * and nothing subscribed to.
 * @throws {RefusedError} with the server's reason when it will not serve the address.
 */
export async function lookupAddress(
  backend: WalletBackend,
  address: string,
  network: Network,
): Promise<LookedUpAddress> {
  const script = OutScript.encode(Address(NETWORKS[network]).decode(address));
  const hash = scriptHash(script);
  const [[balance], [history], [unspent]] = await Promise.all([
    backend.balances([hash]),
    backend.history([hash]),
    backend.unspent([hash]),
  ]);
  const heights = [...new Set(history!.flatMap((entry) => (entry.height === null ? [] : [entry.height])))];
  const headers = await backend.blockHeaders(heights);
  const times = new Map(heights.map((height, i) => [height, blockTime(headers[i]!)]));
  const order = (height: number | null) => height ?? Number.MAX_SAFE_INTEGER;
  const newest = [...history!].reverse().sort((a, b) => order(b.height) - order(a.height));
  return {
    address,
    script: hex.encode(script),
    balance: balance!,
    history: newest.map(({ txid, height }) => ({ txid, height, time: height === null ? null : times.get(height)! })),
    unspent: unspent!,
  };
}

/**
 * What each of these transactions moved into the address, negative when it
 * spent from it. Only a transaction in the address's history can have paid an
 * input it spends, so those are the only parents fetched.
 */
export async function addressAmounts(
  backend: WalletBackend,
  found: LookedUpAddress,
  txids: string[],
): Promise<Map<string, number>> {
  const txs = await fetchParsed(backend, txids);
  const inHistory = new Set(found.history.map((entry) => entry.txid));
  const fetched = new Set(txids);
  const parentIds = [...new Set(txs.flatMap((tx) => tx.inputs.map((input) => input.txid)))].filter(
    (id) => inHistory.has(id) && !fetched.has(id),
  );
  const parents = new Map([...txs, ...(await fetchParsed(backend, parentIds))].map((tx) => [tx.txid, tx]));
  const paid = (outputs: { script: string; value: number }[]) =>
    sum(outputs.filter((o) => o.script === found.script).map((o) => o.value));
  return new Map(
    txs.map((tx) => {
      const spent = tx.inputs.flatMap((input) => {
        const prevout = parents.get(input.txid)?.outputs[input.vout];
        return prevout ? [prevout] : [];
      });
      return [tx.txid, paid(tx.outputs) - paid(spent)];
    }),
  );
}

/**
 * A transaction anyone's, read from the server as it is now: one fetch, then
 * one batch for the transactions its inputs spend. Nothing is kept.
 * @returns null when the server has no such transaction.
 */
export async function lookupTransaction(
  backend: WalletBackend,
  txid: string,
  network: Network,
): Promise<LookedUpTx | null> {
  let raw: Uint8Array;
  try {
    [raw] = (await backend.transactions([txid])) as [Uint8Array];
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
  if (txidOf(raw) !== txid) throw new Error("The server sent a different transaction than the one asked for");
  const [tx, [height]] = await Promise.all([
    decodeTransaction(backend, raw, network),
    backend.transactionHeights([raw]),
  ]);
  return { ...tx, height: height ?? null };
}

export type LookedUpBlock = {
  height: number;
  hash: string;
  /** Unix seconds, as the miner stamped it. */
  time: number;
  difficulty: number;
};

/**
 * Difficulty from a header's compact target, relative to the highest target
 * 0x1d00ffff, as Bitcoin Core reports it:
 * https://en.bitcoin.it/wiki/Difficulty#How_is_difficulty_calculated.3F_What_is_the_difference_between_bdiff_and_pdiff.3F
 */
export const difficulty = (bits: number) => (0xffff / (bits & 0xffffff)) * 256 ** (0x1d - (bits >>> 24));

/** The block at a height on the server's chain, from its header alone. */
export async function lookupBlock(backend: WalletBackend, height: number): Promise<LookedUpBlock> {
  const [header] = (await backend.blockHeaders([height])) as [Uint8Array];
  // Bits field of the block header: https://developer.bitcoin.org/reference/block_chain.html
  const bits = new DataView(header.buffer, header.byteOffset).getUint32(72, true);
  return {
    height,
    hash: hex.encode(sha256x2(header).reverse()),
    time: blockTime(header),
    difficulty: difficulty(bits),
  };
}
