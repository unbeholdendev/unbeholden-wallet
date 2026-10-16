import { base64, hex } from "@scure/base";
import { parsePsbt } from "../wallet/psbt";
import { psbtFromUr, psbtUrDecoder } from "./ur";

// BIP174: every PSBT starts with "psbt" and 0xff.
// https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki
const MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);

const hasMagic = (bytes: Uint8Array) => MAGIC.every((b, i) => bytes[i] === b);

function decodeText(text: string): Uint8Array {
  const trimmed = text.trim();
  if (/^ur:/i.test(trimmed)) {
    const decoder = psbtUrDecoder();
    decoder.receive(trimmed);
    if (!decoder.result) {
      throw new Error("This is not a complete single-part ur:crypto-psbt");
    }
    return psbtFromUr(decoder.result);
  }
  const compact = trimmed.replace(/\s+/g, "");
  try {
    return /^[0-9a-f]+$/i.test(compact)
      ? hex.decode(compact.toLowerCase())
      : base64.decode(compact);
  } catch {
    return new Uint8Array();
  }
}

/**
 * Reads a PSBT from a file's bytes or from pasted text: binary, base64, hex,
 * or a single-part `ur:crypto-psbt`.
 */
export function readPsbt(input: Uint8Array | string): Uint8Array {
  const psbt =
    typeof input !== "string" && hasMagic(input)
      ? input
      : decodeText(
          typeof input === "string" ? input : new TextDecoder().decode(input),
        );
  if (!hasMagic(psbt)) throw new Error("This is not a PSBT");
  parsePsbt(psbt);
  return psbt;
}

/** A binary `.psbt` file, as signers that read from an SD card expect. */
export function psbtFile(psbt: Uint8Array, name = "transaction.psbt"): File {
  return new File([psbt as Uint8Array<ArrayBuffer>], name, {
    type: "application/octet-stream",
  });
}
