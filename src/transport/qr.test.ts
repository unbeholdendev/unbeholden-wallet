import { describe, expect, it } from "vitest";
import { Xoshiro256 } from "./fountain";
import { qrPath, readQr } from "./qr";
import { UrEncoder } from "./ur";

/** Paints the path's dark modules as a camera frame would see them. */
function render(text: string, scale: number) {
  const { size, d } = qrPath(text);
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1H\d+z/g)) {
    for (let px = Number(x) * scale; px < (Number(x) + Number(w)) * scale; px++) {
      for (let py = Number(y) * scale; py < (Number(y) + 1) * scale; py++) {
        data.fill(0, (py * width + px) * 4, (py * width + px) * 4 + 3);
      }
    }
  }
  return { size, image: { width, height: width, data } };
}

function urPart(fragmentLength: number): string {
  const rng = new Xoshiro256("qr");
  const message = Uint8Array.from({ length: 4000 }, () => rng.nextInt(0, 255));
  const cbor = Uint8Array.from([0x59, message.length >> 8, message.length & 0xff, ...message]);
  return new UrEncoder({ type: "crypto-psbt", cbor }, fragmentLength).nextPart().toUpperCase();
}

describe("QR", () => {
  it.each([
    ["a short text", "bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", 4],
    ["a sparse UR part", urPart(50), 4],
    ["a typical UR part", urPart(250), 3],
    ["a dense UR part", urPart(600), 3],
    ["a very dense UR part", urPart(1200), 3],
  ])("reads back %s", (_, text, scale) => {
    const { image } = render(text, scale);
    expect(readQr(image)).toBe(text);
  });

  it("grows with the text", () => {
    expect(render(urPart(1200), 1).size).toBeGreaterThan(render(urPart(250), 1).size);
  });

  it("reads nothing from a blank frame", () => {
    const data = new Uint8ClampedArray(200 * 200 * 4).fill(255);
    expect(readQr({ width: 200, height: 200, data })).toBeNull();
  });
});
