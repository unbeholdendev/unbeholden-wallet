import { type FormEvent, useState } from "react";
import { useVault } from "../../app/vault";
import { Button, Field, Notice } from "../../ui/kit";
import { useToast } from "../../ui/toast";
import { VaultChanged, WrongPassphrase } from "../../vault/vault";
import { MIN_LENGTH, NO_PASSPHRASE, PassphraseInput, Strength, strength } from "../passphrase";

export function ChangePassphrase() {
  const { changePassphrase, passphrase } = useVault();
  const toast = useToast();
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const score = strength(next);

  const change = async (to: string | null, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await changePassphrase(passphrase ? old : null, to);
      setOld("");
      setNext("");
      toast(done);
    } catch (e) {
      setError(
        e instanceof WrongPassphrase
          ? "The current passphrase isn't right."
          : e instanceof VaultChanged
            ? "Another tab changed the vault meanwhile. Nothing was changed; try again."
            : (e as Error).message,
      );
    }
    setBusy(false);
  };

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (score.level) change(next, passphrase ? "Passphrase changed" : "Passphrase set");
      }}
      className="grid gap-3"
      noValidate
    >
      {passphrase ? (
        <Field label="Current passphrase" error={error ?? undefined}>
          {(props) => <PassphraseInput {...props} autoComplete="current-password" value={old} onChange={setOld} />}
        </Field>
      ) : (
        <Notice tone="warn">{NO_PASSPHRASE}</Notice>
      )}
      <Field
        label="New passphrase"
        hint={<Strength score={score} />}
        error={passphrase ? undefined : (error ?? undefined)}
      >
        {(props) => (
          <PassphraseInput
            {...props}
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            minLength={MIN_LENGTH}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || (passphrase && !old) || score.level === 0}>
          {busy ? "Saving" : passphrase ? "Change passphrase" : "Set passphrase"}
        </Button>
        {passphrase && (
          <Button disabled={busy || !old} onClick={() => change(null, "Passphrase removed")}>
            Remove passphrase
          </Button>
        )}
      </div>
    </form>
  );
}
