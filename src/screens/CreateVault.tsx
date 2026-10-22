import { useState, type FormEvent } from "react";
import { Heading, Page } from "../app/layout";
import { useConnection } from "../app/connection";
import { useWallet, useWalletSnapshot } from "../app/session";
import { useVault } from "../app/vault";
import { Amount } from "../ui/amount";
import { Button, Field, inputClass, linkClass, Notice, Segmented } from "../ui/kit";
import { NO_PASSPHRASE, PassphraseInput, Strength, strength } from "./passphrase";

function Found() {
  const { record } = useWallet();
  const snapshot = useWalletSnapshot();
  const { phase } = useConnection().connection;
  const found = snapshot?.transactions.length ?? 0;
  const status =
    (phase !== "connected" && phase !== "connecting") || snapshot?.error
      ? "Not connected to your server."
      : !snapshot?.tip || snapshot.progress || phase === "connecting"
        ? "Still syncing with your server."
        : `${found === 1 ? "1 transaction" : `${found} transactions`} found.`;
  return (
    <section aria-label="Balance" className="grid gap-1 rounded-panel border border-rule bg-sheet px-4 pt-5 pb-4">
      <span className="text-sm text-ink-2">{record.name}, confirmed balance</span>
      <span className="text-2xl font-medium tracking-[-0.01em]">{snapshot ? <Amount sats={snapshot.balance.confirmed} unit /> : "Counting"}</span>
      <span role="status" className="text-sm text-ink-3">
        {status}
      </span>
    </section>
  );
}

export function CreateVault() {
  const { create } = useVault();
  const [none, setNone] = useState(false);
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
    if (!none && (tooShort || mismatch)) return;
    setBusy(true);
    setError(null);
    try {
      await create(none ? null : passphrase);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Page>
      <Heading title="Protect this wallet">
        So far it lives only in this tab. Set a passphrase to keep it, with its labels and history, encrypted in this
        browser. The passphrase never leaves the device.
      </Heading>
      <div className="grid items-start gap-8 @min-[900px]:grid-cols-[400px_minmax(0,1fr)] @min-[900px]:gap-12">
        <form onSubmit={submit} className="grid content-start gap-4" noValidate>
          <Found />
          <Segmented
            label="Protection"
            options={[
              { value: "passphrase", label: "Passphrase" },
              { value: "none", label: "No passphrase" },
            ]}
            value={none ? "none" : "passphrase"}
            onChange={(v) => setNone(v === "none")}
          />
          {none ? (
            <Notice tone="warn">{NO_PASSPHRASE}</Notice>
          ) : (
            <>
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
            </>
          )}
          {error && <p className="m-0 text-sm text-bad">{error}</p>}
          <Button type="submit" variant="primary" wide disabled={busy}>
            {none ? (busy ? "Saving" : "Keep without a passphrase") : busy ? "Encrypting, this takes a few seconds" : "Protect this wallet"}
          </Button>
        </form>
        <section className="grid content-start gap-3 rounded-panel border border-rule bg-sheet p-4 text-ink-2">
          <h2 className="m-0 text-md font-bold text-ink">There's no reset</h2>
          <p className="m-0">
            Nobody can recover this passphrase, including the people who made this app. If you forget it, you delete the
            vault and import your wallets again from their descriptors.
          </p>
          <p className="m-0">
            The vault holds no keys. Someone who opens it sees your balances and history, but can't spend.
          </p>
          <p className="m-0">Close this tab before you set it and nothing is kept.</p>
          <a className={linkClass} href="#/trust">
            What this app can and can't protect you from
          </a>
        </section>
      </div>
    </Page>
  );
}
