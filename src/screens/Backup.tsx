import { useState, type FormEvent } from "react";
import { useVault } from "../app/vault";
import type { Merged } from "../core/wallets";
import { Icon } from "../ui/icons";
import { Button, buttonClass, Field, Notice } from "../ui/kit";
import { useToast } from "../ui/toast";
import { WrongPassphrase } from "../vault/vault";
import { PassphraseInput } from "./passphrase";

export function download(body: string, type: string, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([body], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function report({ added, skipped, labels, kept }: Merged) {
  return [
    added.length ? `Added ${added.join(", ")}.` : "No new wallets.",
    skipped.length && `Already here, so skipped: ${skipped.join(", ")}.`,
    labels && `${count(labels, "label")} added.`,
    kept && `${count(kept, "label")} differed from the backup; kept the ones here.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ExportBackup() {
  const { exportBackup } = useVault();
  const toast = useToast();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      download(await exportBackup(passphrase), "application/json", "wallet-backup.json");
      setPassphrase("");
      toast("Backup saved");
    } catch (e) {
      setError(e instanceof WrongPassphrase ? "That is not the vault passphrase." : (e as Error).message);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <p className="m-0 text-sm text-ink-2">
        Every wallet's descriptor with its labels, frozen coins and your settings, in one file encrypted with the vault
        passphrase. History is left out; your server sends it again.
      </p>
      <Field label="Vault passphrase, to confirm" error={error ?? undefined}>
        {(props) => <PassphraseInput {...props} autoComplete="current-password" value={passphrase} onChange={setPassphrase} />}
      </Field>
      <Button type="submit" icon="download" className="justify-self-start" disabled={busy || !passphrase}>
        {busy ? "Encrypting" : "Download backup"}
      </Button>
    </form>
  );
}

export function RestoreBackup() {
  const { restoreBackup, draft } = useVault();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(report(await restoreBackup(await file!.text(), passphrase)));
      setPassphrase("");
    } catch (e) {
      setError(e instanceof WrongPassphrase ? "The passphrase is not right for this backup." : (e as Error).message);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <p className="m-0 text-sm text-ink-2">
        {draft
          ? "Bring your wallets, labels and settings from a backup file. Its passphrase becomes this vault's."
          : "Adds the wallets this vault does not have and the labels it lacks. Nothing here is replaced."}
      </p>
      <label className={`${buttonClass({})} cursor-pointer justify-self-start`}>
        <Icon name="upload" />
        {file ? file.name : "Choose backup file"}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setDone(null);
            setError(null);
          }}
        />
      </label>
      <Field label="Passphrase of the backup">
        {(props) => <PassphraseInput {...props} autoComplete="off" value={passphrase} onChange={setPassphrase} />}
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
      <Button type="submit" className="justify-self-start" disabled={busy || !file || !passphrase}>
        {busy ? "Decrypting, this takes a few seconds" : "Restore"}
      </Button>
    </form>
  );
}
