import { describe, expect, it } from "vitest";
import { explorerBase } from "./explorer";

describe("explorer base URLs", () => {
  it("keeps network paths and local HTTP explorers", () => {
    expect(explorerBase(" https://explorer.example/signet/// ")).toBe("https://explorer.example/signet");
    expect(explorerBase("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(explorerBase("  ")).toBe("");
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///tmp/explorer", "//explorer.example", "https://user:pass@explorer.example", "https://explorer.example?network=signet", "https://explorer.example/#/", "https://explorer.example?", "https://explorer.example/#", "not a URL"])("rejects %s", (url) => {
    expect(() => explorerBase(url)).toThrow();
  });
});
