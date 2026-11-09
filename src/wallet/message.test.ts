import { hex, base64 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { armour, messageProblem, readSignature, signFile, signRequest, verifyMessage } from "./message";

const b64 = (h: string) => base64.encode(hex.decode(h));

describe("verifyMessage, legacy signatures", () => {
  // https://github.com/bitcoin/bitcoin/blob/master/test/functional/rpc_signmessagewithprivkey.py
  it("accepts Bitcoin Core's signature for its P2PKH address", () => {
    const signature = "INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=";
    expect(verifyMessage("mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB", "This is just a test message", signature, "testnet4")).toEqual({ valid: true, format: "legacy" });
    expect(verifyMessage("mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB", "This is just a test message.", signature, "testnet4").valid).toBe(false);
  });

  // https://github.com/spesmilo/electrum/blob/master/tests/test_bitcoin.py, test_signmessage_legacy_address and test_signmessage_low_s
  it("accepts compressed, uncompressed and high-S signatures for P2PKH", () => {
    const chancellor = "Chancellor on brink of second bailout for banks";
    expect(verifyMessage("15hETetDmcXm1mM4sEf7U2KXC9hDHFMSzz", chancellor, "Hzsu0U/THAsPz/MSuXGBKSULz2dTfmrg1NsAhFp+wH5aKfmX4Db7ExLGa7FGn0m6Mf43KsbEOWpvUUUBTM3Uusw=", "mainnet").valid).toBe(true);
    expect(verifyMessage("15hETetDmcXm1mM4sEf7U2KXC9hDHFMSzz", chancellor, "IDsu0U/THAsPz/MSuXGBKSULz2dTfmrg1NsAhFp+wH5a1gZoH8kE7O05lE65YLZFzLx3sh/rDzXMbo1dQAJhhnU=", "mainnet").valid).toBe(true);
    expect(verifyMessage("1GPHVTY8UD9my6jyP4tb2TYJwUbDetyNC6", "Electrum", "HBQdYfv7kOrxmRewLJnG7sV6KlU71O04hUnE4tai97p7Pg+D+yKaWXsdGgHTrKw90caQMo/D6b//qX50ge9P9iI=", "mainnet").valid).toBe(true);
    expect(verifyMessage("15hETetDmcXm1mM4sEf7U2KXC9hDHFMSzz", chancellor, "HBQdYfv7kOrxmRewLJnG7sV6KlU71O04hUnE4tai97p7Pg+D+yKaWXsdGgHTrKw90caQMo/D6b//qX50ge9P9iI=", "mainnet").valid).toBe(false);
  });

  // https://github.com/spesmilo/electrum/blob/master/tests/test_bitcoin.py, test_signmessage_segwit_witness_v0_address
  it("accepts a P2PKH-style header on segwit addresses, as SeedSigner and most signers write it", () => {
    const signature = "HyFaND+87TtVbRhkTfT3mPNBCQcJ32XXtNZGW8sFldJsNpOPCegEmdcCf5Thy18hdMH88GLxZLkOby/EwVUuSeA=";
    expect(verifyMessage("bc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0", "Electrum", signature, "mainnet").valid).toBe(true);
    expect(verifyMessage("3DYoBqQ5N6dADzyQjy9FT1Ls4amiYVaqTG", "Electrum", signature, "mainnet").valid).toBe(true);
    expect(verifyMessage("bc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0", "heyheyhey", signature, "mainnet").valid).toBe(false);
  });

  // https://github.com/spesmilo/electrum/blob/master/tests/test_bitcoin.py, test_signmessage_segwit_witness_v0_address_test_we_also_accept_sigs_from_trezor
  it("accepts BIP137 headers independently of their address-type bits", () => {
    const message = "This is an example of a signed message.";
    const wrapped = "744de4516fac5c140808015664516a32fead94de89775cec7e24dbc24fe133075ac09301c4cc8e197bea4b6481661d5b8e9bf19d8b7b8a382ecdb53c2ee0750d";
    const native = "b55d7600d9e9a7e2a49155ddf3cfdb8e796c207faab833010fa41fb7828889bc47cf62348a7aaa0923c0832a589fab541e8f12eb54fb711c90e2307f0f66b194";
    expect(verifyMessage("3L6TyTisPBmrDAj6RoKmDzNnj4eQi54gD2", message, b64(`23${wrapped}`), "mainnet").valid).toBe(true);
    expect(verifyMessage("bc1qannfxke2tfd4l7vhepehpvt05y83v3qsf6nfkk", message, b64(`28${native}`), "mainnet").valid).toBe(true);
    expect(verifyMessage("3L6TyTisPBmrDAj6RoKmDzNnj4eQi54gD2", message, b64(`27${wrapped}`), "mainnet").valid).toBe(true);
    expect(verifyMessage("bc1qannfxke2tfd4l7vhepehpvt05y83v3qsf6nfkk", message, b64(`24${native}`), "mainnet").valid).toBe(true);
  });
});

describe("verifyMessage, BIP322 simple signatures", () => {
  // https://github.com/bitcoin/bips/blob/master/bip-0322/basic-test-vectors.json
  const address = "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l";
  it("accepts the P2WPKH vectors, with and without the smp prefix", () => {
    const empty = "smpAkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=";
    const hello = "smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy";
    expect(verifyMessage(address, "", empty, "mainnet")).toEqual({ valid: true, format: "BIP322" });
    expect(verifyMessage(address, "Hello World", hello, "mainnet").valid).toBe(true);
    expect(verifyMessage(address, "Hello World", hello.slice(3), "mainnet").valid).toBe(true);
    expect(verifyMessage(address, "", hello, "mainnet").valid).toBe(false);
  });

  it("accepts the P2TR key-path vector", () => {
    const signature = "AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R";
    const taproot = "bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler";
    expect(verifyMessage(taproot, "No prefix fallback", signature, "mainnet").valid).toBe(true);
    expect(verifyMessage(taproot, "No prefix fallback!", signature, "mainnet").valid).toBe(false);
  });

  // https://github.com/bitcoin/bips/blob/master/bip-0322/generated-test-vectors.json
  it("accepts the generated vectors and refuses their wrong message and wrong signer cases", () => {
    const wpkh = "smpAkgwRQIhALC6hdfxNy1n45d7UXSskRBdfZW0Al259E1kDMpipdYkAiAJPfZqb+WurZuf1apU5xeE6Igui9dvt5tihQLDvxlY1AEhAqbnruyo677ktQjio7XOchO3w51Dh9AbRVngha5jtNfT";
    expect(verifyMessage("bc1qqthe0hz8klx90e7stf6shclhsvqd5ly96pn53v", "2V6TUTMSH4VQ3Z7WZWKYD7DFNH", wpkh, "mainnet").valid).toBe(true);
    expect(verifyMessage("bc1qqthe0hz8klx90e7stf6shclhsvqd5ly96pn53v", "EFGJ4AZYXDV7NDUDSUDB3NCDUC", wpkh, "mainnet").valid).toBe(false);
  });

  it("says which signatures it can't check", () => {
    expect(() => verifyMessage(address, "x", "fulAgAAAAGn3Z6t/gsHNyHdgZTOVro0Hej+qbd", "mainnet")).toThrow(/full BIP322/i);
    expect(() => verifyMessage("bc1qp0ahvfh83088w49k405szqgg4f3pptr7p2g06tdxfjcd40z4lh4q95lsz9", "x", "smpAQA=", "mainnet")).toThrow(/P2WPKH and taproot/);
    expect(() => verifyMessage(address, "x", "not a signature", "mainnet")).toThrow(/isn't a signature/);
    expect(() => verifyMessage(address, "x", "Hzsu0U/THAsPz/MSuXGBKSULz2dTfmrg1NsAhFp+wH5aKfmX4Db7ExLGa7FGn0m6Mf43KsbEOWpvUUUBTM3Uusw=", "testnet4")).toThrow();
  });
});

describe("sign requests", () => {
  it("writes SeedSigner's QR text and Coldcard's file", () => {
    // https://github.com/SeedSigner/seedsigner/blob/0.8.7/src/seedsigner/models/decode_qr.py
    expect(signRequest("Hello World", "m/84h/0h/0h/0/3")).toBe("signmessage m/84h/0h/0h/0/3 ascii:Hello World");
    // https://github.com/Coldcard/firmware/blob/master/shared/msgsign.py
    expect(signFile("Hello World", "m/84h/0h/0h/0/3")).toBe("Hello World\nm/84h/0h/0h/0/3\np2wpkh\n");
  });

  it("refuses what the signers can't take", () => {
    expect(messageProblem("I own this address, 9 November 2026")).toBeNull();
    expect(messageProblem("")).toMatch(/Write/);
    expect(messageProblem("x")).toBeNull();
    expect(messageProblem("x".repeat(241))).toMatch(/240/);
    expect(messageProblem("café")).toMatch(/ASCII/);
    expect(messageProblem("two\nlines")).toMatch(/ASCII/);
    expect(messageProblem(" padded")).toBeNull();
    expect(messageProblem("three   spaces")).toBeNull();
  });
});

describe("reading a signature back", () => {
  const signature = "HyFaND+87TtVbRhkTfT3mPNBCQcJ32XXtNZGW8sFldJsNpOPCegEmdcCf5Thy18hdMH88GLxZLkOby/EwVUuSeA=";
  it("takes a bare signature", () => {
    expect(readSignature(`  ${signature}\n`)).toEqual({ signature });
  });

  // https://github.com/Coldcard/firmware/blob/master/shared/msgsign.py, rfc_signature_template
  it("takes an armoured message, and writes one it reads back", () => {
    const text = armour("Electrum", "bc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0", signature);
    expect(text).toBe(
      `-----BEGIN BITCOIN SIGNED MESSAGE-----\nElectrum\n-----BEGIN BITCOIN SIGNATURE-----\nbc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0\n${signature}\n-----END BITCOIN SIGNATURE-----\n`,
    );
    expect(readSignature(text.replace(/\n/g, "\r\n"))).toEqual({ message: "Electrum", address: "bc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0", signature });
  });
});

it("reads an armoured block with blank lines and surrounding text", () => {
  const signature = "HyFaND+87TtVbRhkTfT3mPNBCQcJ32XXtNZGW8sFldJsNpOPCegEmdcCf5Thy18hdMH88GLxZLkOby/EwVUuSeA=";
  const text = `Proof:\n-----BEGIN BITCOIN SIGNED MESSAGE-----\nElectrum\n-----BEGIN BITCOIN SIGNATURE-----\n\nbc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0\n\n${signature}\n-----END BITCOIN SIGNATURE-----`;
  expect(readSignature(text)).toEqual({ message: "Electrum", address: "bc1qq2tmmcngng78nllq2pvrkchcdukemtj56uyue0", signature });
});

// https://github.com/bitcoin/bips/blob/master/bip-0322/generated-test-vectors.json
it("checks a prefixed taproot proof and rejects a wrong signer", () => {
  const signature = "smpAUB6B2Rbupzua8LTQIF06516wzl+cwKy1be8RgoiW0riyXdKwe6GTz/5Hnb37m67pJwIKCh+D5jDueG6KpvYpmu8";
  expect(verifyMessage("bc1pcquvhrqv0q68t4m0hfq6tpn006qrskyc7yrqnp2uyrf2emg3wynsdjyk38", "PURVOQ544B6HUATVBJZN5EZJUU", signature, "mainnet").valid).toBe(true);
  expect(verifyMessage("bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler", "PURVOQ544B6HUATVBJZN5EZJUU", signature, "mainnet").valid).toBe(false);
});

it.each(["Hello\n", "Hello\r", "Hello\r\n", "Hello\u2028", "Hello\u2029"])("rejects a trailing line terminator in %j", (message) => {
  expect(messageProblem(message)).toMatch(/ASCII/);
  expect(() => signRequest(message, "m/84h/0h/0h/0/0")).toThrow(/ASCII/);
  expect(() => signFile(message, "m/84h/0h/0h/0/0")).toThrow(/ASCII/);
});
