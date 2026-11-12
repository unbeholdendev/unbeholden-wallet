import { describe, expect, it, vi } from "vitest";
import { memoryStore } from "../vault/vault";
import { openAnnotations } from "./annotations";

const POINT = `${"ab".repeat(32)}:1`;
const line = (record: object) => `${JSON.stringify({ type: "output", ref: POINT, ...record })}\n`;

describe("annotations", () => {
  it("an import clears a label, a freeze and a KYC mark, and the clearing survives a reload", async () => {
    const vault = memoryStore();
    const changed = vi.fn();
    const notes = await openAnnotations(vault, "w", null, changed);
    await notes.importLabels(line({ label: "Keep", spendable: false, kyc: true }));
    expect(notes.exportLabels()).toBe(line({ label: "Keep", spendable: false, kyc: true }));

    expect(await notes.importLabels(line({ label: "", spendable: true, kyc: false }))).toEqual({
      imported: 1,
      skipped: 0,
    });
    expect(changed).toHaveBeenCalledTimes(2);

    const reloaded = await openAnnotations(vault, "w", null, () => {});
    expect(reloaded.exportLabels()).toBe("");
    expect([...reloaded.frozen, ...reloaded.kyc, ...Object.keys(reloaded.labels)]).toEqual([]);
  });
});
