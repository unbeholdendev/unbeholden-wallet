import { base32nopad, hex } from "@scure/base";

// The header, encodings and file types:
// https://github.com/coinkite/BBQr/blob/master/BBQr.md
const HEADER = /^B\$([H2Z])([A-Z])([0-9A-Z]{2})([0-9A-Z]{2})/;
const MAX_PARTS = 36 * 36 - 1;
const base36 = (n: number) => n.toString(36).toUpperCase().padStart(2, "0");

/**
 * Splits data into Base32 BBQr parts of at most `maxBytes` each, all but the
 * last the same size. `maxBytes` must be a multiple of 5.
 */
export function bbqrParts(data: Uint8Array, type: "P" | "T", maxBytes: number): string[] {
  const count = Math.ceil(data.length / maxBytes);
  const size = Math.ceil(data.length / count / 5) * 5;
  const total = Math.ceil(data.length / size);
  if (total > MAX_PARTS) throw new Error("Too large for BBQr");
  return Array.from(
    { length: total },
    (_, i) => `B$2${type}${base36(total)}${base36(i)}${base32nopad.encode(data.subarray(i * size, (i + 1) * size))}`,
  );
}

export class BbqrDecoder {
  private header = "";
  private readonly received = new Map<number, string>();
  expected = 0;

  /** Feeds one scanned QR's text, in any order and with repeats. False when it was ignored. */
  receive(text: string): boolean {
    const trimmed = text.trim();
    const m = HEADER.exec(trimmed);
    if (!m || (this.header && trimmed.slice(0, 6) !== this.header)) return false;
    const total = parseInt(m[3]!, 36);
    const index = parseInt(m[4]!, 36);
    if (index >= total || this.received.has(index)) return false;
    this.header = trimmed.slice(0, 6);
    this.expected = total;
    this.received.set(index, trimmed.slice(8));
    return true;
  }

  get type(): string {
    return this.header[3] ?? "";
  }

  /** Which parts are in, by index from 0. */
  get parts(): number[] {
    return [...this.received.keys()];
  }

  get done(): boolean {
    return this.expected > 0 && this.received.size === this.expected;
  }

  /** The joined data once every part is in. */
  async result(): Promise<Uint8Array> {
    const text = Array.from({ length: this.expected }, (_, i) => this.received.get(i)).join("");
    const encoding = this.header[2];
    if (encoding === "H") return hex.decode(text.toLowerCase());
    const bytes = base32nopad.decode(text);
    if (encoding === "2") return bytes;
    // Mode Z is raw deflate with a 1 KiB window, which any inflater reads.
    const stream = new Response(bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}
