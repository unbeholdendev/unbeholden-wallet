import { describe, expect, it } from "vitest";
import { parseBtc, parseUri } from "./Recipients";

describe("parseBtc", () => {
  it.each([
    ["1", 100_000_000],
    ["0.1", 10_000_000],
    [".5", 50_000_000],
    ["1.", 100_000_000],
    ["0.00000001", 1],
    ["1 000.5", 100_050_000_000],
    ["21000000", 2_100_000_000_000_000],
  ])("reads %j as %i sats", (text, sats) => expect(parseBtc(text)).toBe(sats));

  it.each(["", ".", "0.000000001", "1,5", "-1", "1e3", "abc", "21000000.00000001"])("refuses %j", (text) =>
    expect(parseBtc(text)).toBeNull(),
  );
});

// The examples in https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki#examples
describe("parseUri", () => {
  const address = "175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W";

  it("reads the BIP21 examples", () => {
    expect(parseUri(`bitcoin:${address}`)).toEqual({ address });
    expect(parseUri(`bitcoin:${address}?label=Luke-Jr`)).toEqual({ address, label: "Luke-Jr" });
    expect(parseUri(`bitcoin:${address}?amount=20.3&label=Luke-Jr`)).toEqual({ address, amount: "20.3", label: "Luke-Jr" });
    expect(parseUri(`bitcoin:${address}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`)).toEqual({
      address,
      amount: "50",
      label: "Luke-Jr",
    });
    expect(parseUri(`bitcoin:${address}?somethingyoudontunderstand=50&somethingelseyoudontget=999`)).toEqual({ address });
  });

  it("leaves a URI with an unknown required parameter whole, so it fails as an address", () => {
    const uri = `bitcoin:${address}?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999`;
    expect(parseUri(uri)).toEqual({ address: uri });
  });

  it("accepts the scheme in any case and drops an amount that is not one", () => {
    expect(parseUri(`BITCOIN:${address}?amount=50,000.00`)).toEqual({ address });
  });
});
