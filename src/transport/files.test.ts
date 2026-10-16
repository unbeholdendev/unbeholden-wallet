import { base64, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { psbtFile, readPsbt } from "./files";

// The example in the UR registry, as hex and as a UR.
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-006-urtypes.md
const HEX =
  "70736274ff01009a020000000258e87a21b56daf0c23be8e7070456c336f7cbaa5c8757924f545887bb2abdd750000000000ffffffff838d0427d0ec650a68aa46bb0b098aea4422c071b2ca78352a077959d07cea1d0100000000ffffffff0270aaf00800000000160014d85c2b71d0060b09c9886aeb815e50991dda124d00e1f5050000000016001400aea9a2e5f0f876a588df5546e8742d1d87008f000000000000000000";
const UR =
  "ur:psbt/hdosjojkidjyzmadaenyaoaeaeaeaohdvsknclrejnpebncnrnmnjojofejzeojlkerdonspkpkkdkykfelokgprpyutkpaeaeaeaeaezmzmzmzmlslgaaditiwpihbkispkfgrkbdaslewdfycprtjsprsgksecdratkkhktikewdcaadaeaeaeaezmzmzmzmaojopkwtayaeaeaeaecmaebbtphhdnjstiambdassoloimwmlyhygdnlcatnbggtaevyykahaeaeaeaecmaebbaeplptoevwwtyakoonlourgofgvsjydpcaltaemyaeaeaeaeaeaeaeaeaebkgdcarh";
const psbt = hex.decode(HEX);
const text = (s: string) => new TextEncoder().encode(s);

describe("PSBT files", () => {
  it.each([
    ["binary bytes", psbt],
    ["a base64 file", text(`${base64.encode(psbt)}\n`)],
    ["a hex file", text(HEX.toUpperCase().replace(/(.{64})/g, "$1\n"))],
    ["pasted base64", ` ${base64.encode(psbt)} `],
    ["pasted hex", HEX],
    ["a pasted single-part UR", UR.toUpperCase()],
  ])("reads %s", (_, input) => {
    expect(readPsbt(input)).toEqual(psbt);
  });

  it.each([
    ["a raw transaction", HEX.slice(10)],
    ["a truncated PSBT", HEX.slice(0, 60)],
    ["text", "hello"],
    ["one part of an animated UR", "ur:crypto-psbt/1-9/lpadascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtdkgslpgh"],
  ])("refuses %s", (_, input) => {
    expect(() => readPsbt(input)).toThrow();
  });

  it("writes a binary .psbt file", async () => {
    const file = psbtFile(psbt);
    expect(file.name).toBe("transaction.psbt");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(psbt);
  });
});
