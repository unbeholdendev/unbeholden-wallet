import { useState, type FormEvent } from "react";
import { useConnection } from "../app/connection";
import { IDLE_DEFAULT_MINUTES, useVault } from "../app/vault";
import { APP_VERSION } from "../pwa/register";
import { VaultChanged, WrongPassphrase } from "../vault/vault";
import { Button, buttonClass, Field, inputClass, LinkButton, linkClass, Notice, Panel, Segmented } from "../ui/kit";
import { Sheet } from "../ui/sheet";
import { walletDescriptor, type WalletRecord } from "../core/wallets";
import { qrPath } from "../transport/qr";
import { formatDescriptor } from "../wallet/descriptor";
import { DescriptorBackup } from "./ImportWallet";
import { Icon } from "../ui/icons";
import { useWalletSession, useWalletSnapshot } from "../app/session";
import { historyCsv } from "../core/view";
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
  const snapshot = useWalletSnapshot();
  const { wallets, walletId } = useVault();
  const [report, setReport] = useState<string | null>(null);
  const name = wallets.find((w) => w.id === walletId)?.name ?? "wallet";

  const save = (body: string, type: string, suffix: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type }));
    link.download = `${name.replace(/[^\w-]+/g, "-")}-${suffix}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
    <Panel title="Labels and history" aside={name}>
      <p className="m-0 text-sm text-ink-2">
        Labels and frozen coins, as a BIP329 file that Sparrow and other wallets read. Importing adds to the labels here
        and replaces any for the same thing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icon="download" disabled={!session} onClick={() => save(session!.exportLabels(), "application/jsonl", "labels.jsonl")}>
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
      <p className="m-0 border-t border-rule pt-3 text-sm text-ink-2">
        Every transaction as a spreadsheet: date, txid, direction, amount and fee in BTC and sats, confirmations and
        label.
      </p>
      <Button
        icon="download"
        className="justify-self-start"
        disabled={!snapshot}
        onClick={() => save(historyCsv(snapshot!.transactions), "text/csv", "history.csv")}
      >
        Export history as CSV
      </Button>
    </Panel>
  );
}

function Wallets() {
  const { wallets, renameWallet, removeWallet } = useVault();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<WalletRecord | null>(null);
  const [showing, setShowing] = useState<WalletRecord | null>(null);
  const descriptor = showing && formatDescriptor(walletDescriptor(showing));
  const qr = descriptor && qrPath(descriptor, "medium");

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    await renameWallet(editing!, name.trim());
    setEditing(null);
  };
  const remove = async () => {
    await removeWallet(removing!.id);
    toast(`${removing!.name} removed`);
    setRemoving(null);
  };

  return (
    <Panel title="Wallets" aside={`${wallets.length} in this vault`}>
      <ul className="m-0 grid list-none gap-2 p-0">
        {wallets.map((w) =>
          editing === w.id ? (
            <li key={w.id}>
              <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={`New name for ${w.name}`}>
                    {(props) => <input {...props} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />}
                  </Field>
                </div>
                <Button type="submit" variant="primary" disabled={!name.trim()}>
                  Save
                </Button>
                <Button onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            </li>
          ) : (
            <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 flex-1 font-medium break-words">{w.name}</span>
              <span className="text-ink-3">{w.network}</span>
              <LinkButton
                aria-label={`Rename ${w.name}`}
                onClick={() => {
                  setName(w.name);
                  setEditing(w.id);
                }}
              >
                Rename
              </LinkButton>
              <LinkButton aria-label={`Descriptor of ${w.name}`} onClick={() => setShowing(w)}>
                Descriptor
              </LinkButton>
              <LinkButton aria-label={`Remove ${w.name}`} onClick={() => setRemoving(w)}>
                Remove
              </LinkButton>
            </li>
          ),
        )}
      </ul>
      <a className={linkClass} href="#/import">
        Add a wallet
      </a>
      <Sheet open={!!showing} onClose={() => setShowing(null)} title={`Descriptor of ${showing?.name ?? "this wallet"}`}>
        {showing && descriptor && qr && (
          <>
            <div className="grid justify-items-center rounded-panel border border-rule bg-qr p-4">
              <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code of the descriptor of ${showing.name}`} shapeRendering="crispEdges" className="aspect-square w-full max-w-[360px]">
                <path d={qr.d} className="fill-qr-ink" />
              </svg>
            </div>
            <DescriptorBackup name={showing.name} network={showing.network} descriptor={descriptor} />
            <p className="m-0 text-sm text-ink-3">It holds no keys: someone who sees it can see your balance and history, and cannot spend.</p>
          </>
        )}
      </Sheet>
      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? "this wallet"}`}>
        <div className="grid gap-3 text-ink-2">
          <p className="m-0">
            This removes the wallet from this browser, with its history, labels and frozen coins. Your coins are not
            affected.
          </p>
          <p className="m-0">To see it here again you will need its descriptor. Labels you have not exported are lost.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>Keep it</Button>
          <Button variant="danger" onClick={remove}>
            Remove the wallet
          </Button>
        </div>
      </Sheet>
    </Panel>
  );
}

export function Settings() {
  const { settings, saveSettings, lock, persistence } = useVault();
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
        <Wallets />
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
