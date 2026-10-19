/** BTC with the eight decimals grouped as sats, `0.12 000 000`, split where the significant digits start. */
export function btcParts(sats: number) {
  const abs = Math.abs(sats);
  const whole = Math.floor(abs / 1e8).toLocaleString("en-GB").replace(/,/g, " ");
  const frac = String(abs % 1e8).padStart(8, "0");
  const full = `${whole}.${frac.slice(0, 2)} ${frac.slice(2, 5)} ${frac.slice(5)}`;
  let i = 0;
  while (i < full.length && /[0. ]/.test(full[i]!)) i++;
  if (i === full.length) i--;
  if (full[i - 1] === ".") i--;
  return { lead: full.slice(0, i), rest: full.slice(i) };
}

export function Amount({ sats, unit = false, signed = false }: { sats: number; unit?: boolean; signed?: boolean }) {
  const { lead, rest } = btcParts(sats);
  const incoming = signed && sats > 0;
  const sign = sats < 0 ? "−" : incoming ? "+" : "";
  return (
    <span className={`whitespace-nowrap tabular-nums ${incoming ? "text-ok" : ""}`}>
      {sign}
      <span className={incoming ? "opacity-75" : "font-normal text-ink-3"}>{lead}</span>
      {rest}
      {unit && <span className="ml-[0.3em] text-[0.62em] font-bold tracking-[0.04em] text-ink-3">BTC</span>}
    </span>
  );
}

export const groupSats = (n: number) => Math.round(n).toLocaleString("en-GB").replace(/,/g, "\u202f");
