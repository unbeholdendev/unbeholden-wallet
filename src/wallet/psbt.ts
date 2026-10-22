import { hex } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { Address, OutScript, Transaction } from "@scure/btc-signer";
import { equalBytes } from "@scure/btc-signer/utils.js";
import { outpoint, type Coin } from "./coin";
import { derivePayment } from "./derive";
import { childPath, HARDENED, type Descriptor, type DescriptorKey } from "./descriptor";
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
  /** Block time in Unix seconds; null before the first sync. */
  tip: { height: number; time: number } | null;
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
// The last signature byte: SIGHASH_ALL commits to every output. Taproot's
// 64-byte signature has none and means the same.
// https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#common-signature-message
const SIGHASH_ALL = 0x01;

const NO_ORIGIN_WARNING =
  "This wallet was imported without its key origin, so your signer may not recognise these coins or the change as its own. Import the full descriptor, with its [fingerprint/path], to fix this.";

function origin(key: DescriptorKey, network: Network) {
  if (key.origin) {
    return {
      fingerprint: Number.parseInt(key.origin.fingerprint, 16),
      path: key.origin.path,
    };
  }
  const hd = HDKey.fromExtendedKey(key.key, BIP32_VERSIONS[network]);
  return { fingerprint: hd.fingerprint, path: [] };
}

/** The output script and the PSBT fields that let a signer recognise it. */
function derivation(
  descriptor: Descriptor,
  network: Network,
  chain: number,
  index: number,
) {
  const { script, witnessScript, keys } = derivePayment(descriptor, network, chain, index);
  const ders = descriptor.keys.map((key, i) => {
    const from = origin(key, network);
    return [keys[i]!, { fingerprint: from.fingerprint, path: [...from.path, ...childPath(key, chain, index)] }] as [
      Uint8Array,
      { fingerprint: number; path: number[] },
    ];
  });
  if (descriptor.scriptType !== "tr") {
    return { script, fields: { bip32Derivation: ders, ...(witnessScript && { witnessScript }) } };
  }
  const [[publicKey, der]] = ders as [(typeof ders)[number]];
  const xOnly = publicKey.slice(1);
  return {
    script,
    fields: {
      tapInternalKey: xOnly,
      tapBip32Derivation: [[xOnly, { hashes: [], der }]] as [
        Uint8Array,
        { hashes: Uint8Array[]; der: typeof der },
      ][],
    },
  };
}

/**
 * PSBT_GLOBAL_XPUB for each multisig key, which signers such as Coldcard need
 * to tell change from a payment. BIP174 wants the key's depth to equal its
 * origin path's length, so a key without a full origin is left out.
 */
function globalXpubs(descriptor: Descriptor, network: Network) {
  if (!descriptor.multi) return [];
  return descriptor.keys.flatMap((key) => {
    const hd = HDKey.fromExtendedKey(key.key, BIP32_VERSIONS[network]);
    if (!key.origin || key.origin.path.length !== hd.depth) return [];
    const xpub = {
      version: hd.versions.public,
      depth: hd.depth,
      parentFingerprint: hd.parentFingerprint,
      childNumber: hd.index,
      chainCode: hd.chainCode!,
      publicKey: hd.publicKey!,
    };
    return [[xpub, origin(key, network)] as const];
  });
}

function randomBelow(n: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % n;
}

// Bitcoin Core's anti-fee-sniping, so these transactions look like Core's.
// https://github.com/bitcoin/bitcoin/blob/f80aaf4bd7c60d16d61d3cee88dd73a8a1bbfe80/src/wallet/spend.cpp#L981-L1035
const MAX_TIP_AGE = 8 * 60 * 60;

function lockTime(tip: PsbtRequest["tip"]): number {
  if (!tip || tip.time < Date.now() / 1000 - MAX_TIP_AGE) return 0;
  return randomBelow(10) === 0 ? Math.max(0, tip.height - randomBelow(100)) : tip.height;
}

/**
 * Builds an unsigned PSBT spending exactly the given coins. The caller has
 * already chosen the coins and the amounts; whatever they leave over is the fee.
 */
export function buildPsbt(request: PsbtRequest): BuiltPsbt {
  const { descriptor, network, coins, recipients, change, tip } = request;
  const params = NETWORKS[network];
  if (coins.length === 0) throw new Error("Choose at least one coin to spend");
  if (recipients.length === 0 && !change) {
    throw new Error("The transaction needs at least one output");
  }

  const tx = new Transaction({ version: 2, lockTime: lockTime(tip) });
  for (const coin of coins) {
    const { script, fields } = derivation(
      descriptor,
      network,
      coin.chain,
      coin.index,
    );
    if (hex.encode(script) !== coin.script) {
      throw new Error(
        `Coin ${outpoint(coin)} doesn't belong to this wallet at ${coin.chain}/${coin.index}`,
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
          `${recipient.address} isn't a valid ${network} address`,
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
  const xpubs = globalXpubs(descriptor, network);
  // Transaction keeps its global map private and offers no setter for it.
  if (xpubs.length) tx["global"].xpub = xpubs;
  return {
    psbt: tx.toPSBT(),
    warnings: descriptor.keys.every((k) => k.origin) ? [] : [NO_ORIGIN_WARNING],
  };
}

/** Parses a binary PSBT, refusing one that is malformed or inconsistent. */
export function parsePsbt(psbt: Uint8Array): Transaction {
  try {
    return Transaction.fromPSBT(psbt, { unknown: "ignore" });
  } catch {
    throw new Error("This isn't a valid PSBT");
  }
}

// BIP174: every PSBT starts with "psbt" and 0xff.
// https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki
const MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);

export const hasMagic = (bytes: Uint8Array) => MAGIC.every((b, i) => bytes[i] === b);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Checks that a PSBT or finished transaction back from the signer is the
 * transaction that was built, fully signed, and returns the raw transaction to
 * broadcast. Throws with the reason it was refused.
 */
export function finaliseSigned(
  built: Uint8Array,
  returned: Uint8Array,
): Uint8Array {
  const { ours, theirs } = matching(built, returned);
  return finalise(theirs, ours);
}

export type Collected = {
  /** The built PSBT with every signature so far, to show the next cosigner. */
  psbt: Uint8Array;
  /** Fewest signatures on any input, and how many each needs. */
  signed: number;
  needed: number;
  /** Fingerprints of the keys that have signed every input. */
  signers: string[];
  /** The transaction to broadcast, once every input has enough. */
  raw: Uint8Array | null;
};

/**
 * For a multisig: checks a PSBT back from one cosigner is the transaction
 * built, adds its signatures to those collected so far (BIP174's combiner),
 * and finalises once every input has `needed`. Throws with the reason it was refused.
 */
export function collectSigned(built: Uint8Array, collected: Uint8Array, returned: Uint8Array, needed: number): Collected {
  const { ours, theirs } = matching(built, returned);
  if (theirs.isFinal) return { psbt: collected, signed: needed, needed, signers: [], raw: finalise(theirs, ours) };
  const all = parsePsbt(collected);
  for (let i = 0; i < theirs.inputsLength; i++) {
    if (theirs.getInput(i).partialSig?.some(([, sig]) => sig.at(-1) !== SIGHASH_ALL)) {
      throw new Error(`Input ${i + 1} is signed so that whoever relays it could change where it pays`);
    }
  }
  try {
    all.combine(theirs);
  } catch {
    throw new Error("Its details differ from the signatures already collected");
  }
  const fingerprints = Array.from({ length: all.inputsLength }, (_, i) => {
    const sigs = all.getInput(i).partialSig ?? [];
    return (ours.getInput(i).bip32Derivation ?? [])
      .filter(([key]) => sigs.some(([signer]) => equalBytes(signer, key)))
      .map(([, der]) => der.fingerprint.toString(16).padStart(8, "0"));
  });
  const signed = Math.min(...fingerprints.map((f) => f.length));
  const signers = fingerprints[0]!.filter((f) => fingerprints.every((on) => on.includes(f)));
  const psbt = all.toPSBT();
  return { psbt, signed, needed, signers, raw: signed >= needed ? finalise(all, ours) : null };
}

function matching(built: Uint8Array, returned: Uint8Array): { ours: Transaction; theirs: Transaction } {
  const ours = parsePsbt(built);
  const theirs = hasMagic(returned) ? parsePsbt(returned) : withWitnesses(ours, returned);

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
  return { ours, theirs };
}

/**
 * Checks that a PSBT signed outside this wallet's own round trip spends only
 * the given coins, as the server knows them, and is fully signed. Returns the
 * raw transaction to broadcast. Throws with the reason it was refused.
 */
export function finaliseExternal(psbt: Uint8Array, coins: Coin[]): Uint8Array {
  const tx = parsePsbt(psbt);
  spent(tx, coins);
  return finalise(tx, tx);
}

/**
 * For a multisig: checks a PSBT from elsewhere spends only the given coins, as
 * `finaliseExternal` does, and returns it with this wallet's derivations and
 * witness scripts, to collect cosigners' signatures on with `collectSigned`.
 */
export function adoptExternal(psbt: Uint8Array, coins: Coin[], descriptor: Descriptor, network: Network): Uint8Array {
  const tx = parsePsbt(psbt);
  spent(tx, coins).forEach((coin, i) => tx.updateInput(i, derivation(descriptor, network, coin.chain, coin.index).fields, true));
  return tx.toPSBT();
}

function spent(tx: Transaction, coins: Coin[]): Coin[] {
  const owned = new Map(coins.map((c) => [outpoint(c), c]));
  if (!tx.inputsLength) throw new Error("It spends no coins");
  return Array.from({ length: tx.inputsLength }, (_, i) => {
    const input = tx.getInput(i);
    const coin = owned.get(outpoint({ txid: hex.encode(input.txid!), vout: input.index! }));
    if (!coin) throw new Error(`Input ${i + 1} isn't one of this wallet's unspent coins`);
    const utxo = input.witnessUtxo;
    if (!utxo || hex.encode(utxo.script) !== coin.script || utxo.amount !== BigInt(coin.value)) {
      throw new Error(`Input ${i + 1} describes its coin differently from your server`);
    }
    return coin;
  });
}

/** A transaction the signer finished itself, as the PSBT built with its witnesses. */
function withWitnesses(ours: Transaction, raw: Uint8Array): Transaction {
  let tx: Transaction;
  try {
    tx = Transaction.fromRaw(raw, { allowUnknownOutputs: true });
  } catch {
    throw new Error("This is neither a PSBT nor a transaction");
  }
  if (!equalBytes(tx.unsignedTx, ours.unsignedTx)) throw new Error("The signed transaction isn't the one built");
  const theirs = ours.clone();
  for (let i = 0; i < tx.inputsLength; i++) {
    const witness = tx.getInput(i).finalScriptWitness;
    if (witness?.length) theirs.updateInput(i, { finalScriptWitness: witness }, true);
  }
  return theirs;
}

/** `ours` gives the input scripts, so the signer cannot choose which signature rules apply. */
function finalise(theirs: Transaction, ours: Transaction): Uint8Array {
  for (let i = 0; i < theirs.inputsLength; i++) {
    try {
      if (!theirs.getInput(i).finalScriptWitness) theirs.finalizeIdx(i);
    } catch {
      throw new Error(`Input ${i + 1} isn't signed`);
    }
    const type = OutScript.decode(ours.getInput(i).witnessUtxo!.script).type;
    if (!signsEverything(theirs.getInput(i).finalScriptWitness!, type)) {
      throw new Error(`Input ${i + 1} is signed so that whoever relays it could change where it pays`);
    }
  }
  return theirs.extract();
}

function signsEverything(witness: Uint8Array[], type: string): boolean {
  const [sig] = witness;
  if (!sig) return false;
  if (type === "tr") {
    return witness.length === 1 && (sig.length === 64 || (sig.length === 65 && sig[64] === SIGHASH_ALL));
  }
  // The empty item CHECKMULTISIG pops, the signatures, then the script.
  if (type === "wsh") return witness.length > 2 && witness.slice(1, -1).every((s) => s.at(-1) === SIGHASH_ALL);
  return witness.length === 2 && sig.at(-1) === SIGHASH_ALL;
}

/** Where a derivation path sits under one of the descriptor's keys, if it does. */
function locate(
  key: DescriptorKey,
  network: Network,
  fingerprint: number,
  path: number[],
): { chain: number; index: number } | null {
  const from = origin(key, network);
  if (
    fingerprint !== from.fingerprint ||
    path.length !== from.path.length + key.path.length ||
    from.path.some((step, i) => path[i] !== step)
  ) {
    return null;
  }
  let chain = 0;
  let index = -1;
  for (const [i, step] of key.path.entries()) {
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
    const { witnessUtxo, witnessScript } = tx.getInput(i);
    const type = witnessUtxo && OutScript.decode(witnessUtxo.script).type;
    const multi = witnessScript && OutScript.decode(witnessScript);
    bytes += INPUT_BYTES;
    witness +=
      type === "tr"
        ? WITNESS_WEIGHT.tr
        : multi?.type === "ms"
          ? 1 + 1 + 73 * multi.m + varIntLength(witnessScript!.length) + witnessScript!.length
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
      .flatMap((der) => descriptor.keys.map((key) => locate(key, network, der.fingerprint, der.path)))
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
