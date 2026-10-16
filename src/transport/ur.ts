import {
  crc32,
  FountainDecoder,
  FountainEncoder,
  uint32Bytes,
  type FountainPart,
  type Progress,
} from "./fountain";

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

// Just the CBOR the UR envelope and crypto-psbt use: unsigned integers, byte
// strings and one array, each with a length that fits 32 bits.
// https://www.rfc-editor.org/rfc/rfc8949#section-3
const UINT = 0;
const BYTES = 2;
const ARRAY = 4;

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

  bytes(): Uint8Array {
    const length = this.head(BYTES);
    if (this.at + length > this.data.length) throw new Error("Unexpected CBOR");
    return this.data.slice(this.at, (this.at += length));
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
