import { formatDescriptor, type ScriptType } from "../wallet/descriptor";
import { normaliseExtendedKey } from "../wallet/extended-key";
import type { Network } from "../wallet/network";
import { type WalletRecord, walletDescriptor } from "./wallets";

export type Reading = {
  descriptor?: string;
  fingerprint?: string;
  /** A multisig's k, and each key's fingerprint, null for a key without an origin. */
  multi?: { threshold: number; fingerprints: (string | null)[] };
  needsType?: boolean;
  error?: string;
};

export const canonical = (wallet: Pick<WalletRecord, "descriptor" | "network" | "scriptType">) =>
  formatDescriptor(walletDescriptor(wallet));

// xpub, ypub, zpub, Ypub and Zpub are the mainnet prefixes in SLIP-132. Keys for
// every test network look alike, so the server's chain picks between them.
export const keyNetwork = (text: string, server: Network | null): Network =>
  /(^|[(\],])[xyzYZ]pub/.test(text.trim()) ? "mainnet" : server && server !== "mainnet" ? server : "signet";

/** What the pasted or scanned text reads as: a descriptor, a key needing a script type, or an error. */
export function interpret(text: string, network: Network, scriptType: ScriptType | null): Reading {
  const input = text.trim();
  if (!input) return {};
  try {
    const needsType = !/[([]/.test(input) && normaliseExtendedKey(input, network).scriptType === null;
    if (needsType && !scriptType) return { needsType };
    const descriptor = walletDescriptor({ descriptor: input, network, scriptType });
    const { keys, multi } = descriptor;
    return {
      needsType,
      descriptor: formatDescriptor(descriptor),
      fingerprint: multi ? undefined : keys[0]!.origin?.fingerprint,
      multi: multi && { threshold: multi.threshold, fingerprints: keys.map((k) => k.origin?.fingerprint ?? null) },
    };
  } catch (error) {
    return { error: `${(error as Error).message}.` };
  }
}

/** The descriptors from a scanned account that this wallet can watch. */
export const watchable = (found: string[]) => found.filter((f) => /^(wpkh|tr|wsh\((sorted)?multi)\(/.test(f));
