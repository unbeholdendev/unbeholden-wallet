import { descriptorChecksum, stripChecksum } from "./checksum";
import { normaliseExtendedKey } from "./extended-key";
import type { Network } from "./network";

/** The single-key script types. */
export type ScriptType = "wpkh" | "tr";

export type KeyOrigin = {
  /** Eight lowercase hex characters. */
  fingerprint: string;
  /** Hardened steps carry the BIP32 offset. */
  path: number[];
};

/** A fixed child index, a BIP389 multipath choice, or the address wildcard. */
export type PathStep = number | number[] | "*";

export type DescriptorKey = {
  origin: KeyOrigin | null;
  /** Always a plain `xpub` or `tpub`, whatever prefix it arrived under. */
  key: string;
  path: PathStep[];
};

export type Descriptor = {
  scriptType: ScriptType | "wsh";
  /** One for wpkh and tr; a multisig's in the order written. */
  keys: DescriptorKey[];
  /** wsh only: signatures needed, and whether the keys are sorted (BIP67) into the script. */
  multi?: { threshold: number; sorted: boolean };
};

// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
export const HARDENED = 0x80000000;

// https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
// https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki
const BIP44_PURPOSES: Record<number, ScriptType> = { 84: "wpkh", 86: "tr" };

// Above 16, k and n stop being single opcodes in the script, and no signer
// this wallet works with goes that far.
const MAX_KEYS = 16;

function parseIndex(text: string, allowHardened: boolean): number {
  const hardened = text.endsWith("h") || text.endsWith("'");
  const digits = hardened ? text.slice(0, -1) : text;
  if (!/^\d+$/.test(digits)) {
    throw new Error(`${JSON.stringify(text)} is not a derivation step`);
  }
  const index = Number(digits);
  if (index >= HARDENED) throw new Error(`Derivation step ${digits} is too big`);
  if (!hardened) return index;
  if (!allowHardened) {
    throw new Error(
      "A descriptor cannot derive hardened steps from a public key",
    );
  }
  return index + HARDENED;
}

function parseOrigin(text: string): KeyOrigin {
  const [fingerprint = "", ...steps] = text.split("/");
  if (!/^[0-9a-fA-F]{8}$/.test(fingerprint)) {
    throw new Error("Key origin fingerprint must be eight hex characters");
  }
  return {
    fingerprint: fingerprint.toLowerCase(),
    path: steps.map((step) => parseIndex(step, true)),
  };
}

function parsePath(steps: string[]): PathStep[] {
  let multipath = false;
  const path = steps.map((step): PathStep => {
    if (step === "*") return "*";
    if (step === "*h" || step === "*'") {
      throw new Error(
        "A descriptor cannot derive hardened steps from a public key",
      );
    }
    if (step.startsWith("<") && step.endsWith(">")) {
      if (multipath) {
        throw new Error("A descriptor may have only one multipath step");
      }
      multipath = true;
      const choices = step.slice(1, -1).split(";");
      const indexes = choices.map((choice) => parseIndex(choice, false));
      // The wallet reads the two choices as its receive and change chains.
      if (indexes.length !== 2 || indexes[0] === indexes[1]) {
        throw new Error("A multipath step needs two different choices, receive then change");
      }
      return indexes;
    }
    return parseIndex(step, false);
  });
  if (path.at(-1) !== "*" || path.indexOf("*") !== path.length - 1) {
    throw new Error(
      "A wallet descriptor must end in the * wildcard, and hold only one",
    );
  }
  return path;
}

function parseKey(text: string, network: Network): DescriptorKey {
  let origin: KeyOrigin | null = null;
  let rest = text;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) throw new Error("Key origin is missing its closing ]");
    origin = parseOrigin(rest.slice(1, close));
    rest = rest.slice(close + 1);
  }
  const [key = "", ...steps] = rest.split("/");
  return {
    origin,
    key: normaliseExtendedKey(key, network).key,
    path: steps.length ? parsePath(steps) : [[0, 1], "*"],
  };
}

export function parseDescriptor(text: string, network: Network): Descriptor {
  const body = stripChecksum(text.trim());
  const match = /^([a-zA-Z]+)\((.*)\)$/.exec(body);
  if (!match) throw new Error("This is not a descriptor");
  const scriptType = match[1]!;
  const inner = match[2]!;
  if (scriptType === "wsh") {
    const multi = /^(multi|sortedmulti)\((\d+),(.*)\)$/.exec(inner);
    if (!multi) throw new Error("This wallet supports wsh() only around multi() or sortedmulti()");
    const keys = multi[3]!.split(",").map((key) => parseKey(key, network));
    const threshold = Number(multi[2]);
    if (keys.length > MAX_KEYS) throw new Error(`This wallet supports multisig with up to ${MAX_KEYS} keys`);
    if (threshold < 1 || threshold > keys.length) {
      throw new Error(`A multisig of ${keys.length} keys needs from 1 to ${keys.length} signatures, not ${threshold}`);
    }
    if (new Set(keys.map((k) => k.path.some(Array.isArray))).size > 1) {
      throw new Error("Either every key in a multisig has a <receive;change> step, or none does");
    }
    return { scriptType, keys, multi: { threshold, sorted: multi[1] === "sortedmulti" } };
  }
  if (scriptType !== "wpkh" && scriptType !== "tr") {
    throw new Error("This wallet supports only wpkh, tr and wsh multisig descriptors");
  }
  if (inner.includes(",")) {
    throw new Error(
      `${scriptType}() must hold a single key; script trees and multiple keys are not supported`,
    );
  }
  return { scriptType, keys: [parseKey(inner, network)] };
}

/**
 * Builds the descriptor implied by a bare extended public key, covering the
 * receive and change chains. SLIP-132 prefixes carry a script type, and so
 * does the BIP44 purpose of a `[fingerprint/path]` origin before it; a bare
 * `xpub` or `tpub` does not, so the caller must supply one.
 */
export function descriptorFromExtendedKey(
  text: string,
  network: Network,
  scriptType?: ScriptType,
): Descriptor {
  const origin = /^\[([^\]]*)\](.*)$/.exec(text.trim());
  if (origin) {
    const parsed = parseOrigin(origin[1]!);
    const purpose = BIP44_PURPOSES[parsed.path[0]! - HARDENED];
    if (!purpose) {
      throw new Error("This key's path is not a wpkh (84h) or tr (86h) account. For a multisig, paste its whole descriptor");
    }
    const { key, path } = descriptorFromExtendedKey(origin[2]!, network, purpose).keys[0]!;
    return { scriptType: purpose, keys: [{ origin: parsed, key, path }] };
  }
  const normalised = normaliseExtendedKey(text, network);
  if (
    normalised.scriptType &&
    scriptType &&
    normalised.scriptType !== scriptType
  ) {
    throw new Error(
      `This key's prefix says ${normalised.scriptType}, but ${scriptType} was asked for`,
    );
  }
  if (normalised.scriptType === "wsh") {
    throw new Error("This is one cosigner's key of a multisig. Paste the multisig's whole descriptor instead");
  }
  const chosen = normalised.scriptType ?? scriptType;
  if (!chosen) {
    throw new Error(
      "This key's prefix does not say which script type to use. Choose wpkh or tr",
    );
  }
  return {
    scriptType: chosen,
    keys: [{ origin: null, key: normalised.key, path: [[0, 1], "*"] }],
  };
}

export function formatIndex(index: number): string {
  return index >= HARDENED ? `${index - HARDENED}h` : `${index}`;
}

/** A key's steps below it, for one chain and address index. */
export function childPath(key: DescriptorKey, chain: number, index: number): number[] {
  return key.path.map((step) => (step === "*" ? index : typeof step === "number" ? step : step[chain]!));
}

function formatStep(step: PathStep): string {
  if (step === "*") return "*";
  if (typeof step === "number") return formatIndex(step);
  return `<${step.map(formatIndex).join(";")}>`;
}

/** The canonical text of a descriptor, with its BIP380 checksum. */
export function formatDescriptor(descriptor: Descriptor): string {
  const keys = descriptor.keys.map(({ origin, key, path }) => {
    const from = origin ? `[${[origin.fingerprint, ...origin.path.map(formatIndex)].join("/")}]` : "";
    return `${from}${key}${path.map((step) => `/${formatStep(step)}`).join("")}`;
  });
  const { multi } = descriptor;
  const inner = multi ? `${multi.sorted ? "sortedmulti" : "multi"}(${multi.threshold},${keys.join(",")})` : keys[0];
  const body = `${descriptor.scriptType}(${inner})`;
  return `${body}#${descriptorChecksum(body)}`;
}
