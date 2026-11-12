import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { base64 } from "@scure/base";
import { Address, OutScript, p2pkh, p2sh, p2wpkh } from "@scure/btc-signer/payment.js";
import { RawWitness, Script, VarBytes } from "@scure/btc-signer/script.js";
import { Transaction } from "@scure/btc-signer/transaction.js";
import { concatBytes, equalBytes, hash160, sha256 } from "@scure/btc-signer/utils.js";
import { NETWORKS, type Network } from "./network";

// https://github.com/bitcoin/bips/blob/master/bip-0137.mediawiki#procedure-for-signingverifying-a-signature
const LEGACY_HEADER_MIN = 27;
// https://github.com/bitcoin/bips/blob/master/bip-0137.mediawiki#procedure-for-signingverifying-a-signature
const LEGACY_HEADER_MAX = 42;
// https://github.com/bitcoin/bitcoin/blob/master/src/common/signmessage.cpp
const LEGACY_PREFIX = "Bitcoin Signed Message:\n";
// https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki#verification
const SIGHASH_ALL = 1;
// https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#common-signature-message
const SIGHASH_DEFAULT = 0;

const utf8 = (text: string) => new TextEncoder().encode(text);

export function messageProblem(message: string): string | null {
  if (!message.length) return "Write a message to sign.";
  if (message.length > 240) return "Use at most 240 characters.";
  if (/[^\x20-\x7e]/.test(message)) return "Use printable ASCII characters, without line breaks.";
  return null;
}

function checkRequest(message: string, path: string) {
  const problem = messageProblem(message);
  if (problem) throw new Error(problem);
  if (!/^m(?:\/[0-9]+[h']?)+$/.test(path)) throw new Error("Invalid derivation path.");
}

export function signRequest(message: string, path: string): string {
  checkRequest(message, path);
  return `signmessage ${path} ascii:${message}`;
}

export function signFile(message: string, path: string): string {
  checkRequest(message, path);
  return `${message}\n${path}\np2wpkh\n`;
}

export function armour(message: string, address: string, signature: string): string {
  return `-----BEGIN BITCOIN SIGNED MESSAGE-----\n${message}\n-----BEGIN BITCOIN SIGNATURE-----\n${address}\n${signature}\n-----END BITCOIN SIGNATURE-----\n`;
}

export function readSignature(text: string): { signature: string; message?: string; address?: string } {
  const normal = text.replace(/\r\n/g, "\n");
  const block =
    /-----BEGIN BITCOIN SIGNED MESSAGE-----\n([\s\S]*?)\n-----BEGIN BITCOIN SIGNATURE-----\n([\s\S]*?)\n-----END BITCOIN SIGNATURE-----/.exec(
      normal,
    );
  if (block) {
    const lines = block[2]!.split("\n").filter((line) => line.trim());
    if (lines.length !== 2) throw new Error("Couldn't read this armoured signature.");
    return { message: block[1]!, address: lines[0]!.trim(), signature: lines[1]!.trim() };
  }
  if (normal.includes("-----BEGIN")) throw new Error("Couldn't read this armoured signature.");
  return { signature: normal.trim() };
}

export function verifyMessage(
  address: string,
  message: string,
  signature: string,
  network: Network,
): { valid: boolean; format: "legacy" | "BIP322" } {
  const params = NETWORKS[network];
  const output = Address(params).decode(address.trim());
  const script = OutScript.encode(output);
  const text = signature.trim();
  if (text.startsWith("ful") || text.startsWith("pof")) throw new Error("Full BIP322 signatures are not supported.");
  const simple = text.startsWith("smp");
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(simple ? text.slice(3) : text);
  } catch {
    throw new Error("This isn't a signature. Paste base64 or an armoured message.");
  }
  if (!simple && bytes.length === 65 && bytes[0]! >= LEGACY_HEADER_MIN && bytes[0]! <= LEGACY_HEADER_MAX) {
    let valid = false;
    try {
      // https://github.com/bitcoin/bips/blob/master/bip-0137.mediawiki
      const recovered = concatBytes(new Uint8Array([(bytes[0]! - LEGACY_HEADER_MIN) % 4]), bytes.slice(1));
      const hash = sha256(sha256(concatBytes(VarBytes.encode(utf8(LEGACY_PREFIX)), VarBytes.encode(utf8(message)))));
      const compressed = secp256k1.recoverPublicKey(recovered, hash, { prehash: false });
      const pubkey =
        bytes[0]! < LEGACY_HEADER_MIN + 4 ? secp256k1.Point.fromBytes(compressed).toBytes(false) : compressed;
      const candidates: { script: Uint8Array }[] = [p2pkh(pubkey, params)];
      if (pubkey.length === 33) candidates.push(p2wpkh(pubkey, params), p2sh(p2wpkh(pubkey, params), params));
      valid = candidates.some((p) => equalBytes(p.script, script));
    } catch {
      valid = false;
    }
    return { valid, format: "legacy" };
  }
  if (output.type !== "wpkh" && output.type !== "tr")
    throw new Error("BIP322 verification supports only P2WPKH and taproot key-path signatures.");
  let witness: Uint8Array[];
  try {
    witness = RawWitness.decode(bytes);
  } catch {
    throw new Error("This isn't a signature. Expected a BIP322 simple witness.");
  }
  // https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki#full
  const tag = sha256(utf8("BIP0322-signed-message"));
  const messageHash = sha256(concatBytes(tag, tag, utf8(message)));
  const options = { version: 0, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true };
  const toSpend = new Transaction(options);
  toSpend.addOutput({ script, amount: 0n });
  toSpend.addInput({
    txid: new Uint8Array(32),
    index: 0xffffffff,
    sequence: 0,
    finalScriptSig: Script.encode([0, messageHash]),
  });
  const toSign = new Transaction(options);
  toSign.addInput({ txid: toSpend.id, index: 0, sequence: 0 });
  toSign.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });
  let valid = false;
  try {
    if (output.type === "wpkh" && witness.length === 2) {
      const [sig, pubkey] = witness as [Uint8Array, Uint8Array];
      if (pubkey.length === 33 && equalBytes(hash160(pubkey), output.hash) && sig.at(-1) === SIGHASH_ALL) {
        const hash = toSign.preimageWitnessV0(0, p2pkh(pubkey, params).script, SIGHASH_ALL, 0n);
        valid = secp256k1.verify(sig.slice(0, -1), hash, pubkey, { prehash: false, format: "der", lowS: true });
      }
    } else if (output.type === "tr" && witness.length === 1) {
      const sig = witness[0]!;
      if (sig.length === 64 || (sig.length === 65 && sig[64] === SIGHASH_ALL)) {
        const hash = toSign.preimageWitnessV1(0, [script], sig.length === 64 ? SIGHASH_DEFAULT : SIGHASH_ALL, [0n]);
        valid = schnorr.verify(sig.slice(0, 64), hash, output.pubkey);
      }
    }
  } catch {
    valid = false;
  }
  return { valid, format: "BIP322" };
}
