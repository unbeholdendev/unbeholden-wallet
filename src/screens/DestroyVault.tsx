import { useState } from "react";
import { useVaultState } from "../app/vault";
import { Button, Field, inputClass } from "../ui/kit";
import { Sheet } from "../ui/sheet";

const WORD = "delete";

export function DestroyVault({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { destroy } = useVaultState();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title="Delete the vault and every wallet in it">
      <div className="grid gap-3 text-ink-2">
        <p className="m-0">
          This removes every wallet, label and setting from this browser. It can't be undone, and nothing is kept
          anywhere else.
        </p>
        <p className="m-0">
          Your coins aren't affected: they stay on the chain, under your signer's keys. To see them here again you'll
          need each wallet's descriptor. Labels you haven't exported are lost.
        </p>
      </div>
      <Field
        label={`Type ${WORD} to confirm`}
        error={failed ? "Another tab still has this app open. Close it and the vault will be deleted." : undefined}
      >
        {(props) => (
          <input {...props} className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={close}>Keep the vault</Button>
        <Button
          variant="danger"
          disabled={typed.trim().toLowerCase() !== WORD || busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await destroy();
              location.hash = "#/";
            } catch {
              setFailed(true);
              setBusy(false);
            }
          }}
        >
          Delete everything
        </Button>
      </div>
    </Sheet>
  );
}
