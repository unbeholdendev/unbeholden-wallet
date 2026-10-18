import { hex, utf8 } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils.js";
import { outpoint, type Coin } from "./coin";
import type { ScriptType } from "./descriptor";

/** An output to pay. `"max"` takes whatever is left after fees and the other recipients. */
export type Recipient = {
  /** Output script, hex. */
  script: string;
  value: number | "max";
};

export type Payment = {
  recipients: Recipient[];
  /** sat/vB */
  feeRate: number;
  /** The wallet's, so also the type of any change output. */
  scriptType: ScriptType;
};

export type SpendProblem =
  | { kind: "no-coins" }
  | { kind: "insufficient"; missing: number }
  /** The recipient at this index would get less than the network relays. */
  | { kind: "dust"; recipient: number };

/** What spending a set of coins on a payment comes to. Amounts in sats. */
export type Spend = {
  coins: Coin[];
  /** One per recipient, with any `"max"` worked out. */
  amounts: number[];
  /** 0 when there is no change output. */
  change: number;
  fee: number;
  vsize: number;
  /** What leaves the wallet: amounts plus fee. */
  total: number;
  problem: SpendProblem | null;
};

// Version, locktime and one-byte input and output counts at 4 WU a byte, plus
// 2 WU of segwit marker and flag. Inputs: 68 vB for wpkh with a 72-byte
// signature, 57.5 vB for a tr key-path spend.
// https://bitcoinops.org/en/tools/calc-size/
const OVERHEAD_WEIGHT = 42;
const INPUT_WEIGHT: Record<ScriptType, number> = { wpkh: 272, tr: 230 };
const CHANGE_SCRIPT_BYTES: Record<ScriptType, number> = { wpkh: 22, tr: 34 };

// Core's search budget for branch and bound, and the change SRD aims for.
// https://github.com/bitcoin/bitcoin/blob/master/src/wallet/coinselection.cpp
// https://github.com/bitcoin/bitcoin/blob/master/src/wallet/coinselection.h
const TOTAL_TRIES = 100_000;
const CHANGE_LOWER = 50_000;

// Dust: an output worth less than spending it costs at 3 sat/vB, counting a
// 67 vB input to spend a witness output and 148 vB for anything else.
// https://github.com/bitcoin/bitcoin/blob/master/src/policy/policy.cpp
// https://github.com/bitcoin/bitcoin/blob/master/src/policy/policy.h
const dust = (scriptBytes: number, witness: boolean) =>
  (8 + 1 + scriptBytes + (witness ? 67 : 148)) * 3;

const isWitness = (script: string) =>
  /^(00|5[1-9a-f]|60)/.test(script) &&
  parseInt(script.slice(2, 4), 16) === script.length / 2 - 2;

const outputWeight = (scriptBytes: number) => (8 + 1 + scriptBytes) * 4;

function inputWeight(coin: Coin): number {
  if (coin.script.length === 44 && coin.script.startsWith("0014")) {
    return INPUT_WEIGHT.wpkh;
  }
  if (coin.script.length === 68 && coin.script.startsWith("5120")) {
    return INPUT_WEIGHT.tr;
  }
  throw new Error(`Cannot spend output script ${coin.script}`);
}

/** Sats to spend this coin as one input at `feeRate`, before the rest of the transaction. */
export const spendCost = (coin: Coin, feeRate: number) =>
  Math.ceil((inputWeight(coin) / 4) * feeRate);

const countWeight = (count: number) => (count > 252 ? 8 : 0);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Fee, change and totals for spending exactly these coins. */
export function spend(coins: Coin[], payment: Payment): Spend {
  const { recipients, feeRate, scriptType } = payment;
  const changeBytes = CHANGE_SCRIPT_BYTES[scriptType];
  const weight = (outputs: number) =>
    OVERHEAD_WEIGHT +
    countWeight(coins.length) +
    countWeight(outputs) +
    sum(coins.map(inputWeight)) +
    sum(recipients.map((r) => outputWeight(r.script.length / 2))) +
    (outputs > recipients.length ? outputWeight(changeBytes) : 0);
  const vsizeOf = (outputs: number) => Math.ceil(weight(outputs) / 4);
  const feeOf = (outputs: number) => Math.ceil(vsizeOf(outputs) * feeRate);

  const available = sum(coins.map((c) => c.value));
  const fixed = sum(recipients.map((r) => (r.value === "max" ? 0 : r.value)));
  const maxAt = recipients.findIndex((r) => r.value === "max");
  const amounts = recipients.map((r) => (r.value === "max" ? 0 : r.value));
  let outputs = recipients.length;
  let fee = feeOf(outputs);
  let change = 0;

  if (maxAt >= 0) {
    amounts[maxAt] = Math.max(available - fixed - fee, 0);
  } else {
    const withChange = available - fixed - feeOf(outputs + 1);
    const minChange = Math.max(
      dust(changeBytes, true),
      Math.ceil((INPUT_WEIGHT[scriptType] / 4) * feeRate) + 1,
    );
    if (withChange >= minChange) {
      change = withChange;
      outputs += 1;
      fee = feeOf(outputs);
    } else if (available - fixed > fee) {
      fee = available - fixed;
    }
  }

  const missing = fixed + fee - available;
  const dustAt = recipients.findIndex(
    (r, i) => amounts[i]! < dust(r.script.length / 2, isWitness(r.script)),
  );
  const problem: SpendProblem | null =
    coins.length === 0
      ? { kind: "no-coins" }
      : missing > 0
        ? { kind: "insufficient", missing }
        : dustAt >= 0
          ? { kind: "dust", recipient: dustAt }
          : null;

  return {
    coins,
    amounts,
    change,
    fee,
    vsize: vsizeOf(outputs),
    total: sum(amounts) + fee,
    problem,
  };
}

type Candidate = { coin: Coin; effective: number };

/** Core's branch and bound: a changeless set within `window` above `target`. */
function branchAndBound(
  pool: Candidate[],
  target: number,
  window: number,
): Coin[] | null {
  const sorted = [...pool].sort((a, b) => b.effective - a.effective);
  const lookahead: number[] = [];
  let total = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    lookahead[i] = total;
    total += sorted[i]!.effective;
  }
  if (total < target) return null;

  const selection: number[] = [];
  let best: number[] | null = null;
  let bestExcess = Infinity;
  let amount = 0;
  let next = 0;
  const deselect = () => {
    amount -= sorted[selection.pop()!]!.effective;
  };

  for (let tries = 0; tries < TOTAL_TRIES; tries++) {
    selection.push(next);
    amount += sorted[next]!.effective;
    next++;
    let shift = false;
    let cut = false;
    if (amount + lookahead[selection.at(-1)!]! < target) {
      cut = true;
    } else if (amount > target + window) {
      shift = true;
    } else if (amount >= target) {
      shift = true;
      if (amount - target <= bestExcess) {
        best = [...selection];
        bestExcess = amount - target;
      }
    }
    if (next === sorted.length) cut = true;
    if (cut) {
      deselect();
      shift = true;
    }
    while (shift) {
      if (selection.length === 0) return best && best.map((i) => sorted[i]!.coin);
      next = selection.at(-1)! + 1;
      deselect();
      shift = false;
      // An omitted coin's equal-valued neighbour would only repeat its search.
      while (sorted[next - 1]!.effective === sorted[next]!.effective) {
        if (next >= sorted.length - 1) {
          shift = true;
          break;
        }
        next++;
      }
    }
  }
  return best && best.map((i) => sorted[i]!.coin);
}

/** Coins in a seeded random order until they cover the target. */
function singleRandomDraw(
  pool: Candidate[],
  target: number,
  changeFee: number,
  seed: string,
): Coin[] | null {
  const key = (c: Candidate) =>
    hex.encode(sha256(utf8.decode(`${seed}:${outpoint(c.coin)}`)));
  const order = pool
    .map((c) => ({ c, key: key(c) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(({ c }) => c);
  let amount = 0;
  let enough: number | null = null;
  for (let i = 0; i < order.length; i++) {
    amount += order[i]!.effective;
    if (enough === null && amount >= target) enough = i + 1;
    if (amount >= target + changeFee + CHANGE_LOWER) return order.slice(0, i + 1).map((c) => c.coin);
  }
  return enough === null ? null : order.slice(0, enough).map((c) => c.coin);
}

/**
 * Picks coins for a payment, privacy first: from one source if any can pay,
 * the cheapest of those, then the one with least change; otherwise from the
 * fewest sources, largest first.
 * Within those, a changeless set by branch and bound if there is one,
 * otherwise a seeded random draw. A `"max"` recipient takes every eligible
 * coin. Frozen coins and coins with unconfirmed parents are never picked;
 * unconfirmed payments from others only when allowed. `groups` maps an
 * outpoint to its source; a coin not in it is a source of its own.
 */
export function selectCoins(
  coins: Coin[],
  payment: Payment,
  seed: string,
  groups: Map<string, string> = new Map(),
  allowForeignUnconfirmed = false,
): Spend {
  const { recipients, feeRate, scriptType } = payment;
  const pool = coins
    .filter(
      (c) =>
        !c.frozen &&
        c.status !== "unconfirmed-parents" &&
        (allowForeignUnconfirmed || c.status !== "foreign-unconfirmed"),
    )
    .map((coin) => ({
      coin,
      effective: coin.value - (inputWeight(coin) / 4) * feeRate,
    }))
    .filter((c) => c.effective > 0);
  if (recipients.some((r) => r.value === "max")) return spend(pool.map((c) => c.coin), payment);

  const changeOutput = outputWeight(CHANGE_SCRIPT_BYTES[scriptType]) / 4;
  const changeFee = changeOutput * feeRate;
  const costOfChange = changeFee + (INPUT_WEIGHT[scriptType] / 4) * feeRate;
  const rest =
    OVERHEAD_WEIGHT / 4 +
    sum(recipients.map((r) => outputWeight(r.script.length / 2) / 4));
  // The extra vbyte and sat cover rounding the size and the fee up.
  const target =
    sum(recipients.map((r) => r.value as number)) + (rest + 1) * feeRate + 1;

  const pick = (from: Candidate[]) =>
    spend(
      branchAndBound(from, target, costOfChange) ??
        singleRandomDraw(from, target, changeFee, seed) ??
        from.map((c) => c.coin),
      payment,
    );

  const bySource = new Map<string, Candidate[]>();
  for (const c of pool) {
    const id = groups.get(outpoint(c.coin)) ?? outpoint(c.coin);
    bySource.set(id, [...(bySource.get(id) ?? []), c]);
  }
  const sources = [...bySource.values()];
  const single = sources
    .map(pick)
    .filter((s) => !s.problem)
    .sort((a, b) => a.fee - b.fee || a.change - b.change)[0];
  if (single) return single;
  const worth = (s: Candidate[]) => sum(s.map((c) => c.effective));
  sources.sort((a, b) => worth(b) - worth(a));
  for (let n = 2; n < sources.length; n++) {
    const found = pick(sources.slice(0, n).flat());
    if (!found.problem) return found;
  }
  return pick(pool);
}
