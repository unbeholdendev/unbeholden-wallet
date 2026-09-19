// Every constant and the polymod below are transcribed from BIP380's reference
// implementation: https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

const GENERATOR = [
  0xf5dee51989n,
  0xa9fdca3312n,
  0x1bab10e32dn,
  0x3706b1677an,
  0x644d626ffdn,
];

function polymod(symbols: number[]): bigint {
  let chk = 1n;
  for (const value of symbols) {
    const top = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) chk ^= GENERATOR[i]!;
    }
  }
  return chk;
}

function expand(payload: string): number[] {
  const symbols: number[] = [];
  const groups: number[] = [];
  for (const character of payload) {
    const value = INPUT_CHARSET.indexOf(character);
    if (value === -1) {
      throw new Error(
        `Descriptor contains a character that cannot appear in one: ${JSON.stringify(character)}`,
      );
    }
    symbols.push(value & 31);
    groups.push(value >> 5);
    if (groups.length === 3) {
      symbols.push(groups[0]! * 9 + groups[1]! * 3 + groups[2]!);
      groups.length = 0;
    }
  }
  if (groups.length === 1) symbols.push(groups[0]!);
  else if (groups.length === 2) symbols.push(groups[0]! * 3 + groups[1]!);
  return symbols;
}

/** The eight-character BIP380 checksum for a descriptor written without one. */
export function descriptorChecksum(payload: string): string {
  const checksum = polymod([...expand(payload), 0, 0, 0, 0, 0, 0, 0, 0]) ^ 1n;
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CHECKSUM_CHARSET[Number((checksum >> (5n * BigInt(7 - i))) & 31n)];
  }
  return out;
}

/** Verifies any `#checksum` suffix and returns the descriptor without it. */
export function stripChecksum(text: string): string {
  const hash = text.indexOf("#");
  if (hash === -1) return text;
  const payload = text.slice(0, hash);
  const checksum = text.slice(hash + 1);
  const malformed =
    checksum.length !== 8 ||
    [...checksum].some((c) => !CHECKSUM_CHARSET.includes(c));
  if (malformed) {
    throw new Error("Descriptor checksum must be eight bech32 characters");
  }
  if (descriptorChecksum(payload) !== checksum) {
    throw new Error("Descriptor checksum does not match the descriptor");
  }
  return payload;
}
