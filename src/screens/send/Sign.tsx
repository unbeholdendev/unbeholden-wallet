import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnection } from "../../app/connection";
import { navigate } from "../../app/route";
import { useWalletSession, useWalletSnapshot } from "../../app/session";
import { useVault } from "../../app/vault";
import { walletDescriptor } from "../../core/wallets";
import { psbtFile, readPsbt } from "../../transport/files";
import { qrPath } from "../../transport/qr";
import { psbtFromUr, psbtUrDecoder, psbtUrEncoder } from "../../transport/ur";
import { Amount, groupSats } from "../../ui/amount";
import { Icon } from "../../ui/icons";
import { Button, buttonClass, Chip, inputClass, LinkButton, Notice, Panel, Segmented } from "../../ui/kit";
import { QrScanner } from "../../ui/QrScanner";
import { finaliseSigned, parsePsbt, reviewPsbt } from "../../wallet/psbt";
import { rateText } from "./fees";

type Stage = "check" | "show" | "scan" | "verified";

const STEPS: [Stage, string][] = [
  ["check", "Check"],
  ["show", "Show"],
  ["scan", "Scan back"],
  ["verified", "Broadcast"],
];

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

function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="m-0 grid">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-dotted border-rule-2 py-2 text-sm last:border-b-0">
          <dt className="text-ink-2">{k}</dt>
          <dd className="m-0 min-w-0 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExportQr({ psbt }: { psbt: Uint8Array }) {
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
      <div className="mx-auto aspect-square w-full max-w-[340px] rounded-control bg-qr p-1.5 shadow-[0_0_0_1px_var(--rule-2)] @min-[900px]:row-span-4 @min-[900px]:max-w-none">
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
      <div className="grid gap-3.5">
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
    </>
  );
}

function download(psbt: Uint8Array) {
  const file = psbtFile(psbt);
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ScanBack({ onSigned, error }: { onSigned: (psbt: Uint8Array) => void; error: string | null }) {
  const decoder = useRef(psbtUrDecoder());
  const [progress, setProgress] = useState({ parts: [] as number[], expected: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [readError, setReadError] = useState<string | null>(null);

  const restart = () => {
    decoder.current = psbtUrDecoder();
    setProgress({ parts: [], expected: 0 });
  };
  useEffect(() => {
    if (error) restart();
  }, [error]);

  const onResult = (text: string) => {
    const d = decoder.current;
    if (!/^ur:/i.test(text.trim())) {
      try {
        onSigned(readPsbt(text));
      } catch {}
      return;
    }
    if (!d.receive(text)) {
      if (d.error) {
        setScanError(`${d.error.message}. Starting the scan again.`);
        restart();
      }
      return;
    }
    setScanError(null);
    setProgress({ parts: d.parts, expected: d.progress.expected });
    if (d.result) onSigned(psbtFromUr(d.result));
  };

  const read = (input: Uint8Array | string) => {
    try {
      setReadError(null);
      onSigned(readPsbt(input));
    } catch (e) {
      setReadError((e as Error).message);
    }
  };

  const captured = new Set(progress.parts);
  return (
    <>
      <div className="w-full @min-[900px]:row-span-5">
        <QrScanner onResult={onResult} />
      </div>
      <div className="grid gap-1">
        <h2 className="text-md font-semibold">Point your camera at the signer</h2>
        <p className="m-0 max-w-[60ch] text-sm text-ink-3">Keep the signed code in view. Parts arrive in any order; gaps fill in as the code loops.</p>
      </div>
      <div className="grid gap-2" aria-live="polite">
        <span className="text-xl font-medium">
          {progress.expected ? (
            <>
              {captured.size} <small className="text-md font-normal text-ink-2">of {progress.expected} parts captured</small>
            </>
          ) : (
            <small className="text-md font-normal text-ink-2">Waiting for the first part</small>
          )}
        </span>
        {progress.expected > 0 && (
          <div aria-hidden="true" className="grid grid-cols-10 gap-[3px]">
            {Array.from({ length: progress.expected }, (_, i) => (
              <i key={i} className={`aspect-[1.6] rounded-[2px] border ${captured.has(i) ? "border-route bg-route" : "border-rule-2 bg-sheet"}`} />
            ))}
          </div>
        )}
      </div>
      {(error ?? scanError) && <Notice tone="bad">{error ?? scanError}</Notice>}
      <details className="group grid gap-3 rounded-control border border-rule p-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-route [&::-webkit-details-marker]:hidden">No camera? Load the signed file or paste it</summary>
        <div className="mt-3 grid gap-3">
          <label className={`${buttonClass({})} cursor-pointer justify-self-start`}>
            <Icon name="file" />
            Load signed file
            <input
              type="file"
              accept=".psbt,application/octet-stream,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) read(new Uint8Array(await file.arrayBuffer()));
              }}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-ink-2">
            Or paste it, base64 or hex
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} spellCheck={false} className={`${inputClass} font-mono text-[0.86em]`} />
          </label>
          <Button size="sm" className="justify-self-start" disabled={!pasted.trim()} onClick={() => read(pasted)}>
            Check pasted PSBT
          </Button>
          {readError && <Notice tone="bad">{readError}</Notice>}
        </div>
      </details>
    </>
  );
}

const host = (url: string) => url.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");

/**
 * Check, show to the signer, take the signed PSBT back, broadcast. `built` is
 * the unsigned PSBT the signed one has to match.
 */
export function SignFlow({
  built,
  title,
  warnings,
  summary,
  label,
  onBack,
}: {
  built: Uint8Array;
  title: string;
  warnings: string[];
  /** Extra facts for the check step, such as where the coins come from. */
  summary: [ReactNode, ReactNode][];
  label: string;
  onBack: () => void;
}) {
  const { wallets, walletId } = useVault();
  const wallet = wallets.find((w) => w.id === walletId)!;
  const snapshot = useWalletSnapshot();
  const session = useWalletSession();
  const { backend, connection } = useConnection();
  const [stage, setStage] = useState<Stage>("check");
  const [raw, setRaw] = useState<Uint8Array | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const review = useMemo(() => reviewPsbt(built, walletDescriptor(wallet), wallet.network), [built, wallet]);
  const paths = new Map([...(snapshot?.addresses.receive ?? []), ...(snapshot?.addresses.change ?? [])].map((a) => [a.address, a.path]));
  const inputs = useMemo(() => parsePsbt(built).inputsLength, [built]);

  const signed = (psbt: Uint8Array) => {
    try {
      setRaw(finaliseSigned(built, psbt));
      setRefusal(null);
      setFailure(null);
      setStage("verified");
    } catch (e) {
      setRefusal(`This PSBT was refused: ${(e as Error).message}.`);
    }
  };

  const broadcast = async () => {
    if (!backend || !raw || !session) return;
    setSending(true);
    setFailure(null);
    try {
      const txid = await backend.broadcast(raw);
      await session.addTransaction(raw);
      if (label) await session.setLabel("tx", txid, label);
      navigate(`/tx/${txid}`);
    } catch (e) {
      setFailure((e as Error).message);
      setSending(false);
    }
  };

  const at = STEPS.findIndex(([s]) => s === stage);
  const payments = review.outputs.filter((o) => !o.change);
  const facts: [ReactNode, ReactNode][] = [
    ["Sending", <Amount sats={payments.reduce((a, o) => a + o.value, 0)} />],
    ["Fee", `${groupSats(review.fee)} sats, ${rateText(review.feeRate)} sat/vB`],
    ["Change", review.outputs.some((o) => o.change) ? <Amount sats={review.outputs.find((o) => o.change)!.value} /> : "None"],
    ...summary,
    ["Replaceable", "Yes (RBF)"],
  ];

  const check = (
    <Panel title="Check before you sign" aside={`${review.outputs.length} output${review.outputs.length === 1 ? "" : "s"}`}>
      <ul className="m-0 grid list-none gap-2 p-0">
        {review.outputs.map((o, i) => (
          <li key={i} className={`grid gap-1 rounded-control border px-3 py-2.5 ${o.change ? "border-rule bg-sunk" : "border-rule-2"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-ink-2">
                {o.change ? "Change back to you" : o.mine ? "To one of your own addresses" : `Payment ${payments.indexOf(o) + 1}`}
              </span>
              <span className="text-md font-medium">
                <Amount sats={o.value} unit />
              </span>
            </div>
            <span className="font-mono text-[0.86em] break-all">{o.address ?? "A script with no address"}</span>
            {o.mine && o.address && paths.get(o.address) && <span className="font-mono text-xs text-ink-3">{paths.get(o.address)}</span>}
          </li>
        ))}
      </ul>
      <Facts
        rows={[
          ["Fee", `${groupSats(review.fee)} sats`],
          ["Fee rate", `${rateText(review.feeRate)} sat/vB, about ${review.vsize} vB`],
          ...summary,
          ["Total leaving the wallet", <Amount sats={payments.filter((o) => !o.mine).reduce((a, o) => a + o.value, 0) + review.fee} unit />],
        ]}
      />
      <p className="m-0 text-sm text-ink-2">
        <Chip tone="route">Replaceable (RBF)</Chip> Every transaction this wallet builds can be replaced, so you can raise its fee later if it is slow to confirm.
      </p>
      {warnings.map((w) => (
        <Notice key={w} tone="warn">{w}</Notice>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setStage("show")}>
          Looks right, show to signer
        </Button>
        <Button onClick={onBack}>Change it</Button>
      </div>
    </Panel>
  );

  const body =
    stage === "check" ? (
      check
    ) : (
      <section className="grid justify-items-stretch gap-4 rounded-panel border border-rule bg-sheet p-4 @min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] @min-[900px]:items-start @min-[900px]:gap-x-8 @min-[900px]:gap-y-5 @min-[900px]:p-6">
        {stage === "show" && (
          <>
            <ExportQr psbt={built} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="camera" onClick={() => setStage("scan")}>
                Signed it, scan it back
              </Button>
              <Button icon="file" onClick={() => download(built)}>
                Save PSBT file
              </Button>
            </div>
          </>
        )}
        {stage === "scan" && (
          <>
            <ScanBack onSigned={signed} error={refusal} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStage("show")}>Back to the code</Button>
            </div>
          </>
        )}
        {stage === "verified" && (
          <div className="grid gap-4 @min-[900px]:col-span-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-md font-semibold">Signed and checked</h2>
              <Chip tone="ok">Ready to broadcast</Chip>
            </div>
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {[
                ["Every input is signed", `${inputs} of ${inputs}`],
                ["Outputs match what you built", `${review.outputs.length} of ${review.outputs.length}`],
                ["Fee matches", `${groupSats(review.fee)} sats`],
              ].map(([what, detail]) => (
                <li key={what} className="grid grid-cols-[24px_1fr_auto] items-center gap-2.5 rounded-control border border-rule px-3 py-2.5">
                  <span className="grid size-[22px] place-items-center rounded-full bg-ok text-sheet">
                    <Icon name="check" className="size-3.5 stroke-[2.6]" />
                  </span>
                  <span>{what}</span>
                  <small className="text-sm text-ink-3">{detail}</small>
                </li>
              ))}
            </ul>
            <p className="m-0 text-sm text-ink-3">
              {connection.phase === "connected"
                ? `Broadcasting sends the transaction to ${host(connection.url)} only. Your server relays it to the network.`
                : "Not connected to your server, so there is nowhere to broadcast. Reconnect, then try again."}
            </p>
            {failure && (
              <div role="alert" className="grid gap-1.5 rounded-control bg-bad-tint px-3 py-2.5 text-sm text-bad">
                <b className="font-semibold">Your node refused this transaction. Its reason:</b>
                <span className="font-mono text-[0.86em] break-words">{failure}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={broadcast} disabled={sending || !backend || connection.phase !== "connected"}>
                {sending ? "Broadcasting" : "Broadcast through your server"}
              </Button>
              <Button variant="danger" onClick={onBack} className="ml-auto">
                Discard
              </Button>
            </div>
          </div>
        )}
      </section>
    );

  return (
    <div className="@container grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="m-0 text-xl font-semibold">{title}</h1>
        <LinkButton onClick={onBack}>Back to coins</LinkButton>
      </div>
      <nav aria-label="Signing steps" className="flex overflow-hidden rounded-panel border border-rule-2 bg-sheet @min-[900px]:max-w-[720px]">
        {STEPS.map(([s, name], i) => (
          <button
            key={s}
            type="button"
            aria-current={s === stage ? "step" : undefined}
            disabled={s === "verified" ? !raw : false}
            onClick={() => setStage(s)}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 border-l border-rule px-1 text-sm font-medium text-ink-3 first:border-l-0 disabled:cursor-not-allowed aria-[current=step]:bg-route-tint aria-[current=step]:text-ink"
          >
            <i className={`grid size-5 flex-none place-items-center rounded-full border-[1.5px] border-current text-[11px] font-semibold not-italic ${s === stage ? "border-route bg-route text-route-ink" : i < at ? "text-ink-2" : ""}`}>
              {i < at ? <Icon name="check" className="size-3 stroke-[2.6]" /> : i + 1}
            </i>
            {name}
          </button>
        ))}
      </nav>
      <div className="grid gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_340px] @min-[900px]:items-start">
        {body}
        {stage !== "check" && <Panel title={title}><Facts rows={facts} /></Panel>}
      </div>
    </div>
  );
}
