import { descriptorChecksum, stripChecksum } from "./checksum";
import { normaliseExtendedKey } from "./extended-key";
import type { Network } from "./network";

export type ScriptType = "wpkh" | "tr";

export type KeyOrigin = {
  /** Eight lowercase hex characters. */
  fingerprint: string;
  /** Hardened steps carry the BIP32 offset. */
  path: number[];
};

/** A fixed child index, a BIP389 multipath choice, or the address wildcard. */
export type PathStep = number | number[] | "*";

export type Descriptor = {
  scriptType: ScriptType;
  origin: KeyOrigin | null;
  /** Always a plain `xpub` or `tpub`, whatever prefix it arrived under. */
  key: string;
  path: PathStep[];
};

// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
export const HARDENED = 0x80000000;

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

export function parseDescriptor(text: string, network: Network): Descriptor {
  const body = stripChecksum(text.trim());
  const match = /^([a-zA-Z]+)\((.*)\)$/.exec(body);
  if (!match) throw new Error("This is not a descriptor");
  const scriptType = match[1]!;
  const inner = match[2]!;
  if (scriptType !== "wpkh" && scriptType !== "tr") {
    throw new Error("This wallet supports only wpkh and tr descriptors");
  }
  if (inner.includes(",")) {
    throw new Error(
      `${scriptType}() must hold a single key; script trees and multiple keys are not supported`,
    );
  }

  let origin: KeyOrigin | null = null;
  let rest = inner;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) throw new Error("Key origin is missing its closing ]");
    origin = parseOrigin(rest.slice(1, close));
    rest = rest.slice(close + 1);
  }

  const [key = "", ...steps] = rest.split("/");
  return {
    scriptType,
    origin,
    key: normaliseExtendedKey(key, network).key,
    path: parsePath(steps),
  };
}

/**
 * Builds the descriptor implied by a bare extended public key, covering the
 * receive and change chains. SLIP-132 prefixes carry a script type; a bare
 * `xpub` or `tpub` does not, so the caller must supply one.
 */
export function descriptorFromExtendedKey(
  text: string,
  network: Network,
  scriptType?: ScriptType,
): Descriptor {
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
  const chosen = normalised.scriptType ?? scriptType;
  if (!chosen) {
    throw new Error(
      "This key's prefix does not say which script type to use. Choose wpkh or tr",
    );
  }
  return {
    scriptType: chosen,
    origin: null,
    key: normalised.key,
    path: [[0, 1], "*"],
  };
}

export function formatIndex(index: number): string {
  return index >= HARDENED ? `${index - HARDENED}h` : `${index}`;
}

/** The descriptor's steps below its key, for one chain and address index. */
export function childPath(descriptor: Descriptor, chain: number, index: number): number[] {
  return descriptor.path.map((step) => (step === "*" ? index : typeof step === "number" ? step : step[chain]!));
}

function formatStep(step: PathStep): string {
  if (step === "*") return "*";
  if (typeof step === "number") return formatIndex(step);
  return `<${step.map(formatIndex).join(";")}>`;
}

/** The canonical text of a descriptor, with its BIP380 checksum. */
export function formatDescriptor(descriptor: Descriptor): string {
  let origin = "";
  if (descriptor.origin) {
    const steps = descriptor.origin.path.map(formatIndex);
    origin = `[${[descriptor.origin.fingerprint, ...steps].join("/")}]`;
  }
  const path = descriptor.path.map((step) => `/${formatStep(step)}`).join("");
  const body = `${descriptor.scriptType}(${origin}${descriptor.key}${path})`;
  return `${body}#${descriptorChecksum(body)}`;
}
