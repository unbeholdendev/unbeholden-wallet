import { describe, expect, it } from "vitest";
import { btcParts } from "./amount";

describe("btcParts", () => {
  it("groups the decimals as sats and dims the leading zeros", () => {
    expect(btcParts(12_000_000)).toEqual({ lead: "0", rest: ".12 000 000" });
    expect(btcParts(1_204_551)).toEqual({ lead: "0.0", rest: "1 204 551" });
    expect(btcParts(21_400)).toEqual({ lead: "0.00 0", rest: "21 400" });
    expect(btcParts(150_000_000)).toEqual({ lead: "", rest: "1.50 000 000" });
    expect(btcParts(0)).toEqual({ lead: "0.00 000 00", rest: "0" });
    expect(btcParts(-830_000)).toEqual({ lead: "0.00 ", rest: "830 000" });
  });
});
