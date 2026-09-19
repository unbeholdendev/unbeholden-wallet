import { base58check } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils.js";
import type { ScriptType } from "./descriptor";
import type { Network } from "./network";

/** Signet and regtest both use testnet's version bytes. */
type VersionClass = "mainnet" | "test";

const MAINNET = { private: 0x0488ade4, public: 0x0488b21e };
const TESTNET = { private: 0x04358394, public: 0x043587cf };

/** Standard BIP32 versions, the only ones this wallet serialises keys under. */
export const BIP32_VERSIONS: Record<Network, typeof MAINNET> = {
  mainnet: MAINNET,
  signet: TESTNET,
  regtest: TESTNET,
};

type Kind = ScriptType | "unspecified" | "sh-wpkh" | "multisig";

// Version bytes and their script types come from the SLIP-132 registry:
// https://github.com/satoshilabs/slips/blob/master/slip-0132.md
const VERSIONS = new Map<number, { class: VersionClass; kind: Kind }>([
  [0x0488b21e, { class: "mainnet", kind: "unspecified" }], // xpub
  [0x049d7cb2, { class: "mainnet", kind: "sh-wpkh" }], // ypub
  [0x04b24746, { class: "mainnet", kind: "wpkh" }], // zpub
  [0x0295b43f, { class: "mainnet", kind: "multisig" }], // Ypub
  [0x02aa7ed3, { class: "mainnet", kind: "multisig" }], // Zpub
  [0x043587cf, { class: "test", kind: "unspecified" }], // tpub
  [0x044a5262, { class: "test", kind: "sh-wpkh" }], // upub
  [0x045f1cf6, { class: "test", kind: "wpkh" }], // vpub
  [0x024289ef, { class: "test", kind: "multisig" }], // Upub
  [0x02575483, { class: "test", kind: "multisig" }], // Vpub
]);

export type NormalisedKey = {
  /** The same key under the standard `xpub` or `tpub` version. */
  key: string;
  /** Null when the prefix does not imply one, as for a bare `xpub`. */
  scriptType: ScriptType | null;
};

/**
 * Rewrites a SLIP-132 extended public key as a plain `xpub` or `tpub`, and
 * reports the script type its prefix implies.
 */
export function normaliseExtendedKey(
  text: string,
  network: Network,
): NormalisedKey {
  let raw: Uint8Array;
  try {
    raw = base58check(sha256).decode(text);
  } catch {
    throw new Error("This is not an extended public key");
  }
  if (raw.length !== 78) throw new Error("This is not an extended public key");
  // A BIP32 private key is a zero byte followed by the 32 key bytes, where a
  // public key starts 0x02 or 0x03. This catches every `prv` prefix at once.
  if (raw[45] === 0) {
    throw new Error("This is a private key. Import the public key instead");
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = VERSIONS.get(view.getUint32(0));
  if (!version) throw new Error("This is not an extended public key");
  if (version.kind === "sh-wpkh") {
    throw new Error(
      "This is a wrapped SegWit key, a script type this wallet does not support",
    );
  }
  if (version.kind === "multisig") {
    throw new Error(
      "This is a multisig key, which this wallet does not support",
    );
  }

  const wanted: VersionClass = network === "mainnet" ? "mainnet" : "test";
  if (version.class !== wanted) {
    throw new Error(
      version.class === "mainnet"
        ? `This is a mainnet key, but the wallet is on ${network}`
        : `This is a test network key, but the wallet is on ${network}`,
    );
  }

  view.setUint32(0, BIP32_VERSIONS[network].public);
  return {
    key: base58check(sha256).encode(raw),
    scriptType: version.kind === "unspecified" ? null : version.kind,
  };
}
