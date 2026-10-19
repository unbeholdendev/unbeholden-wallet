import { HDKey } from "@scure/bip32";
import { bech32, bech32m, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { sha256 } from "@scure/btc-signer/utils.js";
import { deriveAddress, derivePayment, derivePublicKeys } from "./derive";
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
    const internal = derivePublicKeys(descriptor, "mainnet", chain, index)[0]!;
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
    const derived = derivePublicKeys(descriptor, "mainnet", 0, 1000000000)[0]!;
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

// Bitcoin Core's descriptor tests: a sortedmulti over keys with different
// paths below them, the same in BIP383, and a multi over two multipath keys.
// https://github.com/bitcoin/bitcoin/blob/master/src/test/descriptor_tests.cpp
// https://github.com/bitcoin/bips/blob/master/bip-0383.mediawiki
const CORE_A = "xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL";
const CORE_B = "xpub68NZiKmJWnxxS6aaHmn81bvJeTESw724CRDs6HbuccFQN9Ku14VQrADWgqbhhTHBaohPX4CjNLf9fq9MYo6oDaPPLPxSb7gwQN3ih19Zm4Y";

describe("multisig vectors", () => {
  const witnessScript = (text: string, chain: number, index: number) => {
    const payment = derivePayment(parseDescriptor(text, "mainnet"), "mainnet", chain, index);
    expect(hex.encode(payment.script)).toBe(`0020${hex.encode(sha256(payment.witnessScript!))}`);
    return hex.encode(payment.witnessScript!);
  };

  it.each([
    [0, "5221025d5fc65ebb8d44a5274b53bac21ff8307fec2334a32df05553459f8b1f7fe1b62102fbd47cc8034098f0e6a94c6aeee8528abf0a2153a5d8e46d325b7284c046784652ae"],
    [1, "52210264fd4d1f5dea8ded94c61e9641309349b62f27fbffe807291f664e286bfbe6472103f4ece6dfccfa37b211eb3d0af4d0c61dba9ef698622dc17eecdf764beeb005a652ae"],
    [2, "5221022ccabda84c30bad578b13c89eb3b9544ce149787e5b538175b1d1ba259cbb83321024d902e1a2fc7a8755ab5b694c575fce742c48d9ff192e63df5193e4c7afe1f9c52ae"],
  ])("sorts sortedmulti's keys by BIP67 at index %i", (index, expected) => {
    expect(witnessScript(`wsh(sortedmulti(2,${CORE_A}/*,${CORE_B}/0/0/*))`, 0, index)).toBe(expected);
  });

  it.each([
    [0, 0, "522103095e95d8c50ae3f3fea93fa8e983f710489f60ff681a658c06eba64622c824b121020443e9e729b42628913f1a69b46b7d43ff87c46e86140e12ee420d7e2e8caf8c52ae"],
    [0, 1, "5221027512d6bd74e24eeb1ad752d5be800adc5886ded11c5293a9a701db83658b526a2102371e912dea5fefa56158908fe4c9f66bc925a8939b10f3821e8f8be797b9ca8252ae"],
    [0, 2, "522102cc9fd211dc0a1c8bb7a106ff831be0e253bc992f21d08fb8a6fd43fae51b9b892103e43eddc68afc9746c9d09ce0bf8067b4f2416287abbc422ed1ac300673b1104952ae"],
    [1, 0, "5221031c0517fff3d483f06ca769bd2326bf30aca1c4de278e676e6ef760c3301244c6210316e171ff4f82dc62ad3f0d84c97865034fc5041eaa508b48c1d7af77f301c8bd52ae"],
    [1, 1, "52210240f010ccff4202ade2ef87756f6b9af57bbf5ebcb0393b949e6e5d45d30bff36210229057a7e03510b8cb66727fab3f47a52a02ea94eae03e7c2e81b72a26781bfde52ae"],
    [1, 2, "5221034052522058a07b647bd08fa1a9eaedae0222eac76ddd122ff8096ec969398de721038cb8180dd4c956848bcf191e45aaf297146207559fb8737881156aadaf13704152ae"],
  ])("keeps multi's keys in order on chain %i at index %i", (chain, index, expected) => {
    expect(witnessScript(`wsh(multi(2,${CORE_A}/<1;2>/*,${CORE_B}/<3;4>/0/*))`, chain, index)).toBe(expected);
  });
});
