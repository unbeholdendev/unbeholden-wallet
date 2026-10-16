import { useState, type FormEvent } from "react";
import { Heading, Page } from "../app/layout";
import { useVaultState } from "../app/vault";
import { WrongPassphrase } from "../vault/vault";
import { Button, Field, LinkButton } from "../ui/kit";
import { DestroyVault } from "./DestroyVault";
import { PassphraseInput } from "./passphrase";

export function Unlock() {
  const { unlock } = useVaultState();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(passphrase);
    } catch (e) {
      setError(
        e instanceof WrongPassphrase
          ? "That passphrase does not open this vault. Check caps lock and try again."
          : (e as Error).message,
      );
      setBusy(false);
    }
  };

  return (
    <Page>
      <form onSubmit={submit} className="grid w-full max-w-[400px] gap-4" noValidate>
        <Heading title="Unlock your wallets">Enter the passphrase you set for this browser.</Heading>
        <Field label="Passphrase" error={error ?? undefined}>
          {(props) => (
            <PassphraseInput {...props} autoComplete="current-password" value={passphrase} onChange={setPassphrase} autoFocus />
          )}
        </Field>
        <Button type="submit" variant="primary" wide disabled={busy || !passphrase}>
          {busy ? "Unlocking" : "Unlock"}
        </Button>
        <p className="m-0 text-sm text-ink-3">
          Forgotten it? Nobody can recover it. <LinkButton onClick={() => setForgot(true)}>Delete the vault and start again</LinkButton>
        </p>
      </form>
      <DestroyVault open={forgot} onClose={() => setForgot(false)} />
    </Page>
  );
}
