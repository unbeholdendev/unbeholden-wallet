import { useEffect, useId, useState } from "react";
import { useConnection } from "../../app/connection";
import type { FeeBucket } from "../../backend/backend";
import { feeTargets, MAX_FEE_RATE, MIN_FEE_RATE, mempoolPosition, type FeeTargets } from "../../wallet/fees";
import { LinkButton, Panel } from "../../ui/kit";

// A NaN rate passes every comparison, so it would get past the fee clamp and the bump checks.
const valid = ({ feeRate, vsize }: FeeBucket) => Number.isFinite(feeRate) && feeRate > 0 && Number.isFinite(vsize) && vsize >= 0;

/** The node's mempool histogram, fetched again on each block and every minute. Null until the first answer. */
export function useFeeHistogram(): FeeBucket[] | null {
  const { backend, connection } = useConnection();
  const tip = connection.phase === "connected" ? connection.tip : null;
  const [histogram, setHistogram] = useState<FeeBucket[] | null>(null);
  useEffect(() => {
    if (!backend) return;
    let live = true;
    const load = () => backend.feeHistogram().then((h) => live && setHistogram(h.filter(valid)), () => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [backend, tip]);
  return histogram;
}

export type FeeChoice = { preset: keyof FeeTargets | "floor" } | { manual: number };

const PRESETS: { key: keyof FeeTargets | "floor"; name: string }[] = [
  { key: "nextBlock", name: "Next block" },
  { key: "threeBlocks", name: "Within 30 minutes" },
  { key: "sixBlocks", name: "Within an hour" },
  { key: "floor", name: "No rush" },
];

/** The rate a choice comes to now; a preset follows the mempool, a manual rate never moves. */
export function rateOf(choice: FeeChoice, histogram: FeeBucket[] | null, floor = MIN_FEE_RATE): number {
  if ("manual" in choice) return choice.manual;
  const targets = histogram ? feeTargets(histogram) : null;
  const rate = choice.preset === "floor" || !targets ? MIN_FEE_RATE : targets[choice.preset];
  return Math.max(rate, floor);
}

const MVB = 1_000_000;
const mvb = (vsize: number) => (vsize / MVB).toLocaleString("en-GB", { maximumFractionDigits: 1 });
export const rateText = (rate: number) => rate.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export function eta(blocks: number) {
  const minutes = blocks * 10;
  return minutes < 60 ? `about ${minutes} min` : minutes < 240 ? `about ${Math.round(minutes / 60)} hour${minutes >= 90 ? "s" : ""}` : "several hours";
}

const W = 360;
const H = 124;
const L = 28;
const B = 22;
const TOP_RATE = 60;
const CONTOURS = [2, 5, 10, 20, 50];

/** The mempool as a cross-section: rate up a log scale, vsize paying more along, and where a rate lands. */
function Section({ histogram, rate }: { histogram: FeeBucket[]; rate: number }) {
  const clip = `c${useId().replace(/\W/g, "")}`;
  const total = histogram.reduce((a, b) => a + b.vsize, 0) / MVB;
  const maxX = Math.min(12, Math.max(2, Math.ceil(total)));
  const ly = (r: number) => H - B - (Math.log(Math.min(Math.max(r, 1), TOP_RATE)) / Math.log(TOP_RATE)) * (H - B - 24);
  const lx = (m: number) => L + (Math.min(m, maxX) / maxX) * (W - L - 6);
  let cum = 0;
  let d = `M${lx(0)} ${H - B}L${lx(0)} ${ly(histogram[0]?.feeRate ?? 1)}`;
  histogram.forEach((bucket, i) => {
    d += `L${lx(cum)} ${ly(histogram[Math.max(i - 1, 0)]!.feeRate)}`;
    cum += bucket.vsize / MVB;
    d += `L${lx(cum)} ${ly(bucket.feeRate)}`;
  });
  d += `L${lx(cum)} ${H - B}Z`;
  const ahead = mempoolPosition(histogram, rate).vsizeAhead / MVB;
  const hx = lx(ahead);
  const flip = hx > W - 110;
  const step = maxX > 6 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mempool cross-section. ${mvb(ahead * MVB)} MvB of transactions pay more than ${rateText(rate)} sat/vB.`} className="block h-auto w-full">
      <defs>
        <clipPath id={clip}>
          <path d={d} />
        </clipPath>
      </defs>
      <path d={d} className="fill-sunk" />
      <g clipPath={`url(#${clip})`}>
        {CONTOURS.map((r) => (
          <line key={r} x1={L} x2={W} y1={ly(r)} y2={ly(r)} className="stroke-rule-2 stroke-[0.7] opacity-55" />
        ))}
      </g>
      <path d={d.replace(/L[^L]*Z$/, "")} className="fill-none stroke-rule-2 stroke-[1.6]" />
      {CONTOURS.map((r) => (
        <text key={r} x={L - 4} y={ly(r) + 3} textAnchor="end" className="fill-ink-3 text-[9px] font-bold">
          {r}
        </text>
      ))}
      {Array.from({ length: Math.floor(maxX / step) + 1 }, (_, i) => i * step).map((m) => (
        <g key={m}>
          <line x1={lx(m)} x2={lx(m)} y1={H - B} y2={H - B + 4} className="stroke-rule-2" />
          <text x={lx(m)} y={H - B + 14} textAnchor="middle" className="fill-ink-3 text-[9px]">
            {m}
          </text>
        </g>
      ))}
      <line x1={hx} x2={hx} y1={10} y2={H - B} className="stroke-carbon stroke-[1.6] [stroke-dasharray:4_3]" />
      <text x={flip ? hx - 5 : hx + 5} y={18} textAnchor={flip ? "end" : "start"} className="fill-carbon text-[10px] font-bold">
        You are here{ahead > maxX ? ", further down" : ""}
      </text>
      <text x={W - 6} y={H - 1} textAnchor="end" className="fill-ink-3 text-[9px]">
        MvB ahead of you, about one block each
      </text>
      <text x={2} y={9} className="fill-ink-3 text-[9px] font-bold">
        sat/vB, log scale
      </text>
    </svg>
  );
}

const stepper = "grid w-10 place-items-center text-lg text-ink-2 hover:bg-sunk";

/** Presets from the mempool, the cross-section, and a manual rate that nothing overrides. */
export function FeePanel({
  histogram,
  choice,
  onChange,
  floor = MIN_FEE_RATE,
}: {
  histogram: FeeBucket[] | null;
  choice: FeeChoice;
  onChange: (choice: FeeChoice) => void;
  floor?: number;
}) {
  const rate = rateOf(choice, histogram, floor);
  const [text, setText] = useState(rateText(rate));
  const [editing, setEditing] = useState(false);
  const [chart, setChart] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!editing) setText(rateText(rate));
  }, [rate, editing]);
  const typed = Number(text.replace(",", "."));
  const invalid = !(typed >= floor && typed <= MAX_FEE_RATE);
  const set = (manual: number) => onChange({ manual: Math.round(Math.max(manual, floor) * 10) / 10 });
  const blocks = (r: number) => (histogram ? mempoolPosition(histogram, r).blocks : 1);
  const lower = Math.max(floor, Math.round((rate - 2) * 10) / 10);

  const rates = PRESETS.map((p) => rateOf({ preset: p.key }, histogram, floor));

  return (
    <Panel title="Fee" aside="From your node's mempool" className="@container">
      {histogram === null ? (
        <p className="m-0 text-sm text-ink-3">Asking your node for its mempool.</p>
      ) : rates.every((r) => r === rates[0]) ? (
        <p className="m-0 text-sm text-ink-2">
          {histogram.length === 0 && "Your node's mempool is empty, so there's nothing to outbid. "}Any rate from {rateText(rates[0]!)} sat/vB makes the next block.
        </p>
      ) : (
        <div className="grid gap-3 @min-[640px]:grid-cols-2 @min-[640px]:items-start">
          <LinkButton aria-expanded={chart} onClick={() => setChart(!chart)} className="justify-self-start text-sm md:hidden">
            {chart ? "Hide" : "Show"} the mempool
          </LinkButton>
          <div className={`gap-3 md:grid ${chart ? "grid" : "hidden"}`}>
            <Section histogram={histogram} rate={rate} />
            <p className="m-0 text-sm text-ink-2">
              At {rateText(rate)} sat/vB, {mvb(mempoolPosition(histogram, rate).vsizeAhead)} MvB pays more than you: {eta(blocks(rate))}.
              {lower < rate && (
                <> At {rateText(lower)} sat/vB that would be {mvb(mempoolPosition(histogram, lower).vsizeAhead)} MvB, {eta(blocks(lower))}.</>
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={"preset" in choice && choice.preset === p.key}
                onClick={() => onChange({ preset: p.key })}
                className="grid gap-px rounded-control border border-rule-2 bg-sheet px-2.5 py-2 text-left hover:bg-sunk aria-pressed:border-carbon aria-pressed:bg-carbon-tint aria-pressed:shadow-[inset_0_0_0_1px_var(--carbon)]"
              >
                <b className="text-sm font-bold">{p.name}</b>
                <span className="text-base font-medium">{rateText(rates[i]!)} sat/vB</span>
                <span className="text-xs text-ink-3">{eta(blocks(rates[i]!))}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          Custom rate
        </label>
        <span className={`inline-flex overflow-hidden rounded-control border bg-sheet ${invalid ? "border-bad" : "border-rule-2"}`}>
          <button type="button" aria-label="Lower fee rate" className={stepper} onClick={() => set(rate - 1)}>
            −
          </button>
          <input
            id={id}
            inputMode="decimal"
            value={text}
            aria-invalid={invalid}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value.replace(",", "."));
              if (n >= floor && n <= MAX_FEE_RATE) onChange({ manual: n });
            }}
            className="min-h-10 w-16 border-x border-rule bg-transparent text-center tabular-nums outline-none focus:bg-carbon-tint"
          />
          <button type="button" aria-label="Raise fee rate" className={stepper} onClick={() => set(rate + 1)}>
            +
          </button>
        </span>
        <span className={`text-sm ${invalid ? "text-bad" : "text-ink-3"}`}>
          {invalid ? `Enter a rate from ${rateText(floor)} sat/vB` : `sat/vB, ${eta(blocks(rate))}`}
        </span>
      </div>
    </Panel>
  );
}
