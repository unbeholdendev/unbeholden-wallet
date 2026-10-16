import { hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  chooseFragments,
  crc32,
  FountainDecoder,
  FountainEncoder,
  Xoshiro256,
} from "./fountain";
import {
  bytewordsDecode,
  bytewordsEncode,
  partCbor,
  psbtFromUr,
  psbtUrDecoder,
  psbtUrEncoder,
  UrDecoder,
  UrEncoder,
} from "./ur";

// Vectors from the reference implementation's tests, and its helpers that
// build the test messages:
// https://github.com/BlockchainCommons/bc-ur/blob/master/test/test.cpp
// https://github.com/BlockchainCommons/bc-ur/blob/master/test/test-utils.cpp

function makeMessage(length: number, seed = "Wolf"): Uint8Array {
  const rng = new Xoshiro256(seed);
  return Uint8Array.from({ length }, () => rng.nextInt(0, 255));
}

/** A CBOR byte string, for lengths 24 to 65535. */
function cborBytes(data: Uint8Array): Uint8Array {
  const head = data.length < 256 ? [0x58, data.length] : [0x59, data.length >> 8, data.length & 0xff];
  return Uint8Array.from([...head, ...data]);
}

const makeMessageUr = (length: number) => ({
  type: "bytes",
  cbor: cborBytes(makeMessage(length)),
});

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("primitives", () => {
  it("computes CRC32", () => {
    expect(crc32(utf8("Hello, world!")).toString(16)).toBe("ebe6c6e6");
    expect(crc32(utf8("Wolf")).toString(16)).toBe("598c84dc");
  });

  it("encodes and decodes minimal bytewords", () => {
    const input = Uint8Array.of(0, 1, 2, 128, 255);
    expect(bytewordsEncode(input)).toBe("aeadaolazmjendeoti");
    expect(bytewordsDecode("aeadaolazmjendeoti")).toEqual(input);

    const long = Uint8Array.of(
      245, 215, 20, 198, 241, 235, 69, 59, 209, 205, 165, 18, 150, 158, 116,
      135, 229, 212, 19, 159, 17, 37, 239, 240, 253, 11, 109, 191, 37, 242, 38,
      120, 223, 41, 156, 189, 242, 254, 147, 204, 66, 163, 216, 175, 191, 72,
      169, 54, 32, 60, 144, 230, 210, 137, 184, 197, 33, 113, 88, 14, 157, 31,
      177, 46, 1, 115, 205, 69, 225, 150, 65, 235, 58, 144, 65, 240, 133, 69,
      113, 247, 63, 53, 242, 165, 160, 144, 26, 13, 79, 237, 133, 71, 82, 69,
      254, 165, 138, 41, 85, 24,
    );
    const encoded =
      "yktsbbswwnwmfefrttsnonbgmtnnjyltvwtybwne" +
      "bydawswtzcbdjnrsdawzdsksurdtnsrywzzemusf" +
      "fwottppersfdptencxfnmhvatdldroskcljshdba" +
      "ntctpadmadjksnfevymtfpwmftmhfpwtlpfejsyl" +
      "fhecwzonnbmhcybtgwwelpflgmfezeonledtgocs" +
      "fzhycypf";
    expect(bytewordsEncode(long)).toBe(encoded);
    expect(bytewordsDecode(encoded)).toEqual(long);
  });

  it("refuses bytewords with a bad checksum or too few bytes", () => {
    expect(() => bytewordsDecode("aeadaolazojendeowf")).toThrow();
    expect(() => bytewordsDecode("wf")).toThrow();
    expect(() => bytewordsDecode("")).toThrow();
  });

  it("generates the reference xoshiro256** sequences", () => {
    const rng1 = new Xoshiro256("Wolf");
    expect(Array.from({ length: 100 }, () => Number(rng1.next() % 100n))).toEqual([
      42, 81, 85, 8, 82, 84, 76, 73, 70, 88, 2, 74, 40, 48, 77, 54, 88, 7, 5, 88, 37, 25, 82, 13, 69, 59, 30, 39, 11, 82, 19, 99, 45, 87, 30, 15, 32, 22, 89, 44, 92, 77, 29, 78, 4, 92, 44, 68, 92, 69, 1, 42, 89, 50, 37, 84, 63, 34, 32, 3, 17, 62, 40, 98, 82, 89, 24, 43, 85, 39, 15, 3, 99, 29, 20, 42, 27, 10, 85, 66, 50, 35, 69, 70, 70, 74, 30, 13, 72, 54, 11, 5, 70, 55, 91, 52, 10, 43, 43, 52,
    ]);

    const checksum = crc32(utf8("Wolf"));
    const seed = Uint8Array.of(checksum >>> 24, (checksum >>> 16) & 255, (checksum >>> 8) & 255, checksum & 255);
    const rng2 = new Xoshiro256(seed);
    expect(Array.from({ length: 100 }, () => Number(rng2.next() % 100n))).toEqual([
      88, 44, 94, 74, 0, 99, 7, 77, 68, 35, 47, 78, 19, 21, 50, 15, 42, 36, 91, 11, 85, 39, 64, 22, 57, 11, 25, 12, 1, 91, 17, 75, 29, 47, 88, 11, 68, 58, 27, 65, 21, 54, 47, 54, 73, 83, 23, 58, 75, 27, 26, 15, 60, 36, 30, 21, 55, 57, 77, 76, 75, 47, 53, 76, 9, 91, 14, 69, 3, 95, 11, 73, 20, 99, 68, 61, 3, 98, 36, 98, 56, 65, 14, 80, 74, 57, 63, 68, 51, 56, 24, 39, 53, 80, 57, 51, 81, 3, 1, 30,
    ]);

    const rng3 = new Xoshiro256("Wolf");
    expect(Array.from({ length: 100 }, () => rng3.nextInt(1, 10))).toEqual([
      6, 5, 8, 4, 10, 5, 7, 10, 4, 9, 10, 9, 7, 7, 1, 1, 2, 9, 9, 2, 6, 4, 5, 7, 8, 5, 4, 2, 3, 8, 7, 4, 5, 1, 10, 9, 3, 10, 2, 6, 8, 5, 7, 9, 3, 1, 5, 2, 7, 1, 4, 4, 4, 4, 9, 4, 5, 5, 6, 9, 5, 1, 2, 8, 3, 3, 2, 8, 4, 3, 2, 1, 10, 8, 9, 3, 10, 8, 5, 5, 6, 7, 10, 5, 8, 9, 4, 6, 4, 2, 10, 2, 1, 7, 9, 6, 7, 4, 2, 5,
    ]);
  });

  it("chooses the reference fragments for each part", () => {
    const message = makeMessage(1024);
    const fragmentCount = new FountainEncoder(message, 100, 0, 10).seqLen;
    expect(fragmentCount).toBe(11);
    expect(
      Array.from({ length: 30 }, (_, i) => chooseFragments(i + 1, fragmentCount, crc32(message))),
    ).toEqual([
      [0], [1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [9],
      [2, 5, 6, 8, 9, 10], [8], [1, 5], [1], [0, 2, 4, 5, 8, 10], [5], [2], [2],
      [0, 1, 3, 4, 5, 7, 9, 10], [0, 1, 2, 3, 5, 6, 8, 9, 10], [0, 2, 4, 5, 7, 8, 9, 10],
      [3, 5], [4], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 3, 4, 5, 6, 7, 9, 10],
      [6], [5, 6], [7],
    ]);
  });
});

describe("fountain codes", () => {
  it("encodes the reference parts", () => {
    const encoder = new FountainEncoder(makeMessage(256), 30);
    const parts = Array.from({ length: 20 }, () => hex.encode(partCbor(encoder.nextPart())));
    expect(parts).toEqual([
      "8501091901001a0167aa07581d916ec65cf77cadf55cd7f9cda1a1030026ddd42e905b77adc36e4f2d3c",
      "8502091901001a0167aa07581dcba44f7f04f2de44f42d84c374a0e149136f25b01852545961d55f7f7a",
      "8503091901001a0167aa07581d8cde6d0e2ec43f3b2dcb644a2209e8c9e34af5c4747984a5e873c9cf5f",
      "8504091901001a0167aa07581d965e25ee29039fdf8ca74f1c769fc07eb7ebaec46e0695aea6cbd60b3e",
      "8505091901001a0167aa07581dc4bbff1b9ffe8a9e7240129377b9d3711ed38d412fbb4442256f1e6f59",
      "8506091901001a0167aa07581d5e0fc57fed451fb0a0101fb76b1fb1e1b88cfdfdaa946294a47de8fff1",
      "8507091901001a0167aa07581d73f021c0e6f65b05c0a494e50791270a0050a73ae69b6725505a2ec8a5",
      "8508091901001a0167aa07581d791457c9876dd34aadd192a53aa0dc66b556c0c215c7ceb8248b717c22",
      "8509091901001a0167aa07581d951e65305b56a3706e3e86eb01c803bbf915d80edcd64d4d0000000000",
      "850a091901001a0167aa07581d330f0f33a05eead4f331df229871bee733b50de71afd2e5a79f196de09",
      "850b091901001a0167aa07581d3b205ce5e52d8c24a52cffa34c564fa1af3fdffcd349dc4258ee4ee828",
      "850c091901001a0167aa07581ddd7bf725ea6c16d531b5f03254783803048ca08b87148daacd1cd7a006",
      "850d091901001a0167aa07581d760be7ad1c6187902bbc04f539b9ee5eb8ea6833222edea36031306c01",
      "850e091901001a0167aa07581d5bf4031217d2c3254b088fa7553778b5003632f46e21db129416f65b55",
      "850f091901001a0167aa07581d73f021c0e6f65b05c0a494e50791270a0050a73ae69b6725505a2ec8a5",
      "8510091901001a0167aa07581db8546ebfe2048541348910267331c643133f828afec9337c318f71b7df",
      "8511091901001a0167aa07581d23dedeea74e3a0fb052befabefa13e2f80e4315c9dceed4c8630612e64",
      "8512091901001a0167aa07581dd01a8daee769ce34b6b35d3ca0005302724abddae405bdb419c0a6b208",
      "8513091901001a0167aa07581d3171c5dc365766eff25ae47c6f10e7de48cfb8474e050e5fe997a6dc24",
      "8514091901001a0167aa07581de055c2433562184fa71b4be94f262e200f01c6f74c284b0dc6fae6673f",
    ]);
  });

  it("decodes a long message from its parts in order", () => {
    const message = makeMessage(32767);
    const encoder = new FountainEncoder(message, 1000, 100);
    const decoder = new FountainDecoder();
    while (!decoder.result) decoder.receive(encoder.nextPart());
    expect(decoder.result).toEqual(message);
  });

  it("ignores a part whose lengths do not add up", () => {
    const decoder = new FountainDecoder();
    const data = new Uint8Array(10);
    const part = { seqNum: 1, checksum: 0, data };
    expect(decoder.receive({ ...part, seqLen: 0xffffffff, messageLen: 100 })).toBe(false);
    expect(decoder.receive({ ...part, seqLen: 2 ** 23, messageLen: 2 ** 24 })).toBe(false);
    expect(decoder.receive({ ...part, seqLen: 10, messageLen: 100 })).toBe(true);
  });
});

describe("UR", () => {
  it("encodes and decodes the reference single-part UR", () => {
    const ur = makeMessageUr(50);
    const expected =
      "ur:bytes/hdeymejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtgwdpfnsboxgwlbaawzuefywkdplrsrjynbvygabwjldapfcsdwkbrkch";
    expect(new UrEncoder(ur, 1000).nextPart()).toBe(expected);
    const decoder = new UrDecoder();
    expect(decoder.receive(expected)).toBe(true);
    expect(decoder.result).toEqual(ur);
    expect(decoder.progress).toEqual({ captured: 1, expected: 1, fraction: 1 });
  });

  it("encodes the reference multi-part UR", () => {
    const encoder = new UrEncoder(makeMessageUr(256), 30);
    expect(Array.from({ length: 20 }, () => encoder.nextPart())).toEqual([
      "ur:bytes/1-9/lpadascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtdkgslpgh",
      "ur:bytes/2-9/lpaoascfadaxcywenbpljkhdcagwdpfnsboxgwlbaawzuefywkdplrsrjynbvygabwjldapfcsgmghhkhstlrdcxaefz",
      "ur:bytes/3-9/lpaxascfadaxcywenbpljkhdcahelbknlkuejnbadmssfhfrdpsbiegecpasvssovlgeykssjykklronvsjksopdzmol",
      "ur:bytes/4-9/lpaaascfadaxcywenbpljkhdcasotkhemthydawydtaxneurlkosgwcekonertkbrlwmplssjtammdplolsbrdzcrtas",
      "ur:bytes/5-9/lpahascfadaxcywenbpljkhdcatbbdfmssrkzmcwnezelennjpfzbgmuktrhtejscktelgfpdlrkfyfwdajldejokbwf",
      "ur:bytes/6-9/lpamascfadaxcywenbpljkhdcackjlhkhybssklbwefectpfnbbectrljectpavyrolkzczcpkmwidmwoxkilghdsowp",
      "ur:bytes/7-9/lpatascfadaxcywenbpljkhdcavszmwnjkwtclrtvaynhpahrtoxmwvwatmedibkaegdosftvandiodagdhthtrlnnhy",
      "ur:bytes/8-9/lpayascfadaxcywenbpljkhdcadmsponkkbbhgsoltjntegepmttmoonftnbuoiyrehfrtsabzsttorodklubbuyaetk",
      "ur:bytes/9-9/lpasascfadaxcywenbpljkhdcajskecpmdckihdyhphfotjojtfmlnwmadspaxrkytbztpbauotbgtgtaeaevtgavtny",
      "ur:bytes/10-9/lpbkascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtwdkiplzs",
      "ur:bytes/11-9/lpbdascfadaxcywenbpljkhdcahelbknlkuejnbadmssfhfrdpsbiegecpasvssovlgeykssjykklronvsjkvetiiapk",
      "ur:bytes/12-9/lpbnascfadaxcywenbpljkhdcarllaluzmdmgstospeyiefmwejlwtpedamktksrvlcygmzemovovllarodtmtbnptrs",
      "ur:bytes/13-9/lpbtascfadaxcywenbpljkhdcamtkgtpknghchchyketwsvwgwfdhpgmgtylctotzopdrpayoschcmhplffziachrfgd",
      "ur:bytes/14-9/lpbaascfadaxcywenbpljkhdcapazewnvonnvdnsbyleynwtnsjkjndeoldydkbkdslgjkbbkortbelomueekgvstegt",
      "ur:bytes/15-9/lpbsascfadaxcywenbpljkhdcaynmhpddpzmversbdqdfyrehnqzlugmjzmnmtwmrouohtstgsbsahpawkditkckynwt",
      "ur:bytes/16-9/lpbeascfadaxcywenbpljkhdcawygekobamwtlihsnpalnsghenskkiynthdzotsimtojetprsttmukirlrsbtamjtpd",
      "ur:bytes/17-9/lpbyascfadaxcywenbpljkhdcamklgftaxykpewyrtqzhydntpnytyisincxmhtbceaykolduortotiaiaiafhiaoyce",
      "ur:bytes/18-9/lpbgascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtntwkbkwy",
      "ur:bytes/19-9/lpbwascfadaxcywenbpljkhdcadekicpaajootjzpsdrbalpeywllbdsnbinaerkurspbncxgslgftvtsrjtksplcpeo",
      "ur:bytes/20-9/lpbbascfadaxcywenbpljkhdcayapmrleeleaxpasfrtrdkncffwjyjzgyetdmlewtkpktgllepfrltataztksmhkbot",
    ]);
  });

  it("decodes a long multi-part UR", () => {
    const ur = makeMessageUr(32767);
    const encoder = new UrEncoder(ur, 1000, 100);
    const decoder = new UrDecoder();
    while (!decoder.result) decoder.receive(encoder.nextPart());
    expect(decoder.result).toEqual(ur);
  });

  it("decodes parts out of order, repeated and in upper case, and reports progress", () => {
    const ur = makeMessageUr(2000);
    const encoder = new UrEncoder(ur, 100);
    const parts = Array.from({ length: encoder.seqLen * 3 }, () => encoder.nextPart());
    const rng = new Xoshiro256("order");
    const scrambled = parts
      .flatMap((part) => [part, part.toUpperCase()])
      .map((part) => ({ part, key: rng.nextDouble() }))
      .sort((a, b) => a.key - b.key)
      .map(({ part }) => part);

    const decoder = new UrDecoder();
    expect(decoder.progress).toEqual({ captured: 0, expected: 0, fraction: 0 });
    let last = decoder.progress;
    for (const part of scrambled) {
      decoder.receive(part);
      const now = decoder.progress;
      expect(now.captured).toBeGreaterThanOrEqual(last.captured);
      expect(now.fraction).toBeGreaterThanOrEqual(last.fraction);
      last = now;
      if (decoder.result) break;
    }
    expect(decoder.result).toEqual(ur);
    expect(decoder.progress).toEqual({ captured: encoder.seqLen, expected: encoder.seqLen, fraction: 1 });
  });

  it("ignores parts of another message, type or scheme", () => {
    const decoder = new UrDecoder();
    const encoder = new UrEncoder(makeMessageUr(256), 30);
    expect(decoder.receive(encoder.nextPart())).toBe(true);
    expect(decoder.receive(new UrEncoder(makeMessageUr(300), 30).nextPart())).toBe(false);
    expect(decoder.receive(encoder.nextPart().replace("ur:bytes", "ur:other"))).toBe(false);
    expect(decoder.receive("bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe(false);
    expect(decoder.receive("ur:bytes/2-9/lpaoascfadaxcywenbpljkhdcagwdpfnsboxgwlbaawzuefywkdplrsrjynbvygabwjldapfcsgmghhkhstlrdcxaefa")).toBe(false);
  });
});

describe("crypto-psbt", () => {
  // https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-006-urtypes.md
  const psbt = hex.decode(
    "70736274ff01009a020000000258e87a21b56daf0c23be8e7070456c336f7cbaa5c8757924f545887bb2abdd750000000000ffffffff838d0427d0ec650a68aa46bb0b098aea4422c071b2ca78352a077959d07cea1d0100000000ffffffff0270aaf00800000000160014d85c2b71d0060b09c9886aeb815e50991dda124d00e1f5050000000016001400aea9a2e5f0f876a588df5546e8742d1d87008f000000000000000000",
  );
  const ur =
    "ur:psbt/hdosjojkidjyzmadaenyaoaeaeaeaohdvsknclrejnpebncnrnmnjojofejzeojlkerdonspkpkkdkykfelokgprpyutkpaeaeaeaeaezmzmzmzmlslgaaditiwpihbkispkfgrkbdaslewdfycprtjsprsgksecdratkkhktikewdcaadaeaeaeaezmzmzmzmaojopkwtayaeaeaeaecmaebbtphhdnjstiambdassoloimwmlyhygdnlcatnbggtaevyykahaeaeaeaecmaebbaeplptoevwwtyakoonlourgofgvsjydpcaltaemyaeaeaeaeaeaeaeaeaebkgdcarh";

  it("matches the registry's example", () => {
    expect(psbtUrEncoder(psbt, 1000).nextPart()).toBe(ur.replace("ur:psbt", "ur:crypto-psbt"));
    const decoder = psbtUrDecoder();
    decoder.receive(ur);
    expect(psbtFromUr(decoder.result!)).toEqual(psbt);
  });

  it("round-trips a PSBT through animated parts", () => {
    const encoder = psbtUrEncoder(psbt, 20);
    expect(encoder.seqLen).toBeGreaterThan(1);
    expect(encoder.nextPart()).toMatch(/^ur:crypto-psbt\/1-\d+\//);
    const decoder = psbtUrDecoder();
    while (!decoder.result) decoder.receive(encoder.nextPart());
    expect(psbtFromUr(decoder.result)).toEqual(psbt);
  });

  it("refuses a UR of another type", () => {
    expect(psbtUrDecoder().receive(new UrEncoder(makeMessageUr(50), 1000).nextPart())).toBe(false);
  });
});
