import {
  crc32,
  FountainDecoder,
  FountainEncoder,
  uint32Bytes,
  type FountainPart,
  type Progress,
} from "./fountain";
import { hex } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { HARDENED } from "../wallet/descriptor";
import { BIP32_VERSIONS } from "../wallet/extended-key";

// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-012-bytewords.md
const BYTEWORDS = `
  able acid also apex aqua arch atom aunt away axis back bald barn belt beta bias
  blue body brag brew bulb buzz calm cash cats chef city claw code cola cook cost
  crux curl cusp cyan dark data days deli dice diet door down draw drop drum dull
  duty each easy echo edge epic even exam exit eyes fact fair fern figs film fish
  fizz flap flew flux foxy free frog fuel fund gala game gear gems gift girl glow
  good gray grim guru gush gyro half hang hard hawk heat help high hill holy hope
  horn huts iced idea idle inch inky into iris iron item jade jazz join jolt jowl
  judo jugs jump junk jury keep keno kept keys kick kiln king kite kiwi knob lamb
  lava lazy leaf legs liar limp lion list logo loud love luau luck lung main many
  math maze memo menu meow mild mint miss monk nail navy need news next noon note
  numb obey oboe omit onyx open oval owls paid part peck play plus poem pool pose
  puff puma purr quad quiz race ramp real redo rich road rock roof ruby ruin runs
  rust safe saga scar sets silk skew slot soap solo song stub surf swan taco task
  taxi tent tied time tiny toil tomb toys trip tuna twin ugly undo unit urge user
  vast very veto vial vibe view visa void vows wall wand warm wasp wave waxy webs
  what when whiz wolf work yank yawn yell yoga yurt zaps zero zest zinc zone zoom
`
  .trim()
  .split(/\s+/)
  .map((word) => word[0]! + word[3]!);
const BYTE_OF = new Map(BYTEWORDS.map((word, byte) => [word, byte]));

/** Bytewords in minimal style, with the CRC32 suffix. */
export function bytewordsEncode(data: Uint8Array): string {
  const all = new Uint8Array(data.length + 4);
  all.set(data);
  all.set(uint32Bytes(crc32(data)), data.length);
  return Array.from(all, (byte) => BYTEWORDS[byte]).join("");
}

export function bytewordsDecode(text: string): Uint8Array {
  const pairs = text.toLowerCase().match(/../g) ?? [];
  const bytes = Uint8Array.from(pairs, (pair) => {
    const byte = BYTE_OF.get(pair);
    if (byte === undefined) throw new Error("Invalid bytewords");
    return byte;
  });
  if (text.length % 2 || bytes.length < 5) throw new Error("Invalid bytewords");
  const body = bytes.slice(0, -4);
  if (crc32(body) !== new DataView(bytes.buffer).getUint32(bytes.length - 4)) {
    throw new Error("Invalid bytewords checksum");
  }
  return body;
}

// Just the CBOR the UR envelope, crypto-psbt and the descriptor types use,
// with every length and integer fitting 32 bits.
// https://www.rfc-editor.org/rfc/rfc8949#section-3
const UINT = 0;
const BYTES = 2;
const TEXT = 3;
const ARRAY = 4;
const MAP = 5;
const TAG = 6;

class Tagged {
  constructor(
    readonly tag: number,
    readonly value: Cbor,
  ) {}
}

type Cbor = number | boolean | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | Tagged;

function cborHead(major: number, n: number): number[] {
  const m = major << 5;
  if (n < 24) return [m | n];
  if (n < 0x100) return [m | 24, n];
  if (n < 0x10000) return [m | 25, n >> 8, n & 0xff];
  return [m | 26, ...uint32Bytes(n)];
}

const cborBytes = (data: Uint8Array) =>
  Uint8Array.from([...cborHead(BYTES, data.length), ...data]);

class CborReader {
  private at = 0;
  constructor(private readonly data: Uint8Array) {}

  head(major: number): number {
    const first = this.data[this.at++];
    if (first === undefined || first >> 5 !== major) {
      throw new Error("Unexpected CBOR");
    }
    const info = first & 0x1f;
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4 }[info];
    if (!size || this.at + size > this.data.length) {
      throw new Error("Unexpected CBOR");
    }
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + this.data[this.at++]!;
    return n;
  }

  private take(length: number): Uint8Array {
    if (this.at + length > this.data.length) throw new Error("Unexpected CBOR");
    return this.data.slice(this.at, (this.at += length));
  }

  bytes(): Uint8Array {
    return this.take(this.head(BYTES));
  }

  item(): Cbor {
    const first = this.data[this.at];
    // CBOR's false and true.
    if (first === 0xf4 || first === 0xf5) return this.data[this.at++] === 0xf5;
    const major = (first ?? 0) >> 5;
    const n = this.head(major);
    if (major === UINT) return n;
    if (major === BYTES) return this.take(n);
    if (major === TEXT) return new TextDecoder("utf-8", { fatal: true }).decode(this.take(n));
    if (major === ARRAY) return Array.from({ length: n }, () => this.item());
    if (major === MAP) return new Map(Array.from({ length: n }, () => [this.item(), this.item()]));
    if (major === TAG) return new Tagged(n, this.item());
    throw new Error("Unexpected CBOR");
  }

  end() {
    if (this.at !== this.data.length) throw new Error("Unexpected CBOR");
  }
}

export function partCbor(part: FountainPart): Uint8Array {
  return Uint8Array.from([
    ...cborHead(ARRAY, 5),
    ...cborHead(UINT, part.seqNum),
    ...cborHead(UINT, part.seqLen),
    ...cborHead(UINT, part.messageLen),
    ...cborHead(UINT, part.checksum),
    ...cborBytes(part.data),
  ]);
}

function partFromCbor(cbor: Uint8Array): FountainPart {
  const reader = new CborReader(cbor);
  if (reader.head(ARRAY) !== 5) throw new Error("Unexpected CBOR");
  const part = {
    seqNum: reader.head(UINT),
    seqLen: reader.head(UINT),
    messageLen: reader.head(UINT),
    checksum: reader.head(UINT),
    data: reader.bytes(),
  };
  reader.end();
  return part;
}

export type Ur = { type: string; cbor: Uint8Array };

export class UrEncoder {
  private readonly fountain: FountainEncoder;

  /**
   * `maxFragmentLength` is the most CBOR bytes per part, which sets the QR
   * density. Parts are lowercase; upper-case them for a denser QR code.
   */
  constructor(
    private readonly ur: Ur,
    maxFragmentLength: number,
    firstSeqNum = 0,
    minFragmentLength = 10,
  ) {
    this.fountain = new FountainEncoder(
      ur.cbor,
      maxFragmentLength,
      firstSeqNum,
      minFragmentLength,
    );
  }

  /** How many parts carry the message once each. */
  get seqLen(): number {
    return this.fountain.seqLen;
  }

  /** Endless: the pure parts first, then fountain parts. */
  nextPart(): string {
    const part = this.fountain.nextPart();
    if (this.seqLen === 1) return `ur:${this.ur.type}/${bytewordsEncode(this.ur.cbor)}`;
    return `ur:${this.ur.type}/${part.seqNum}-${part.seqLen}/${bytewordsEncode(partCbor(part))}`;
  }
}

export class UrDecoder {
  result: Ur | null = null;
  private type: string | null = null;
  private readonly fountain = new FountainDecoder();

  /** `types` limits which UR types it accepts, so a stray QR cannot take over. */
  constructor(private readonly types?: string[]) {}

  /**
   * Feeds one scanned QR's text, in any order and with repeats. False when it
   * was ignored: not a UR, the wrong type, another message's part, or done.
   */
  receive(text: string): boolean {
    if (this.result || this.error) return false;
    const lower = text.trim().toLowerCase();
    if (!lower.startsWith("ur:")) return false;
    const [type = "", ...path] = lower.slice(3).split("/").filter(Boolean);
    if (
      !/^[a-z0-9-]+$/.test(type) ||
      (this.types && !this.types.includes(type)) ||
      (this.type && type !== this.type)
    ) {
      return false;
    }
    try {
      if (path.length === 1) {
        this.result = { type, cbor: bytewordsDecode(path[0]!) };
        return true;
      }
      const seq = /^(\d+)-(\d+)$/.exec(path[0] ?? "");
      if (path.length !== 2 || !seq) return false;
      const part = partFromCbor(bytewordsDecode(path[1]!));
      if (
        part.seqNum < 1 ||
        part.seqLen < 1 ||
        part.seqNum !== Number(seq[1]) ||
        part.seqLen !== Number(seq[2]) ||
        !this.fountain.receive(part)
      ) {
        return false;
      }
      this.type = type;
      if (this.fountain.result) this.result = { type, cbor: this.fountain.result };
      return true;
    } catch {
      return false;
    }
  }

  get error(): Error | null {
    return this.fountain.error;
  }

  /** Which of the message's parts are in, by index from 0. */
  get parts(): number[] {
    return this.result && this.fountain.progress.expected === 0 ? [0] : this.fountain.parts;
  }

  get progress(): Progress {
    return this.result && this.fountain.progress.expected === 0
      ? { captured: 1, expected: 1, fraction: 1 }
      : this.fountain.progress;
  }
}

// BCR-2020-006 renamed the type to `psbt`, but signers in the field still
// expect the old name, so it is the one written.
const PSBT_TYPES = ["crypto-psbt", "psbt"];

export const psbtUrEncoder = (psbt: Uint8Array, maxFragmentLength: number) =>
  new UrEncoder({ type: "crypto-psbt", cbor: cborBytes(psbt) }, maxFragmentLength);

export const psbtUrDecoder = () => new UrDecoder(PSBT_TYPES);

/** The PSBT inside a decoded `ur:crypto-psbt` or `ur:psbt`. */
export function psbtFromUr(ur: Ur): Uint8Array {
  if (!PSBT_TYPES.includes(ur.type)) {
    throw new Error(`This is a ${ur.type}, not a PSBT`);
  }
  const reader = new CborReader(ur.cbor);
  const psbt = reader.bytes();
  reader.end();
  return psbt;
}

// The UR types, and the CBOR tags inside them, from BCR-2020-010 and -015 and
// their successors BCR-2023-010 and -019, with keys from BCR-2020-007:
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-010-output-desc.md
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-015-account.md
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2023-010-output-descriptor.md
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2023-019-account-descriptor.md
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-007-hdkey.md
const DESCRIPTOR_TYPES = ["crypto-output", "output-descriptor", "crypto-account", "account-descriptor"];
const SCRIPTS = new Map([
  [400, "sh"],
  [401, "wsh"],
  [402, "pk"],
  [403, "pkh"],
  [404, "wpkh"],
  [405, "combo"],
  [409, "tr"],
  [410, "cosigner"],
]);
const MULTI = new Map([
  [406, "multi"],
  [407, "sortedmulti"],
]);
const OUTPUT = [308, 40308];
const ACCOUNT = [311, 40311];
const HDKEY = [303, 40303];
const ECKEY = [306, 40306];
const KEYPATH = [304, 40304];
const COININFO = [305, 40305];

export const descriptorUrDecoder = () => new UrDecoder(DESCRIPTOR_TYPES);

const strip = (item: Cbor, tags: number[]) => (item instanceof Tagged && tags.includes(item.tag) ? item.value : item);

function field(map: Cbor | undefined, key: number): Cbor | undefined {
  if (!(map instanceof Map)) throw new Error("Unexpected CBOR");
  return map.get(key);
}

const step = (index: Cbor | undefined, hardened: Cbor | undefined) => `${index}${hardened === true ? "'" : ""}`;

function keypath(item: Cbor | undefined) {
  if (item === undefined) return null;
  const path = strip(item, KEYPATH);
  const components = field(path, 1);
  if (!Array.isArray(components)) throw new Error("Unexpected CBOR");
  const steps: string[] = [];
  for (let i = 0; i < components.length; i++) {
    const c = components[i]!;
    if (Array.isArray(c) && c.length === 4) steps.push(`<${step(c[0], c[1])};${step(c[2], c[3])}>`);
    else if (Array.isArray(c) && c.length === 0) steps.push(step("*", components[++i]));
    else if (typeof c === "number") steps.push(step(c, components[++i]));
    else throw new Error("This key path holds a range of children, which this wallet does not read");
  }
  return { steps, fingerprint: field(path, 2) as number | undefined, depth: field(path, 3) as number | undefined };
}

function keyText(item: Cbor | undefined, master: number | undefined): string {
  if (!(item instanceof Tagged)) throw new Error("Unexpected CBOR");
  if (field(item.value, 1) === true || field(item.value, 2) === true) {
    throw new Error("This holds a private key. Export the public key instead");
  }
  const data = field(item.value, 3);
  if (!(data instanceof Uint8Array)) throw new Error("Unexpected CBOR");
  if (ECKEY.includes(item.tag)) return hex.encode(data);
  if (!HDKEY.includes(item.tag)) throw new Error("This descriptor holds a kind of key this wallet does not read");

  const origin = keypath(field(item.value, 6));
  const children = keypath(field(item.value, 7));
  const coin = field(item.value, 5);
  const testnet = coin !== undefined && field(strip(coin, COININFO), 2) === 1;
  const steps = origin?.steps ?? [];
  const last = steps.at(-1);
  const fingerprint = origin?.fingerprint ?? master;
  const key = new HDKey({
    versions: BIP32_VERSIONS[testnet ? "signet" : "mainnet"],
    depth: origin?.depth ?? steps.length,
    index: last ? parseInt(last) + (last.endsWith("'") ? HARDENED : 0) : 0,
    parentFingerprint: (field(item.value, 8) as number | undefined) ?? (steps.length === 1 ? fingerprint : 0),
    chainCode: field(item.value, 4) as Uint8Array | undefined,
    publicKey: data,
  }).publicExtendedKey;
  const from = fingerprint === undefined ? "" : `[${[fingerprint.toString(16).padStart(8, "0"), ...steps].join("/")}]`;
  return `${from}${key}${children ? children.steps.map((s) => `/${s}`).join("") : ""}`;
}

function outputText(item: Cbor, master: number | undefined): string {
  const body = strip(item, OUTPUT);
  if (body instanceof Map) {
    const source = body.get(1);
    const keys = body.get(2) ?? [];
    if (typeof source !== "string" || !Array.isArray(keys)) throw new Error("Unexpected CBOR");
    return source.replace(/@(\d+)/g, (_, n) => keyText(keys[Number(n)], master));
  }
  const multi = body instanceof Tagged && MULTI.get(body.tag);
  if (multi) {
    const keys = field((body as Tagged).value, 2);
    if (!Array.isArray(keys)) throw new Error("Unexpected CBOR");
    return `${multi}(${field((body as Tagged).value, 1)},${keys.map((k) => keyText(k, master)).join(",")})`;
  }
  const script = body instanceof Tagged && SCRIPTS.get(body.tag);
  return script ? `${script}(${outputText((body as Tagged).value, master)})` : keyText(body, master);
}

/**
 * The descriptors in a decoded output or account UR, as text. An account
 * holds one for each script type its signer offers.
 */
export function descriptorsFromUr(ur: Ur): string[] {
  const reader = new CborReader(ur.cbor);
  const item = reader.item();
  reader.end();
  if (!ur.type.includes("account")) return [outputText(item, undefined)];
  const account = strip(item, ACCOUNT);
  const outputs = field(account, 2);
  if (!Array.isArray(outputs)) throw new Error("Unexpected CBOR");
  return outputs.map((output) => outputText(output, field(account, 1) as number | undefined));
}
