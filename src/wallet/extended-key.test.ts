import { describe, expect, it } from "vitest";
import { normaliseExtendedKey } from "./extended-key";
import {
  asPrivate,
  asVersion,
  BIP84_ZPUB,
  BIP86_XPUB,
  VERSION,
} from "./vectors";

describe("normaliseExtendedKey", () => {
  it("reads the script type from a zpub and rewrites it as an xpub", () => {
    const result = normaliseExtendedKey(BIP84_ZPUB, "mainnet");
    expect(result.scriptType).toBe("wpkh");
    expect(result.key).toBe(asVersion(BIP84_ZPUB, VERSION.xpub));
  });

  it("reads the script type from a vpub on signet and regtest", () => {
    const vpub = asVersion(BIP84_ZPUB, VERSION.vpub);
    const tpub = asVersion(BIP84_ZPUB, VERSION.tpub);
    for (const network of ["signet", "regtest"] as const) {
      const result = normaliseExtendedKey(vpub, network);
      expect(result.scriptType).toBe("wpkh");
      expect(result.key).toBe(tpub);
    }
  });

  it("leaves an xpub alone but reports no script type", () => {
    const result = normaliseExtendedKey(BIP86_XPUB, "mainnet");
    expect(result.scriptType).toBe(null);
    expect(result.key).toBe(BIP86_XPUB);
  });

  it("leaves a tpub alone on signet and regtest", () => {
    const tpub = asVersion(BIP86_XPUB, VERSION.tpub);
    expect(normaliseExtendedKey(tpub, "signet").key).toBe(tpub);
    expect(normaliseExtendedKey(tpub, "regtest").key).toBe(tpub);
  });

  it("rejects a mainnet key on a test network and the reverse", () => {
    expect(() => normaliseExtendedKey(BIP84_ZPUB, "regtest")).toThrow(
      /mainnet key/i,
    );
    expect(() =>
      normaliseExtendedKey(asVersion(BIP84_ZPUB, VERSION.vpub), "mainnet"),
    ).toThrow(/test network key/i);
  });

  it("rejects wrapped SegWit keys as an unsupported script type", () => {
    expect(() =>
      normaliseExtendedKey(asVersion(BIP84_ZPUB, VERSION.ypub), "mainnet"),
    ).toThrow(/wrapped segwit/i);
    expect(() =>
      normaliseExtendedKey(asVersion(BIP84_ZPUB, VERSION.upub), "signet"),
    ).toThrow(/wrapped segwit/i);
  });

  it("rejects multisig keys as an unsupported script type", () => {
    for (const version of [VERSION.Ypub, VERSION.Zpub]) {
      expect(() =>
        normaliseExtendedKey(asVersion(BIP84_ZPUB, version), "mainnet"),
      ).toThrow(/multisig/i);
    }
    for (const version of [VERSION.Upub, VERSION.Vpub]) {
      expect(() =>
        normaliseExtendedKey(asVersion(BIP84_ZPUB, version), "signet"),
      ).toThrow(/multisig/i);
    }
  });

  it("refuses a private key", () => {
    expect(() =>
      normaliseExtendedKey(
        asVersion(asPrivate(BIP84_ZPUB), VERSION.xprv),
        "mainnet",
      ),
    ).toThrow(/private key/i);
  });

  it("refuses private key bytes under any prefix, known or not", () => {
    expect(() => normaliseExtendedKey(asPrivate(BIP84_ZPUB), "mainnet")).toThrow(
      /private key/i,
    );
    expect(() =>
      normaliseExtendedKey(asVersion(asPrivate(BIP84_ZPUB), 0x0dec0ded), "mainnet"),
    ).toThrow(/private key/i);
  });

  it("rejects something that is not an extended key at all", () => {
    expect(() => normaliseExtendedKey("not a key", "mainnet")).toThrow(
      /extended public key/i,
    );
  });
});
