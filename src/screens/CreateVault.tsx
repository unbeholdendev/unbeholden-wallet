import { useState, type FormEvent } from "react";
import { Heading, Page } from "../app/layout";
import { useVaultState } from "../app/vault";
import { Button, Field, inputClass, linkClass } from "../ui/kit";
import { PassphraseInput, Strength, strength } from "./passphrase";

export function CreateVault() {
  const { create } = useVaultState();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = strength(passphrase);
  const tooShort = score.level === 0;
  const mismatch = confirm !== passphrase;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (tooShort || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await create(passphrase);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Page>
      <Heading title="Set a passphrase for this browser">
        Your wallets, labels and history are kept here, encrypted with this passphrase. It never leaves the device.
      </Heading>
      <div className="grid items-start gap-8 @min-[900px]:grid-cols-[400px_minmax(0,1fr)] @min-[900px]:gap-12">
        <form onSubmit={submit} className="grid content-start gap-4" noValidate>
          <Field label="Passphrase" hint={<Strength score={score} />} error={tried && tooShort ? "Use at least 10 characters." : undefined}>
            {(props) => (
              <PassphraseInput {...props} autoComplete="new-password" value={passphrase} onChange={setPassphrase} autoFocus />
            )}
          </Field>
          <Field label="Type it again" error={tried && mismatch ? "The two passphrases are different." : undefined}>
            {(props) => (
              <input {...props} type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            )}
          </Field>
          {error && <p className="m-0 text-sm text-bad">{error}</p>}
          <Button type="submit" variant="primary" wide disabled={busy}>
            {busy ? "Encrypting, this takes a few seconds" : "Create vault"}
          </Button>
        </form>
        <section className="grid content-start gap-3 rounded-panel border border-rule bg-sheet p-4 text-ink-2">
          <h2 className="m-0 text-md font-semibold text-ink">There is no reset</h2>
          <p className="m-0">
            Nobody can recover this passphrase, including the people who made this app. If you forget it, you delete the
            vault and import your wallets again from their descriptors, which you will be asked to back up next.
          </p>
          <p className="m-0">
            The vault holds no keys. Someone who opens it sees your balances and history, and cannot spend.
          </p>
          <a className={linkClass} href="#/trust">
            What this app can and cannot protect you from
          </a>
        </section>
      </div>
    </Page>
  );
}
