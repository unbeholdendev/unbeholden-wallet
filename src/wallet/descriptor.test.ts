import { describe, expect, it } from "vitest";
import {
  descriptorFromExtendedKey,
  formatDescriptor,
  parseDescriptor,
} from "./descriptor";
import { asVersion, BIP84_ZPUB, BIP86_XPUB, VERSION } from "./vectors";

const BIP84_XPUB = asVersion(BIP84_ZPUB, VERSION.xpub);
const BIP84_TPUB = asVersion(BIP84_ZPUB, VERSION.tpub);
const BIP84_VPUB = asVersion(BIP84_ZPUB, VERSION.vpub);

describe("descriptorFromExtendedKey", () => {
  it("infers wpkh from a zpub and covers both chains", () => {
    const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");
    expect(descriptor).toEqual({
      scriptType: "wpkh",
      origin: null,
      key: BIP84_XPUB,
      path: [[0, 1], "*"],
    });
  });

  it("infers wpkh from a vpub on every test network", () => {
    for (const network of ["signet", "regtest"] as const) {
      const descriptor = descriptorFromExtendedKey(BIP84_VPUB, network);
      expect(descriptor.scriptType).toBe("wpkh");
      expect(descriptor.key).toBe(BIP84_TPUB);
    }
  });

  it("needs an explicit script type for a bare xpub", () => {
    expect(() => descriptorFromExtendedKey(BIP86_XPUB, "mainnet")).toThrow(
      /script type/i,
    );
    expect(
      descriptorFromExtendedKey(BIP86_XPUB, "mainnet", "tr").scriptType,
    ).toBe("tr");
  });

  it("rejects a script type that contradicts the prefix", () => {
    expect(() =>
      descriptorFromExtendedKey(BIP84_ZPUB, "mainnet", "tr"),
    ).toThrow(/wpkh/i);
  });
});

describe("formatDescriptor", () => {
  it("writes a checksummed multipath descriptor", () => {
    const text = formatDescriptor(
      descriptorFromExtendedKey(BIP84_ZPUB, "mainnet"),
    );
    expect(text).toBe(`wpkh(${BIP84_XPUB}/<0;1>/*)#${text.slice(-8)}`);
    expect(parseDescriptor(text, "mainnet")).toEqual(
      descriptorFromExtendedKey(BIP84_ZPUB, "mainnet"),
    );
  });

  it("writes key origin with hardened steps", () => {
    const source = `wpkh([d34db33f/84h/0h/0h]${BIP84_XPUB}/<0;1>/*)`;
    const text = formatDescriptor(parseDescriptor(source, "mainnet"));
    expect(text.slice(0, -9)).toBe(source);
  });
});

describe("parseDescriptor", () => {
  it("reads key origin", () => {
    const descriptor = parseDescriptor(
      `wpkh([d34db33f/84h/0h/0h]${BIP84_XPUB}/0/*)`,
      "mainnet",
    );
    expect(descriptor.origin).toEqual({
      fingerprint: "d34db33f",
      path: [0x80000054, 0x80000000, 0x80000000],
    });
    expect(descriptor.path).toEqual([0, "*"]);
  });

  it("accepts an apostrophe for hardened steps", () => {
    expect(
      parseDescriptor(`tr([d34db33f/86'/0'/0']${BIP86_XPUB}/0/*)`, "mainnet")
        .origin,
    ).toEqual({
      fingerprint: "d34db33f",
      path: [0x80000056, 0x80000000, 0x80000000],
    });
  });

  it("normalises a SLIP-132 key found inside a descriptor", () => {
    expect(parseDescriptor(`wpkh(${BIP84_ZPUB}/0/*)`, "mainnet").key).toBe(
      BIP84_XPUB,
    );
  });

  it("verifies the checksum", () => {
    const text = formatDescriptor(
      descriptorFromExtendedKey(BIP84_ZPUB, "mainnet"),
    );
    expect(() => parseDescriptor(`${text.slice(0, -1)}q`, "mainnet")).toThrow(
      /checksum/i,
    );
  });

  it("rejects script types outside wpkh and tr", () => {
    expect(() => parseDescriptor(`pkh(${BIP84_XPUB}/0/*)`, "mainnet")).toThrow(
      /wpkh.*tr|tr.*wpkh/i,
    );
    expect(() =>
      parseDescriptor(`sh(wpkh(${BIP84_XPUB}/0/*))`, "mainnet"),
    ).toThrow(/wpkh.*tr|tr.*wpkh/i);
  });

  it("rejects a taproot script tree", () => {
    expect(() =>
      parseDescriptor(`tr(${BIP86_XPUB}/0/*,pk(${BIP86_XPUB}))`, "mainnet"),
    ).toThrow(/script tree|script path/i);
  });

  it("rejects a descriptor with no wildcard", () => {
    expect(() => parseDescriptor(`wpkh(${BIP84_XPUB}/0/0)`, "mainnet")).toThrow(
      /\*/,
    );
  });

  it("rejects a wildcard that is not the last step", () => {
    expect(() => parseDescriptor(`wpkh(${BIP84_XPUB}/*/0)`, "mainnet")).toThrow(
      /\*/,
    );
  });

  it("rejects hardened derivation after the key", () => {
    expect(() =>
      parseDescriptor(`wpkh(${BIP84_XPUB}/0h/*)`, "mainnet"),
    ).toThrow(/hardened/i);
    expect(() => parseDescriptor(`wpkh(${BIP84_XPUB}/*h)`, "mainnet")).toThrow(
      /hardened/i,
    );
  });

  it("rejects a malformed fingerprint", () => {
    expect(() =>
      parseDescriptor(`wpkh([d34db33/84h]${BIP84_XPUB}/0/*)`, "mainnet"),
    ).toThrow(/fingerprint/i);
  });

  it("rejects a key on the wrong network", () => {
    expect(() => parseDescriptor(`wpkh(${BIP84_XPUB}/0/*)`, "signet")).toThrow(
      /mainnet key/i,
    );
  });

  it("rejects unbalanced brackets", () => {
    expect(() => parseDescriptor(`wpkh(${BIP84_XPUB}/0/*`, "mainnet")).toThrow();
    expect(() =>
      parseDescriptor(`wpkh([d34db33f/84h${BIP84_XPUB}/0/*)`, "mainnet"),
    ).toThrow();
  });
});
