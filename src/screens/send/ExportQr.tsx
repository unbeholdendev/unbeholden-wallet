import { useEffect, useMemo, useState } from "react";
import { psbtFile } from "../../transport/files";
import { qrPath } from "../../transport/qr";
import { psbtUrEncoder } from "../../transport/ur";
import { Segmented } from "../../ui/kit";

// CBOR bytes per QR part: a SeedSigner reads the low setting reliably, a phone camera the high one.
const DENSITY = { low: 80, medium: 160, high: 320 };
type Density = keyof typeof DENSITY;
const SPEEDS = [2, 4, 6, 8];
const PREFS = "qr-export";

function loadPrefs(): { fps: number; density: Density } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    return { fps: SPEEDS.includes(saved.fps) ? saved.fps : 4, density: saved.density in DENSITY ? saved.density : "medium" };
  } catch {
    return { fps: 4, density: "medium" };
  }
}

function savePrefs(prefs: { fps: number; density: Density }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    // Private browsing: the choice lasts for this page only.
  }
}

export function ExportQr({ psbt }: { psbt: Uint8Array }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const counts = useMemo(
    () => Object.fromEntries(Object.entries(DENSITY).map(([k, n]) => [k, psbtUrEncoder(psbt, n).seqLen])) as Record<Density, number>,
    [psbt],
  );
  const encoder = useMemo(() => psbtUrEncoder(psbt, DENSITY[prefs.density]), [psbt, prefs.density]);
  const [part, setPart] = useState(() => encoder.nextPart());
  useEffect(() => {
    setPart(encoder.nextPart());
    if (encoder.seqLen === 1) return;
    const timer = setInterval(() => setPart(encoder.nextPart()), 1000 / prefs.fps);
    return () => clearInterval(timer);
  }, [encoder, prefs.fps]);
  const change = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };
  const seq = Number(/\/(\d+)-\d+\//.exec(part)?.[1] ?? 1);
  const at = ((seq - 1) % encoder.seqLen) + 1;
  const qr = useMemo(() => qrPath(part.toUpperCase()), [part]);

  return (
    <>
      <div data-keep-unlocked className="mx-auto aspect-square w-full max-w-[calc(100svh-2rem)] rounded-control bg-qr p-1.5 shadow-[0_0_0_1px_var(--rule-2)] @min-[900px]:row-span-5">
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code, part ${at} of ${encoder.seqLen}`} className="block size-full">
          <path d={qr.d} className="fill-qr-ink" />
        </svg>
      </div>
      <div className="grid gap-1">
        <h2 className="text-md font-semibold">Show this to your signer</h2>
        <p className="m-0 max-w-[60ch] text-sm text-ink-3">
          On a SeedSigner choose Scan, then hold this screen steady in front of its camera. The code cycles through every part; the signer collects them in any order.
        </p>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-medium" aria-live="off">
            {encoder.seqLen === 1 ? "One part" : <>Part {at} <small className="text-md font-normal text-ink-2">of {encoder.seqLen}</small></>}
          </span>
          <span className="text-sm text-ink-3">{encoder.seqLen === 1 ? "Nothing to animate" : `${prefs.fps} frames a second`}</span>
        </div>
        {encoder.seqLen > 1 && (
          <div aria-hidden="true">
            <div className="grid h-2.5 auto-cols-fr grid-flow-col border border-ink">
              {Array.from({ length: encoder.seqLen }, (_, i) => (
                <i key={i} className={i + 1 === at ? "bg-route" : i % 2 ? "bg-sheet" : "bg-ink"} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-ink-3">
              <span>1</span>
              <span>{encoder.seqLen} parts</span>
            </div>
          </div>
        )}
      </div>
      <details className="grid rounded-control border border-rule p-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-route [&::-webkit-details-marker]:hidden">Signer can't read it?</summary>
        <div className="mt-3 grid gap-3.5">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Speed, frames per second</span>
            <Segmented label="Speed, frames per second" value={String(prefs.fps)} onChange={(v) => change({ fps: Number(v) })} options={SPEEDS.map((f) => ({ value: String(f), label: f }))} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Density</span>
            <Segmented
              label="Density"
              value={prefs.density}
              onChange={(density) => change({ density })}
              options={(Object.keys(DENSITY) as Density[]).map((k) => ({ value: k, label: `${k[0]!.toUpperCase()}${k.slice(1)}, ${counts[k]} part${counts[k] === 1 ? "" : "s"}` }))}
            />
            <p className="m-0 text-sm text-ink-3">Lower density is easier for a weak camera to read but takes longer.</p>
          </div>
        </div>
      </details>
    </>
  );
}

export function download(psbt: Uint8Array) {
  const file = psbtFile(psbt);
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
