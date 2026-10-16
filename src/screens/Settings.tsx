import { useState, type FormEvent } from "react";
import { useConnection } from "../app/connection";
import { IDLE_DEFAULT_MINUTES, useVault } from "../app/vault";
import { APP_VERSION } from "../pwa/register";
import { VaultChanged, WrongPassphrase } from "../vault/vault";
import { Button, buttonClass, Field, linkClass, Notice, Panel, Segmented } from "../ui/kit";
import { Icon } from "../ui/icons";
import { useWalletSession } from "../app/session";
import { useToast } from "../ui/toast";
import { DestroyVault } from "./DestroyVault";
import { MIN_LENGTH, PassphraseInput, Strength, strength } from "./passphrase";

const idleOptions = [1, 5, 15, 60].map((m) => ({ value: String(m), label: m === 60 ? "1 hour" : `${m} min` }));

const persistenceText = {
  persisted: { tone: "ok" as const, text: "The browser has agreed to keep this site's data until you delete it." },
  denied: {
    tone: "warn" as const,
    text: "The browser has not agreed to keep this site's data, and may delete it when space runs low. Keep your descriptors backed up. Installing the app or bookmarking it can change the browser's mind.",
  },
  unsupported: {
    tone: "warn" as const,
    text: "This browser does not say whether it will keep this site's data. Keep your descriptors backed up.",
  },
};

function ChangePassphrase() {
  const { changePassphrase } = useVault();
  const toast = useToast();
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const score = strength(next);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (score.level === 0) return;
    setBusy(true);
    setError(null);
    try {
      await changePassphrase(old, next);
      setOld("");
      setNext("");
      toast("Passphrase changed");
    } catch (e) {
      setError(
        e instanceof WrongPassphrase
          ? "The current passphrase is not right."
          : e instanceof VaultChanged
            ? "Another tab changed the vault meanwhile. Nothing was changed; try again."
            : (e as Error).message,
      );
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <Field label="Current passphrase" error={error ?? undefined}>
        {(props) => <PassphraseInput {...props} autoComplete="current-password" value={old} onChange={setOld} />}
      </Field>
      <Field label="New passphrase" hint={<Strength score={score} />}>
        {(props) => <PassphraseInput {...props} autoComplete="new-password" value={next} onChange={setNext} minLength={MIN_LENGTH} />}
      </Field>
      <Button type="submit" className="justify-self-start" disabled={busy || !old || score.level === 0}>
        {busy ? "Re-encrypting" : "Change passphrase"}
      </Button>
    </form>
  );
}

function Labels() {
  const session = useWalletSession();
  const { wallets, walletId } = useVault();
  const [report, setReport] = useState<string | null>(null);
  const name = wallets.find((w) => w.id === walletId)?.name ?? "wallet";

  const exportLabels = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([session!.exportLabels()], { type: "application/jsonl" }));
    link.download = `${name.replace(/[^\w-]+/g, "-")}-labels.jsonl`;
    link.click();
  };
  const importLabels = async (file: File | undefined) => {
    if (!file || !session) return;
    const { imported, skipped } = await session.importLabels(await file.text());
    setReport(
      `Imported ${imported === 1 ? "1 label" : `${imported} labels`}` +
        (skipped ? `, skipped ${skipped} that were unreadable or belong to another wallet.` : "."),
    );
  };

  return (
    <Panel title="Labels" aside={name}>
      <p className="m-0 text-sm text-ink-2">
        Labels and frozen coins, as a BIP329 file that Sparrow and other wallets read. Importing adds to the labels here
        and replaces any for the same thing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icon="download" disabled={!session} onClick={exportLabels}>
          Export labels
        </Button>
        <label className={`${buttonClass({})} cursor-pointer has-disabled:cursor-not-allowed`}>
          <Icon name="upload" />
          Import labels
          <input
            type="file"
            accept=".jsonl,.json,.txt,application/jsonl,application/json,text/plain"
            disabled={!session}
            className="sr-only"
            onChange={(e) => {
              void importLabels(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {report && <Notice tone="ok">{report}</Notice>}
    </Panel>
  );
}

export function Settings() {
  const { settings, saveSettings, lock, persistence, wallets } = useVault();
  const { connection } = useConnection();
  const [destroying, setDestroying] = useState(false);
  const status = persistence && persistenceText[persistence];

  return (
    <div className="grid max-w-[1040px] gap-6 @min-[900px]:grid-cols-2">
      <h1 className="m-0 text-xl font-semibold @min-[900px]:col-span-2">Settings</h1>
      <div className="grid content-start gap-6">
        <Panel title="Server" aside={connection.phase === "connected" ? "Connected" : "Not connected"}>
          <p className="m-0 font-mono text-[0.86em] break-all">{settings.server ?? "None yet"}</p>
          <a className={linkClass} href="#/connect">
            Change server or see the connection
          </a>
        </Panel>
        <Panel title="Wallets" aside={`${wallets.length} in this vault`}>
          <ul className="m-0 grid list-none gap-1 p-0">
            {wallets.map((w) => (
              <li key={w.id} className="flex justify-between gap-3 text-sm">
                <span className="font-medium">{w.name}</span>
                <span className="text-ink-3">{w.network}</span>
              </li>
            ))}
          </ul>
          <a className={linkClass} href="#/import">
            Add a wallet
          </a>
        </Panel>
        <Labels />
        <Panel title="Storage">
          {status ? <Notice tone={status.tone}>{status.text}</Notice> : <p className="m-0 text-sm text-ink-3">Asking the browser.</p>}
        </Panel>
        <Panel title="About">
          <p className="m-0 text-sm text-ink-2">
            Version <span className="font-mono">{APP_VERSION}</span>. Compare it with the published release before
            trusting a hosted copy with real money.
          </p>
          <a className={linkClass} href="#/trust">
            What this app can and cannot protect you from
          </a>
          <a className={linkClass} href="#/guide">
            Reaching your node: Tailscale and the local container
          </a>
        </Panel>
      </div>
      <div className="grid content-start gap-6">
        <Panel title="Lock">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Lock after this long without use</span>
            <Segmented
              label="Idle lock"
              options={idleOptions}
              value={String(settings.idleMinutes ?? IDLE_DEFAULT_MINUTES)}
              onChange={(v) => saveSettings({ idleMinutes: Number(v) })}
            />
          </div>
          <Button icon="lock" className="justify-self-start" onClick={lock}>
            Lock now
          </Button>
        </Panel>
        <Panel title="Passphrase">
          <ChangePassphrase />
        </Panel>
        <Panel title="Delete the vault">
          <p className="m-0 text-sm text-ink-2">
            Removes every wallet, label and setting from this browser. Your coins are not affected.
          </p>
          <Button variant="danger" className="justify-self-start" onClick={() => setDestroying(true)}>
            Delete the vault
          </Button>
        </Panel>
      </div>
      <DestroyVault open={destroying} onClose={() => setDestroying(false)} />
    </div>
  );
}
