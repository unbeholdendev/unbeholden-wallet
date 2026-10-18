import { HARDENED, type Descriptor } from "../wallet/descriptor";

/** One line of a BIP329 export. https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki */
export type Bip329Record = {
  type: string;
  ref: string;
  label?: string;
  origin?: string;
  /** Outputs only: false is the do-not-spend flag. */
  spendable?: boolean;
};

/** Skips lines that are not records, rather than failing the whole file. */
export function parseBip329(text: string): { records: Bip329Record[]; skipped: number } {
  const records: Bip329Record[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (
        typeof r?.type !== "string" ||
        typeof r.ref !== "string" ||
        !["string", "undefined"].includes(typeof r.label) ||
        !["string", "undefined"].includes(typeof r.origin) ||
        !["boolean", "undefined"].includes(typeof r.spendable)
      ) {
        throw new Error();
      }
      records.push(r);
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

export function formatBip329(records: Bip329Record[]): string {
  return records.map((r) => JSON.stringify(r) + "\n").join("");
}

/** The abbreviated descriptor BIP329 names a wallet by, such as `wpkh([d34db33f/84'/0'/0'])`. */
export function bip329Origin(descriptor: Descriptor): string | null {
  const { origin, scriptType } = descriptor;
  if (!origin) return null;
  const steps = origin.path.map((i) => (i >= HARDENED ? `${i - HARDENED}'` : `${i}`));
  return `${scriptType}([${[origin.fingerprint, ...steps].join("/")}])`;
}

export const sameOrigin = (a: string, b: string) => {
  const norm = (s: string) => s.replace(/(\d)h/g, "$1'").toLowerCase();
  return norm(a) === norm(b);
};
