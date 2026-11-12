import { describe, expect, it } from "vitest";
import type { PsbtReview } from "../wallet/psbt";
import { claimOutputs, signNotices, tally } from "./sign";

const review = (outputs: PsbtReview["outputs"], fee = 1_000): PsbtReview => ({ outputs, fee, vsize: 141, feeRate: 7 });
const out = (address: string | null, value: number, mine = false, change = false) => ({ address, value, mine, change });

describe("claimOutputs", () => {
  it("marks known receive addresses as mine and known change addresses as change", () => {
    const claimed = claimOutputs(review([out("a", 1), out("b", 2), out("c", 3), out(null, 4)]), {
      receive: [{ address: "a" }],
      change: [{ address: "b" }],
    });
    expect(claimed.outputs).toEqual([out("a", 1, true), out("b", 2, true, true), out("c", 3), out(null, 4)]);
  });

  it("keeps what the PSBT already proved when the address is unknown", () => {
    const proved = out("x", 5, true, true);
    expect(claimOutputs(review([proved]), undefined).outputs).toEqual([proved]);
  });
});

describe("tally", () => {
  it("counts only payments to others as leaving, and sums change", () => {
    const { payments, leaving, change } = tally(
      review([out("p", 10_000), out("self", 3_000, true), out("ch", 2_000, true, true), out("q", 5_000)]),
    );
    expect(payments.map((o) => o.address)).toEqual(["p", "self", "q"]);
    expect(leaving).toBe(15_000);
    expect(change).toBe(2_000);
  });
});

describe("signNotices", () => {
  it("adds a warning when the fee is over a tenth of what leaves", () => {
    expect(signNotices(review([out("p", 9_000)], 1_000), ["w"])).toEqual([
      "w",
      "The fee is 11% of what you're sending. Make sure that's what you meant.",
    ]);
  });

  it("returns the warnings as they are at a tenth or below, or when nothing leaves", () => {
    const warnings = ["w"];
    expect(signNotices(review([out("p", 10_000)], 1_000), warnings)).toBe(warnings);
    expect(signNotices(review([out("self", 10_000, true)], 5_000), warnings)).toBe(warnings);
  });
});
