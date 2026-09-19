import { HDKey } from "@scure/bip32";
import { bech32, bech32m, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { deriveAddress, derivePublicKey } from "./derive";
import { descriptorFromExtendedKey, parseDescriptor } from "./descriptor";
import { asVersion, BIP84_ZPUB, BIP86_XPUB, VERSION } from "./vectors";

function coderFor(address: string) {
  return address.startsWith("bc1p") || address.startsWith("tb1p") ||
    address.startsWith("bcrt1p")
    ? bech32m
    : bech32;
}

/** The key an address commits to, so a vector can be the BIP's own hex. */
function witnessProgram(address: string): string {
  const coder = coderFor(address);
  const { words } = coder.decode(address as `bc1${string}`, 128);
  return hex.encode(coder.fromWords(words.slice(1)));
}

// BIP84 test vectors:
// https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
describe("BIP84 vectors", () => {
  const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");

  it.each([
    [0, 0, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"],
    [0, 1, "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"],
    [1, 0, "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"],
  ])("derives chain %i index %i", (chain, index, address) => {
    expect(deriveAddress(descriptor, "mainnet", chain, index)).toBe(address);
  });
});

// BIP86 publishes an internal key and an output key per address rather than a
// bech32m string, so these assert the BIP's own hex.
// https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki
describe("BIP86 vectors", () => {
  const descriptor = descriptorFromExtendedKey(BIP86_XPUB, "mainnet", "tr");

  it.each([
    [0, 0, "cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115"],
    [0, 1, "83dfe85a3151d2517290da461fe2815591ef69f2b18a2ce63f01697a8b313145"],
    [1, 0, "399f1b2f4393f29a18c937859c5dd8a77350103157eb880f02e8c08214277cef"],
  ])("derives the internal key for chain %i index %i", (chain, index, key) => {
    const internal = derivePublicKey(descriptor, "mainnet", chain, index);
    expect(hex.encode(internal.slice(1))).toBe(key);
  });

  it.each([
    [0, 0, "a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c"],
    [0, 1, "a82f29944d65b86ae6b5e5cc75e294ead6c59391a1edc5e016e3498c67fc7bbb"],
    [1, 0, "882d74e5d0572d5a816cef0041a96b6c1de832f6f9676d9605c44d5e9a97d3dc"],
  ])("pays to the output key for chain %i index %i", (chain, index, key) => {
    const address = deriveAddress(descriptor, "mainnet", chain, index);
    expect(witnessProgram(address)).toBe(key);
  });
});

// A network changes the prefix, never the key. So each of these pins the
// published mainnet program and the network's own prefix.
describe("networks", () => {
  const HRP = { signet: "tb", regtest: "bcrt" };

  it.each(["signet", "regtest"] as const)("derives wpkh under %s", (network) => {
    const descriptor = descriptorFromExtendedKey(
      asVersion(BIP84_ZPUB, VERSION.vpub),
      network,
    );
    const address = deriveAddress(descriptor, network, 0, 0);
    expect(address.startsWith(`${HRP[network]}1q`)).toBe(true);
    expect(witnessProgram(address)).toBe(
      witnessProgram("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
    );
  });

  it.each(["signet", "regtest"] as const)("derives tr under %s", (network) => {
    const descriptor = descriptorFromExtendedKey(
      asVersion(BIP86_XPUB, VERSION.tpub),
      network,
      "tr",
    );
    const address = deriveAddress(descriptor, network, 0, 0);
    expect(address.startsWith(`${HRP[network]}1p`)).toBe(true);
    expect(witnessProgram(address)).toBe(
      "a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c",
    );
  });
});

// BIP32 test vectors, vector 1:
// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
describe("BIP32 vectors", () => {
  it("walks fixed path steps to the published child key", () => {
    // Chain m/0H/1/2H/2 and its child m/0H/1/2H/2/1000000000.
    const parent =
      "xpub6FHa3pjLCk84BayeJxFW2SP4XRrFd1JYnxeLeU8EqN3vDfZmbqBqaGJAyiLjTAwm6ZLRQUMv1ZACTj37sR62cfN7fe5JnJ7dh8zL4fiyLHV";
    const child =
      "xpub6H1LXWLaKsWFhvm6RVpEL9P4KfRZSW7abD2ttkWP3SSQvnyA8FSVqNTEcYFgJS2UaFcxupHiYkro49S8yGasTvXEYBVPamhGW6cFJodrTHy";
    const descriptor = parseDescriptor(`wpkh(${parent}/*)`, "mainnet");
    const derived = derivePublicKey(descriptor, "mainnet", 0, 1000000000);
    expect(hex.encode(derived)).toBe(
      hex.encode(HDKey.fromExtendedKey(child).publicKey!),
    );
  });
});

describe("chain selection", () => {
  it("refuses a chain a single-path descriptor does not have", () => {
    const descriptor = parseDescriptor(
      `wpkh(${asVersion(BIP84_ZPUB, VERSION.xpub)}/0/*)`,
      "mainnet",
    );
    expect(deriveAddress(descriptor, "mainnet", 0, 0)).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(() => deriveAddress(descriptor, "mainnet", 1, 0)).toThrow(
      /one chain|single/i,
    );
  });

  it("refuses a chain outside a multipath descriptor's choices", () => {
    const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");
    expect(() => deriveAddress(descriptor, "mainnet", 2, 0)).toThrow(/chain/i);
  });

  it("refuses a key whose network does not match the one asked for", () => {
    const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");
    expect(() => deriveAddress(descriptor, "signet", 0, 0)).toThrow(
      /version mismatch/i,
    );
  });
});
