import { describe, expect, it } from "vitest";
import { descriptorChecksum, stripChecksum } from "./checksum";

// Every string here is quoted from BIP380's own test vectors:
// https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
describe("descriptorChecksum", () => {
  it("matches the reference vector", () => {
    expect(descriptorChecksum("raw(deadbeef)")).toBe("89f8spxm");
  });

  it("rejects a character outside the input charset", () => {
    expect(() => descriptorChecksum("raw(Ü)")).toThrow(/character/i);
  });
});

describe("stripChecksum", () => {
  it("accepts and strips the reference checksum", () => {
    expect(stripChecksum("raw(deadbeef)#89f8spxm")).toBe("raw(deadbeef)");
  });

  it.each([
    ["raw(deadbeef)#", "missing checksum"],
    ["raw(deadbeef)#89f8spxmx", "nine characters"],
    ["raw(deadbeef)#89f8spx", "seven characters"],
    ["raw(deedbeef)#89f8spxm", "payload error"],
    ["raw(deedbeef)##9f8spxm", "checksum error"],
    ["raw(Ü)#00000000", "invalid character"],
  ])("rejects %s (%s)", (text) => {
    expect(() => stripChecksum(text)).toThrow();
  });

  // BIP380 lists a bare "raw(deadbeef)" as invalid, but that is about where a
  // checksum is required. Users paste descriptors without one, so this accepts
  // it and formatDescriptor always writes one back.
  it("accepts a descriptor with no checksum at all", () => {
    expect(stripChecksum("raw(deadbeef)")).toBe("raw(deadbeef)");
  });
});
