import { encodeQR, type ErrorCorrection } from "qr";
import { decodeQR } from "qr/decode.js";

/**
 * The QR code's modules, true for dark, including a four-module quiet zone.
 * Upper-case a UR first: it then fits the denser alphanumeric mode.
 */
export function qrMatrix(
  text: string,
  ecc: ErrorCorrection = "low",
): boolean[][] {
  return encodeQR(text, "raw", { ecc, border: 4 });
}

/**
 * SVG path data for the dark modules, one unit per module, to draw inside a
 * `viewBox` of `0 0 size size` on a light background.
 */
export function qrPath(
  text: string,
  ecc: ErrorCorrection = "low",
): { size: number; d: string } {
  const matrix = qrMatrix(text, ecc);
  let d = "";
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      d += `M${start} ${y}h${x + 1 - start}v1H${start}z`;
    }
  });
  return { size: matrix.length, d };
}

/** The text of a QR code in a video frame, or null if none can be read. */
export function readQr(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): string | null {
  try {
    return decodeQR(image);
  } catch {
    return null;
  }
}
