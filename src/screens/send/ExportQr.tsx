import { useEffect, useMemo, useState } from "react";
import { bbqrParts } from "../../transport/bbqr";
import { psbtFile } from "../../transport/files";
import { qrPath } from "../../transport/qr";
import { psbtUrEncoder } from "../../transport/ur";
import { Segmented } from "../../ui/kit";

// PSBT bytes per QR part: a SeedSigner reads the low setting reliably, a phone camera the high one.
const DENSITY = { low: 80, medium: 160, high: 320 };
type Density = keyof typeof DENSITY;
type Format = "ur" | "bbqr";
type Prefs = { fps: number; density: Density; format: Format };
const SPEEDS = [2, 4, 6, 8];
const PREFS = "qr-export";

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    return {
      fps: SPEEDS.includes(saved.fps) ? saved.fps : 4,
      density: saved.density in DENSITY ? saved.density : "medium",
      format: saved.format === "bbqr" ? "bbqr" : "ur",
    };
  } catch {
    return { fps: 4, density: "medium", format: "ur" };
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    // Private browsing: the choice lasts for this page only.
  }
}

function encoderFor(psbt: Uint8Array, format: Format, bytes: number) {
  if (format === "ur") return psbtUrEncoder(psbt, bytes);
  const parts = bbqrParts(psbt, "P", bytes);
  let i = 0;
  return { seqLen: parts.length, nextPart: () => parts[i++ % parts.length]! };
}

export function ExportQr({ psbt }: { psbt: Uint8Array }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const counts = useMemo(
    () => Object.fromEntries(Object.entries(DENSITY).map(([k, n]) => [k, encoderFor(psbt, prefs.format, n).seqLen])) as Record<Density, number>,
    [psbt, prefs.format],
  );
  const encoder = useMemo(() => encoderFor(psbt, prefs.format, DENSITY[prefs.density]), [psbt, prefs.format, prefs.density]);
  const [part, setPart] = useState(() => encoder.nextPart());
  useEffect(() => {
    setPart(encoder.nextPart());
    if (encoder.seqLen === 1) return;
    const timer = setInterval(() => setPart(encoder.nextPart()), 1000 / prefs.fps);
    return () => clearInterval(timer);
  }, [encoder, prefs.fps]);
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    let gone = false;
    // The browser drops the lock whenever the tab is hidden, so take it again on return.
    const take = () => navigator.wakeLock?.request("screen").then((l) => void (gone ? l.release() : (lock = l)), () => {});
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      gone = true;
      lock?.release();
      document.removeEventListener("visibilitychange", take);
    };
  }, []);
  const change = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };
  const seq = Number(/\/(\d+)-\d+\//.exec(part)?.[1] ?? 1);
  const at = part.startsWith("B$") ? parseInt(part.slice(6, 8), 36) + 1 : ((seq - 1) % encoder.seqLen) + 1;
  const qr = useMemo(() => qrPath(part.toUpperCase()), [part]);

  return (
    <>
      <div data-keep-unlocked className="mx-auto aspect-square w-full max-w-[calc(100svh-2rem)] rounded-control bg-qr p-1.5 shadow-[0_0_0_1px_var(--rule-2)] @min-[900px]:row-span-5">
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code, part ${at} of ${encoder.seqLen}`} className="block size-full">
          <path d={qr.d} className="fill-qr-ink" />
        </svg>
      </div>
      <div className="grid gap-1">
        <h2 className="text-md font-bold">Show this to your signer</h2>
        <p className="m-0 max-w-[60ch] text-sm text-ink-3">
          On a SeedSigner choose Scan, then hold this screen steady in front of its camera. The code cycles through every part; the signer collects them in any order. A Coldcard Q reads BBQr: choose it under Signer can't read it.
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
                <i key={i} className={i + 1 === at ? "bg-carbon" : i % 2 ? "bg-sheet" : "bg-ink"} />
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
        <summary className="cursor-pointer list-none text-sm font-medium text-carbon [&::-webkit-details-marker]:hidden">Signer can't read it?</summary>
        <div className="mt-3 grid gap-3.5">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Format</span>
            <Segmented label="Format" value={prefs.format} onChange={(format) => change({ format })} options={[{ value: "ur", label: "UR" }, { value: "bbqr", label: "BBQr" }]} />
            <p className="m-0 text-sm text-ink-3">Most signers read UR. A Coldcard Q reads BBQr.</p>
          </div>
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
