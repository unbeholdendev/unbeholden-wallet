import { describe, expect, it } from "vitest";
import { asVersion, BIP84_ZPUB, BIP86_XPUB, VERSION } from "../wallet/vectors";
import { canonical, interpret, keyNetwork, watchable } from "./key-input";

const BIP84_XPUB = asVersion(BIP84_ZPUB, VERSION.xpub);
const BIP84_VPUB = asVersion(BIP84_ZPUB, VERSION.vpub);

describe("keyNetwork", () => {
  it("reads mainnet from a mainnet prefix, bare or inside a descriptor", () => {
    expect(keyNetwork(BIP84_ZPUB, "testnet4")).toBe("mainnet");
    expect(keyNetwork(` wpkh([d34db33f/84h/0h/0h]${BIP84_XPUB}/<0;1>/*)`, "signet")).toBe("mainnet");
  });

  it("takes a test network from the server, and signet without one", () => {
    expect(keyNetwork(BIP84_VPUB, "testnet4")).toBe("testnet4");
    expect(keyNetwork(BIP84_VPUB, "mainnet")).toBe("signet");
    expect(keyNetwork(BIP84_VPUB, null)).toBe("signet");
  });
});

describe("interpret", () => {
  it("reads nothing from blank text", () => {
    expect(interpret("  \n", "mainnet", null)).toEqual({});
  });

  it("reads a zpub as wpkh without asking for a script type", () => {
    const reading = interpret(BIP84_ZPUB, "mainnet", null);
    expect(reading.needsType).toBe(false);
    expect(reading.descriptor).toMatch(/^wpkh\(/);
    expect(reading.descriptor).toBe(canonical({ descriptor: BIP84_ZPUB, network: "mainnet", scriptType: null }));
  });

  it("asks for a script type for an xpub, and uses the one chosen", () => {
    expect(interpret(BIP86_XPUB, "mainnet", null)).toEqual({ needsType: true });
    const reading = interpret(BIP86_XPUB, "mainnet", "tr");
    expect(reading.needsType).toBe(true);
    expect(reading.descriptor).toMatch(/^tr\(/);
  });

  it("gives the fingerprint of a single key's origin", () => {
    const reading = interpret(`wpkh([d34db33f/84h/0h/0h]${BIP84_XPUB}/<0;1>/*)`, "mainnet", null);
    expect(reading.fingerprint).toBe("d34db33f");
    expect(reading.multi).toBeUndefined();
  });

  it("gives a multisig's threshold and each key's fingerprint, null without an origin", () => {
    const text = `wsh(sortedmulti(2,[d34db33f/48h/0h/0h/2h]${BIP84_XPUB}/<0;1>/*,${BIP86_XPUB}/<0;1>/*))`;
    const reading = interpret(text, "mainnet", null);
    expect(reading.multi).toEqual({ threshold: 2, fingerprints: ["d34db33f", null] });
    expect(reading.fingerprint).toBeUndefined();
  });

  it("turns a parse failure into a sentence", () => {
    const { error } = interpret(`wpkh(${BIP84_XPUB}/0/*)`, "signet", null);
    expect(error).toMatch(/mainnet key.*\.$/i);
  });
});

describe("watchable", () => {
  it("keeps the script types this wallet can watch, in order", () => {
    const found = ["pkh(a)", "sh(wpkh(b))", "wpkh(c)", "tr(d)", "wsh(sortedmulti(2,e))", "wsh(multi(1,f))"];
    expect(watchable(found)).toEqual(["wpkh(c)", "tr(d)", "wsh(sortedmulti(2,e))", "wsh(multi(1,f))"]);
  });
});
