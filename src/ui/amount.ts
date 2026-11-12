/** BTC with the eight decimals grouped as sats, `0.12 000 000`, split where the significant digits start. */
export function btcParts(sats: number) {
  const abs = Math.abs(sats);
  const whole = Math.floor(abs / 1e8)
    .toLocaleString("en-GB")
    .replace(/,/g, " ");
  const frac = String(abs % 1e8).padStart(8, "0");
  const full = `${whole}.${frac.slice(0, 2)} ${frac.slice(2, 5)} ${frac.slice(5)}`;
  let i = 0;
  while (i < full.length && /[0. ]/.test(full[i]!)) i++;
  if (i === full.length) i--;
  if (full[i - 1] === ".") i--;
  return { lead: full.slice(0, i), rest: full.slice(i) };
}

export const groupSats = (n: number) => Math.round(n).toLocaleString("en-GB").replace(/,/g, "\u202f");
