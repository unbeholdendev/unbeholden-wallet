import { useRef, useState } from "react";
import { watchable } from "../../core/key-input";
import { descriptorsFromUr, descriptorUrDecoder } from "../../transport/ur";
import { Button, Notice } from "../../ui/kit";
import { QrScanner } from "../../ui/QrScanner";
import { Sheet } from "../../ui/sheet";

/** Scans a descriptor or key, as plain text or a UR, and asks which one when the signer sends several. */
export function ScanDescriptor({
  open,
  onClose,
  onScanned,
}: {
  open: boolean;
  onClose: () => void;
  onScanned: (descriptor: string) => void;
}) {
  const decoder = useRef(descriptorUrDecoder());
  const [progress, setProgress] = useState({ captured: 0, expected: 0 });
  const [choices, setChoices] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const closeScan = () => {
    onClose();
    decoder.current = descriptorUrDecoder();
    setProgress({ captured: 0, expected: 0 });
    setChoices([]);
    setScanError(null);
  };

  const take = (descriptor: string) => {
    onScanned(descriptor);
    closeScan();
  };

  const scanned = (result: string) => {
    const d = decoder.current;
    if (!/^ur:/i.test(result.trim())) return take(result);
    const restart = (error: Error) => {
      decoder.current = descriptorUrDecoder();
      setScanError(`${error.message}. Starting the scan again.`);
    };
    if (!d.receive(result)) return d.error && restart(d.error);
    setScanError(null);
    setProgress(d.progress);
    if (!d.result) return;
    try {
      const found = descriptorsFromUr(d.result);
      const supported = watchable(found);
      if (supported.length > 1) setChoices(supported);
      else take(supported[0] ?? found[0]!);
    } catch (error) {
      restart(error as Error);
    }
  };

  return (
    <Sheet open={open} onClose={closeScan} title="Scan the descriptor">
      {choices.length ? (
        <div className="grid gap-3">
          <p className="m-0 text-ink-2">
            Your signer sent this account for more than one script type. Choose the one your wallet uses: addresses
            starting bc1q are wpkh, bc1p are tr.
          </p>
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <Button key={choice} onClick={() => take(choice)}>
                {choice.startsWith("tr(") ? "Taproot, tr" : "Native SegWit, wpkh"}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {open && <QrScanner onResult={scanned} />}
          <p className="m-0 text-sm text-ink-3" aria-live="polite">
            {progress.expected > 1
              ? `${progress.captured} of ${progress.expected} parts captured. Keep the code in view while it loops.`
              : "Hold the QR code your signer shows inside the frame."}
          </p>
          {scanError && <Notice tone="bad">{scanError}</Notice>}
        </>
      )}
    </Sheet>
  );
}
