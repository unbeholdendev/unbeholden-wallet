import { hex } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { Address, OutScript, Transaction } from "@scure/btc-signer";
import { p2tr, p2wpkh } from "@scure/btc-signer/payment.js";
import { equalBytes } from "@scure/btc-signer/utils.js";
import { outpoint, type Coin } from "./coin";
import { derivePublicKey } from "./derive";
import type { Descriptor } from "./descriptor";
import { BIP32_VERSIONS } from "./extended-key";
import { NETWORKS, type Network } from "./network";

/** Amounts in sats. */
export type Recipient = { address: string; value: number };
export type ChangeOutput = { chain: number; index: number; value: number };

export type PsbtRequest = {
  descriptor: Descriptor;
  network: Network;
  coins: Coin[];
  recipients: Recipient[];
  change?: ChangeOutput | null;
};

export type BuiltPsbt = {
  psbt: Uint8Array;
  /** Things the user should know before signing, as sentences. */
  warnings: string[];
};

export type ReviewOutput = {
  /** Null for a script with no address form. */
  address: string | null;
  value: number;
  /** Pays one of this wallet's own addresses, proven by its derivation. */
  mine: boolean;
  change: boolean;
};

export type PsbtReview = {
  outputs: ReviewOutput[];
  fee: number;
  /** Estimated from the input types, so it holds before signing too. */
  vsize: number;
  /** Sats per vbyte. */
  feeRate: number;
};

// BIP125: any nSequence below 0xfffffffe signals replaceability.
// https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki
const RBF_SEQUENCE = 0xfffffffd;
const HARDENED = 0x80000000;

const NO_ORIGIN_WARNING =
  "This wallet was imported without its key origin, so your signer may not recognise these coins or the change as its own. Import the full descriptor, with its [fingerprint/path], to fix this.";

function origin(descriptor: Descriptor, network: Network) {
  if (descriptor.origin) {
    return {
      fingerprint: Number.parseInt(descriptor.origin.fingerprint, 16),
      path: descriptor.origin.path,
    };
  }
  const key = HDKey.fromExtendedKey(descriptor.key, BIP32_VERSIONS[network]);
  return { fingerprint: key.fingerprint, path: [] };
}

/** The output script and the PSBT fields that let a signer recognise it. */
function derivation(
  descriptor: Descriptor,
  network: Network,
  chain: number,
  index: number,
) {
  const publicKey = derivePublicKey(descriptor, network, chain, index);
  const from = origin(descriptor, network);
  const der = {
    fingerprint: from.fingerprint,
    path: [
      ...from.path,
      ...descriptor.path.map((step) =>
        step === "*" ? index : typeof step === "number" ? step : step[chain]!,
      ),
    ],
  };
  const params = NETWORKS[network];
  if (descriptor.scriptType === "wpkh") {
    return {
      script: p2wpkh(publicKey, params).script,
      fields: { bip32Derivation: [[publicKey, der]] as [Uint8Array, typeof der][] },
    };
  }
  const xOnly = publicKey.slice(1);
  return {
    script: p2tr(xOnly, undefined, params).script,
    fields: {
      tapInternalKey: xOnly,
      tapBip32Derivation: [[xOnly, { hashes: [], der }]] as [
        Uint8Array,
        { hashes: Uint8Array[]; der: typeof der },
      ][],
    },
  };
}

function randomBelow(n: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % n;
}

/**
 * Builds an unsigned PSBT spending exactly the given coins. The caller has
 * already chosen the coins and the amounts; whatever they leave over is the fee.
 */
export function buildPsbt(request: PsbtRequest): BuiltPsbt {
  const { descriptor, network, coins, recipients, change } = request;
  const params = NETWORKS[network];
  if (coins.length === 0) throw new Error("Choose at least one coin to spend");
  if (recipients.length === 0 && !change) {
    throw new Error("The transaction needs at least one output");
  }

  const tx = new Transaction({ version: 2, lockTime: 0 });
  for (const coin of coins) {
    const { script, fields } = derivation(
      descriptor,
      network,
      coin.chain,
      coin.index,
    );
    if (hex.encode(script) !== coin.script) {
      throw new Error(
        `Coin ${outpoint(coin)} does not belong to this wallet at ${coin.chain}/${coin.index}`,
      );
    }
    tx.addInput({
      txid: coin.txid,
      index: coin.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: { script, amount: BigInt(coin.value) },
      ...fields,
    });
  }

  const outputs: Parameters<Transaction["addOutput"]>[0][] = recipients.map(
    (recipient) => {
      let script: Uint8Array;
      try {
        script = OutScript.encode(Address(params).decode(recipient.address));
      } catch {
        throw new Error(
          `${recipient.address} is not a valid ${network} address`,
        );
      }
      return { script, amount: BigInt(recipient.value) };
    },
  );
  if (change) {
    const { script, fields } = derivation(
      descriptor,
      network,
      change.chain,
      change.index,
    );
    // A fixed change position would tell a chain observer which output it is.
    outputs.splice(randomBelow(outputs.length + 1), 0, {
      script,
      amount: BigInt(change.value),
      ...fields,
    });
  }
  for (const output of outputs) tx.addOutput(output);

  if (tx.fee < 0n) {
    throw new Error("The outputs add up to more than the chosen coins hold");
  }
  return {
    psbt: tx.toPSBT(),
    warnings: descriptor.origin ? [] : [NO_ORIGIN_WARNING],
  };
}

/** Parses a binary PSBT, refusing one that is malformed or inconsistent. */
export function parsePsbt(psbt: Uint8Array): Transaction {
  try {
    return Transaction.fromPSBT(psbt, { unknown: "ignore" });
  } catch {
    throw new Error("This is not a valid PSBT");
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Checks that a PSBT back from the signer is the transaction that was built,
 * fully signed, and returns the raw transaction to broadcast. Throws with the
 * reason it was refused.
 */
export function finaliseSigned(
  built: Uint8Array,
  returned: Uint8Array,
): Uint8Array {
  const ours = parsePsbt(built);
  const theirs = parsePsbt(returned);

  if (theirs.inputsLength !== ours.inputsLength) {
    throw new Error(
      `The signed transaction spends ${plural(theirs.inputsLength, "coin")}, but the one built spends ${ours.inputsLength}`,
    );
  }
  for (let i = 0; i < ours.inputsLength; i++) {
    const a = ours.getInput(i);
    const b = theirs.getInput(i);
    if (!equalBytes(a.txid!, b.txid!) || a.index !== b.index) {
      throw new Error(`Input ${i + 1} spends a different coin from the one built`);
    }
  }
  if (theirs.outputsLength !== ours.outputsLength) {
    const extra = theirs.outputsLength - ours.outputsLength;
    throw new Error(
      extra > 0
        ? `The signed transaction has ${plural(extra, "output")} more than the one built`
        : `The signed transaction is missing ${plural(-extra, "output")}`,
    );
  }
  for (let i = 0; i < ours.outputsLength; i++) {
    const a = ours.getOutput(i);
    const b = theirs.getOutput(i);
    if (!equalBytes(a.script!, b.script!)) {
      throw new Error(`Output ${i + 1} pays a different address from the one built`);
    }
    if (a.amount !== b.amount) {
      throw new Error(
        `Output ${i + 1} pays ${b.amount} sats, but the one built pays ${a.amount} sats`,
      );
    }
  }
  if (theirs.fee !== ours.fee) {
    throw new Error(
      `The signer saw a fee of ${theirs.fee} sats, but the one built pays ${ours.fee} sats`,
    );
  }
  if (!equalBytes(theirs.unsignedTx, ours.unsignedTx)) {
    throw new Error(
      "The signed transaction differs from the one built in its version, lock time or sequence numbers",
    );
  }

  for (let i = 0; i < theirs.inputsLength; i++) {
    if (theirs.getInput(i).finalScriptWitness) continue;
    try {
      theirs.finalizeIdx(i);
    } catch {
      throw new Error(`Input ${i + 1} is not signed`);
    }
  }
  return theirs.extract();
}

/** Where a derivation path sits under the descriptor, if it does. */
function locate(
  descriptor: Descriptor,
  network: Network,
  fingerprint: number,
  path: number[],
): { chain: number; index: number } | null {
  const from = origin(descriptor, network);
  if (
    fingerprint !== from.fingerprint ||
    path.length !== from.path.length + descriptor.path.length ||
    from.path.some((step, i) => path[i] !== step)
  ) {
    return null;
  }
  let chain = 0;
  let index = -1;
  for (const [i, step] of descriptor.path.entries()) {
    const n = path[from.path.length + i]!;
    if (step === "*") index = n;
    else if (typeof step === "number") {
      if (n !== step) return null;
    } else {
      chain = step.indexOf(n);
      if (chain === -1) return null;
    }
  }
  return index < HARDENED ? { chain, index } : null;
}

const varIntLength = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);

// Count byte, then each item's length byte and bytes. 72 is the longest ECDSA
// signature with its sighash byte, so wpkh is an upper bound.
const WITNESS_WEIGHT = { wpkh: 1 + 1 + 72 + 1 + 33, tr: 1 + 1 + 64 };
const INPUT_BYTES = 32 + 4 + 1 + 4;

function estimateVsize(tx: Transaction): number {
  let bytes =
    4 + 4 + varIntLength(tx.inputsLength) + varIntLength(tx.outputsLength);
  let witness = 2;
  for (let i = 0; i < tx.inputsLength; i++) {
    const script = tx.getInput(i).witnessUtxo?.script;
    bytes += INPUT_BYTES;
    witness +=
      script && OutScript.decode(script).type === "tr"
        ? WITNESS_WEIGHT.tr
        : WITNESS_WEIGHT.wpkh;
  }
  for (let i = 0; i < tx.outputsLength; i++) {
    const length = tx.getOutput(i).script!.length;
    bytes += 8 + varIntLength(length) + length;
  }
  return Math.ceil((bytes * 4 + witness) / 4);
}

/** What a PSBT does, for the user to check before signing or broadcasting. */
export function reviewPsbt(
  psbt: Uint8Array,
  descriptor: Descriptor,
  network: Network,
): PsbtReview {
  const tx = parsePsbt(psbt);
  const outputs: ReviewOutput[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    const ders = [
      ...(output.bip32Derivation ?? []).map(([, der]) => der),
      ...(output.tapBip32Derivation ?? []).map(([, { der }]) => der),
    ];
    const at = ders
      .map((der) => locate(descriptor, network, der.fingerprint, der.path))
      .find(
        (found) =>
          found &&
          equalBytes(
            derivation(descriptor, network, found.chain, found.index).script,
            output.script!,
          ),
      );
    outputs.push({
      address: tx.getOutputAddress(i, NETWORKS[network]) ?? null,
      value: Number(output.amount),
      mine: !!at,
      change: at?.chain === 1,
    });
  }
  const fee = Number(tx.fee);
  const vsize = estimateVsize(tx);
  return { outputs, fee, vsize, feeRate: fee / vsize };
}
