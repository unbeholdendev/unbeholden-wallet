import { sha256 } from "@scure/btc-signer/utils.js";

// A port of the Blockchain Commons reference implementation, which every
// signer's UR decoder follows; any departure from it breaks interoperability.
// https://github.com/BlockchainCommons/bc-ur/tree/master/src
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md

// https://github.com/BlockchainCommons/bc-ur/blob/master/src/crc32.c
const CRC_POLYNOMIAL = 0xedb88320;
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const uint32Bytes = (n: number) =>
  Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (64n - k))) & MASK;

/** xoshiro256**, seeded from the SHA-256 of its seed. */
export class Xoshiro256 {
  private s: [bigint, bigint, bigint, bigint];

  constructor(seed: Uint8Array | string) {
    const digest = sha256(
      typeof seed === "string" ? new TextEncoder().encode(seed) : seed,
    );
    const view = new DataView(digest.buffer, digest.byteOffset, 32);
    this.s = [0, 8, 16, 24].map((o) => view.getBigUint64(o)) as Xoshiro256["s"];
  }

  next(): bigint {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s[1] << 17n) & MASK;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }

  nextDouble(): number {
    return Number(this.next()) / 2 ** 64;
  }

  nextInt(low: number, high: number): number {
    return Math.floor(this.nextDouble() * (high - low + 1)) + low;
  }
}

/** Walker's alias method, built exactly as the reference builds it. */
function sampler(weights: number[]) {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0);
  const p = weights.map((w) => (w * n) / sum);
  const small: number[] = [];
  const large: number[] = [];
  for (let i = n - 1; i >= 0; i--) (p[i]! < 1 ? small : large).push(i);
  const probs = new Array<number>(n).fill(0);
  const aliases = new Array<number>(n).fill(0);
  while (small.length && large.length) {
    const a = small.pop()!;
    const g = large.pop()!;
    probs[a] = p[a]!;
    aliases[a] = g;
    p[g] = p[g]! + (p[a]! - 1);
    (p[g]! < 1 ? small : large).push(g);
  }
  for (const i of [...large, ...small]) probs[i] = 1;
  return (rng: Xoshiro256) => {
    const i = Math.floor(n * rng.nextDouble());
    return rng.nextDouble() < probs[i]! ? i : aliases[i]!;
  };
}

function shuffled<T>(items: T[], rng: Xoshiro256): T[] {
  const remaining = [...items];
  const result: T[] = [];
  while (remaining.length) {
    result.push(remaining.splice(rng.nextInt(0, remaining.length - 1), 1)[0]!);
  }
  return result;
}

/** The fragments mixed into a part, ascending. */
export function chooseFragments(
  seqNum: number,
  seqLen: number,
  checksum: number,
): number[] {
  if (seqNum <= seqLen) return [seqNum - 1];
  const seed = new Uint8Array(8);
  seed.set(uint32Bytes(seqNum));
  seed.set(uint32Bytes(checksum), 4);
  const rng = new Xoshiro256(seed);
  const degree =
    sampler(Array.from({ length: seqLen }, (_, i) => 1 / (i + 1)))(rng) + 1;
  const indexes = Array.from({ length: seqLen }, (_, i) => i);
  return shuffled(indexes, rng)
    .slice(0, degree)
    .sort((a, b) => a - b);
}

// Far more than any PSBT a camera could read; bounds what a crafted part can make us allocate.
const MAX_MESSAGE_LENGTH = 1 << 20;
// Choosing a mixed part's fragments costs the square of the part count, so a
// crafted first part with tiny fragments could stall the tab on every frame.
const MAX_PARTS = 2_000;

export type FountainPart = {
  seqNum: number;
  seqLen: number;
  messageLen: number;
  checksum: number;
  data: Uint8Array;
};

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((byte, i) => byte ^ b[i]!);
}

export class FountainEncoder {
  readonly seqLen: number;
  private readonly fragments: Uint8Array[];
  private readonly messageLen: number;
  private readonly checksum: number;
  private seqNum: number;

  constructor(
    message: Uint8Array,
    maxFragmentLength: number,
    firstSeqNum = 0,
    minFragmentLength = 10,
  ) {
    let length = message.length;
    const maxCount = Math.floor(message.length / minFragmentLength);
    for (let count = 1; count <= maxCount; count++) {
      length = Math.ceil(message.length / count);
      if (length <= maxFragmentLength) break;
    }
    this.fragments = Array.from(
      { length: Math.ceil(message.length / length) },
      (_, i) => {
        const fragment = new Uint8Array(length);
        fragment.set(message.subarray(i * length, (i + 1) * length));
        return fragment;
      },
    );
    this.seqLen = this.fragments.length;
    this.messageLen = message.length;
    this.checksum = crc32(message);
    this.seqNum = firstSeqNum;
  }

  /** Endless: the pure fragments first, then mixed ones. */
  nextPart(): FountainPart {
    this.seqNum = (this.seqNum + 1) >>> 0;
    const data = chooseFragments(this.seqNum, this.seqLen, this.checksum)
      .map((i) => this.fragments[i]!)
      .reduce(xor);
    return {
      seqNum: this.seqNum,
      seqLen: this.seqLen,
      messageLen: this.messageLen,
      checksum: this.checksum,
      data,
    };
  }
}

type Mixed = { indexes: number[]; data: Uint8Array };

const key = (part: Mixed) => part.indexes.join(",");

/** Takes `b` out of `a` when `b` holds a strict subset of `a`'s fragments. */
function reduce(a: Mixed, b: Mixed): Mixed {
  if (
    b.indexes.length >= a.indexes.length ||
    !b.indexes.every((i) => a.indexes.includes(i))
  ) {
    return a;
  }
  return {
    indexes: a.indexes.filter((i) => !b.indexes.includes(i)),
    data: xor(a.data, b.data),
  };
}

export type Progress = {
  /** Fragments recovered so far. */
  captured: number;
  /** Fragments in the message, 0 until the first part arrives. */
  expected: number;
  /** An estimate from 0 to 1 of how far through the transfer is. */
  fraction: number;
};

export class FountainDecoder {
  result: Uint8Array | null = null;
  error: Error | null = null;
  private expected: Omit<FountainPart, "seqNum" | "data"> & {
    fragmentLength: number;
  } | null = null;
  private simple = new Map<number, Uint8Array>();
  private mixed = new Map<string, Mixed>();
  private queue: Mixed[] = [];
  private processed = 0;

  /** False when the part was ignored: the wrong message, or already done. */
  receive(part: FountainPart): boolean {
    if (this.result || this.error) return false;
    const e = this.expected;
    if (!e) {
      if (
        part.messageLen > MAX_MESSAGE_LENGTH ||
        part.seqLen > MAX_PARTS ||
        part.seqLen !== Math.ceil(part.messageLen / part.data.length)
      ) {
        return false;
      }
      this.expected = { ...part, fragmentLength: part.data.length };
    } else if (
      part.seqLen !== e.seqLen ||
      part.messageLen !== e.messageLen ||
      part.checksum !== e.checksum ||
      part.data.length !== e.fragmentLength
    ) {
      return false;
    }
    this.queue.push({
      indexes: chooseFragments(part.seqNum, part.seqLen, part.checksum),
      data: part.data,
    });
    while (!this.result && !this.error && this.queue.length) {
      const next = this.queue.shift()!;
      if (next.indexes.length === 1) this.processSimple(next);
      else this.processMixed(next);
    }
    this.processed++;
    return true;
  }

  get progress(): Progress {
    const expected = this.expected?.seqLen ?? 0;
    const fraction = this.result
      ? 1
      : expected && Math.min(0.99, this.processed / (expected * 1.75));
    return { captured: this.simple.size, expected, fraction };
  }

  /** Which fragments are recovered, by index from 0. */
  get parts(): number[] {
    return [...this.simple.keys()];
  }

  private processSimple(part: Mixed) {
    const index = part.indexes[0]!;
    if (this.simple.has(index)) return;
    this.simple.set(index, part.data);
    const e = this.expected!;
    if (this.simple.size < e.seqLen) {
      this.reduceMixedBy(part);
      return;
    }
    const message = new Uint8Array(e.seqLen * e.fragmentLength);
    for (const [i, data] of this.simple) message.set(data, i * e.fragmentLength);
    const result = message.slice(0, e.messageLen);
    if (crc32(result) === e.checksum) this.result = result;
    else this.error = new Error("The scanned data failed its checksum");
  }

  private processMixed(part: Mixed) {
    if (this.mixed.has(key(part))) return;
    let reduced = part;
    for (const [i, data] of this.simple) {
      reduced = reduce(reduced, { indexes: [i], data });
    }
    for (const other of this.mixed.values()) reduced = reduce(reduced, other);
    if (reduced.indexes.length === 1) {
      this.queue.push(reduced);
    } else {
      this.reduceMixedBy(reduced);
      this.mixed.set(key(reduced), reduced);
    }
  }

  private reduceMixedBy(part: Mixed) {
    const mixed = new Map<string, Mixed>();
    for (const other of this.mixed.values()) {
      const reduced = reduce(other, part);
      if (reduced.indexes.length === 1) this.queue.push(reduced);
      else mixed.set(key(reduced), reduced);
    }
    this.mixed = mixed;
  }
}
