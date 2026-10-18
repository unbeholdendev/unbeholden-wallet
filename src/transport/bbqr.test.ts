import { base64 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { VALID } from "../wallet/bip174-vectors";
import { bbqrParts, BbqrDecoder } from "./bbqr";
// A real Coldcard scan, Z encoded, as published with the spec:
// https://github.com/coinkite/BBQr/blob/master/test_data/real-scan.txt
import realScan from "./bbqr-real-scan.txt?raw";

async function join(parts: string[]) {
  const decoder = new BbqrDecoder();
  for (const part of parts) decoder.receive(part);
  expect(decoder.done).toBe(true);
  return { type: decoder.type, data: await decoder.result() };
}

describe("BBQr", () => {
  it("joins the spec's real Zlib scan, repeats and all", async () => {
    const { type, data } = await join(realScan.split("\n").filter(Boolean));
    const text = new TextDecoder().decode(data);
    expect(type).toBe("U");
    expect(text).toContain("Zlib compressed");
    expect(text).toContain("PSBT");
  });

  // "foobar" in hex and in Base32, from the RFC 4648 test vectors:
  // https://datatracker.ietf.org/doc/html/rfc4648#section-10
  it.each(["B$HT0100666F6F626172", "B$2T0100MZXW6YTBOI"])("reads %s", async (qr) => {
    expect(await join([qr])).toEqual({ type: "T", data: Uint8Array.from(new TextEncoder().encode("foobar")) });
  });

  it("splits a PSBT into equal parts that join back in any order", async () => {
    const psbt = base64.decode(VALID.map(([, b64]) => b64).sort((a, b) => b.length - a.length)[0]!);
    const parts = bbqrParts(psbt, "P", 80);
    expect(parts.length).toBeGreaterThan(2);
    expect(new Set(parts.slice(0, -1).map((p) => p.length)).size).toBe(1);
    expect(parts.every((p) => /^B\$2P[0-9A-Z]{4}[A-Z2-7]+$/.test(p))).toBe(true);

    const decoder = new BbqrDecoder();
    for (const part of [...parts].reverse()) {
      expect(decoder.done).toBe(false);
      expect(decoder.receive(part)).toBe(true);
      expect(decoder.receive(part)).toBe(false);
    }
    expect(decoder.parts.length).toBe(parts.length);
    expect(await decoder.result()).toEqual(psbt);
  });

  it("ignores a part from another series", () => {
    const decoder = new BbqrDecoder();
    decoder.receive("B$2T0200MZXW6");
    expect(decoder.receive("B$2P0201MZXW6")).toBe(false);
    expect(decoder.receive("ur:crypto-psbt/abc")).toBe(false);
  });
});
