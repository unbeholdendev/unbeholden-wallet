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
      keys: [{ origin: null, key: BIP84_XPUB, path: [[0, 1], "*"] }],
    });
  });

  it("infers wpkh from a vpub on every test network", () => {
    for (const network of ["signet", "regtest"] as const) {
      const descriptor = descriptorFromExtendedKey(BIP84_VPUB, network);
      expect(descriptor.scriptType).toBe("wpkh");
      expect(descriptor.keys[0]!.key).toBe(BIP84_TPUB);
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

  it("takes the script type from a key origin's purpose", () => {
    const wpkh = descriptorFromExtendedKey(`[d34db33f/84'/0'/0']${BIP84_XPUB}`, "mainnet");
    expect(wpkh).toMatchObject({ scriptType: "wpkh", keys: [{ origin: { fingerprint: "d34db33f" }, path: [[0, 1], "*"] }] });
    expect(formatDescriptor(descriptorFromExtendedKey(`[D34DB33F/86h/0h/0h]${BIP86_XPUB}`, "mainnet"))).toMatch(
      /^tr\(\[d34db33f\/86h\/0h\/0h\]xpub\w+\/<0;1>\/\*\)#/,
    );
    expect(() => descriptorFromExtendedKey(`[d34db33f/44'/0'/0']${BIP84_XPUB}`, "mainnet")).toThrow(/wpkh \(84h\) or tr \(86h\)/);
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
  it("refuses a multipath step that is not two different chains", () => {
    for (const step of ["<0>", "<0;0>", "<0;1;2>"]) {
      expect(() => parseDescriptor(`wpkh(${BIP84_XPUB}/${step}/*)`, "mainnet")).toThrow(/two different choices/);
    }
  });

  it("reads key origin", () => {
    const descriptor = parseDescriptor(
      `wpkh([d34db33f/84h/0h/0h]${BIP84_XPUB}/0/*)`,
      "mainnet",
    );
    expect(descriptor.keys[0]!.origin).toEqual({
      fingerprint: "d34db33f",
      path: [0x80000054, 0x80000000, 0x80000000],
    });
    expect(descriptor.keys[0]!.path).toEqual([0, "*"]);
  });

  it("accepts an apostrophe for hardened steps", () => {
    expect(
      parseDescriptor(`tr([d34db33f/86'/0'/0']${BIP86_XPUB}/0/*)`, "mainnet")
        .keys[0]!.origin,
    ).toEqual({
      fingerprint: "d34db33f",
      path: [0x80000056, 0x80000000, 0x80000000],
    });
  });

  it("normalises a SLIP-132 key found inside a descriptor", () => {
    expect(parseDescriptor(`wpkh(${BIP84_ZPUB}/0/*)`, "mainnet").keys[0]!.key).toBe(
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

  it("reads a key with no path below it as its receive and change chains", () => {
    expect(parseDescriptor(`wpkh([d34db33f/84h/0h/0h]${BIP84_XPUB})`, "mainnet").keys[0]!.path).toEqual([[0, 1], "*"]);
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

describe("multisig descriptors", () => {
  const ZPUB = asVersion(BIP84_ZPUB, VERSION.Zpub);
  const A = `[d34db33f/48h/0h/0h/2h]${BIP84_XPUB}`;
  const B = `[f00dbabe/48h/0h/0h/2h]${ZPUB}`;
  const C = `[0badc0de/48h/0h/0h/2h]${BIP86_XPUB}`;

  it("reads k and the keys in order with their origins, and writes them back with a checksum", () => {
    const text = `wsh(sortedmulti(2,${A}/<0;1>/*,${B}/<0;1>/*,${C}/<0;1>/*))`;
    const descriptor = parseDescriptor(text, "mainnet");
    expect(descriptor.multi).toEqual({ threshold: 2, sorted: true });
    expect(descriptor.keys.map((k) => k.origin!.fingerprint)).toEqual(["d34db33f", "f00dbabe", "0badc0de"]);
    expect(descriptor.keys[1]!.key).toBe(BIP84_XPUB);
    const written = formatDescriptor(descriptor);
    expect(written.slice(0, -9)).toBe(text.replace(ZPUB, BIP84_XPUB));
    expect(parseDescriptor(written, "mainnet")).toEqual(descriptor);
    expect(formatDescriptor(parseDescriptor(`wsh(multi(1,${A},${C}))`, "mainnet"))).toMatch(/^wsh\(multi\(1,\S+\/<0;1>\/\*,\S+\/<0;1>\/\*\)\)#/);
  });

  it("refuses a threshold of 0 or above the number of keys", () => {
    expect(() => parseDescriptor(`wsh(multi(0,${A}/*,${C}/*))`, "mainnet")).toThrow(/from 1 to 2 signatures, not 0/);
    expect(() => parseDescriptor(`wsh(multi(3,${A}/*,${C}/*))`, "mainnet")).toThrow(/from 1 to 2 signatures, not 3/);
  });

  it("refuses a wrapped multisig, a bare one, and wsh around anything else", () => {
    expect(() => parseDescriptor(`sh(wsh(multi(1,${A}/*,${C}/*)))`, "mainnet")).toThrow(/wsh multisig/);
    expect(() => parseDescriptor(`multi(1,${A}/*,${C}/*)`, "mainnet")).toThrow(/wsh multisig/);
    expect(() => parseDescriptor(`wsh(pk(${A}/*))`, "mainnet")).toThrow(/multi\(\) or sortedmulti\(\)/);
  });

  it("refuses keys of which only some have a receive and change step", () => {
    expect(() => parseDescriptor(`wsh(multi(1,${A}/<0;1>/*,${C}/0/*))`, "mainnet")).toThrow(/every key/);
  });

  it("refuses one cosigner's key pasted on its own", () => {
    expect(() => descriptorFromExtendedKey(ZPUB, "mainnet")).toThrow(/whole descriptor/);
  });
});
