import { useRef, useState } from "react";
import { hex } from "@scure/base";
import { BbqrDecoder } from "../../transport/bbqr";
import { readPsbt } from "../../transport/files";
import { psbtFromUr, psbtUrDecoder } from "../../transport/ur";
import { Icon } from "../../ui/icons";
import { Button, buttonClass, inputClass, Notice } from "../../ui/kit";
import { QrScanner } from "../../ui/QrScanner";

/** A PSBT, or a finished transaction in hex as a Coldcard Q shows one. */
function readSigned(text: string): Uint8Array {
  try {
    return readPsbt(text);
  } catch (e) {
    const compact = text.replace(/\s+/g, "");
    if (/^([0-9a-f]{2})+$/i.test(compact)) return hex.decode(compact.toLowerCase());
    throw e;
  }
}

/** `onSigned` gets a PSBT, or a finished transaction when the signer sent one. */
export function ScanBack({ onSigned, error }: { onSigned: (signed: Uint8Array) => void; error: string | null }) {
  const decoder = useRef(psbtUrDecoder());
  const bbqr = useRef(new BbqrDecoder());
  const [progress, setProgress] = useState({ parts: [] as number[], expected: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const restart = () => {
    decoder.current = psbtUrDecoder();
    bbqr.current = new BbqrDecoder();
    setProgress({ parts: [], expected: 0 });
  };

  const onResult = (text: string) => {
    const d = decoder.current;
    const b = bbqr.current;
    if (b.receive(text)) {
      setScanError(null);
      setProgress({ parts: b.parts, expected: b.expected });
      if (!b.done) return;
      restart();
      if (b.type !== "P" && b.type !== "T") return setScanError("This code holds neither a PSBT nor a transaction.");
      b.result().then(onSigned, () => setScanError("This code could not be read. Starting the scan again."));
      return;
    }
    if (!/^ur:/i.test(text.trim())) {
      try {
        onSigned(readSigned(text));
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
    if (!d.result) return;
    restart();
    onSigned(psbtFromUr(d.result));
  };

  const read = (input: Uint8Array | string) => {
    try {
      setReadError(null);
      onSigned(typeof input === "string" ? readSigned(input) : readPsbt(input));
    } catch (e) {
      setReadError((e as Error).message);
    }
  };

  const captured = new Set(progress.parts);
  return (
    <>
      <div className="w-full @min-[900px]:row-span-5">
        <QrScanner onResult={onResult} onBlocked={setBlocked} />
      </div>
      <div hidden={blocked} className="grid gap-1">
        <h2 className="text-md font-bold">Point your camera at the signer</h2>
        <p className="m-0 max-w-[60ch] text-sm text-ink-3">Keep the signed code in view. Parts arrive in any order; gaps fill in as the code loops.</p>
      </div>
      <div hidden={blocked} className="grid gap-2" aria-live="polite">
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
              <i key={i} className={`aspect-[1.6] rounded-[2px] border ${captured.has(i) ? "border-carbon bg-carbon" : "border-rule-2 bg-sheet"}`} />
            ))}
          </div>
        )}
      </div>
      {(error ?? scanError) && <Notice tone="bad">{error ?? scanError}</Notice>}
      <details open={blocked || undefined} className="group grid gap-3 rounded-control border border-rule p-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-carbon [&::-webkit-details-marker]:hidden">No camera? Load the signed file or paste it</summary>
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
