import { useState } from "react";
import { useConnection } from "../app/connection";
import { FiatControl } from "../app/fiat";
import { IDLE_DEFAULT_MINUTES, useVault } from "../app/vault";
import { APP_VERSION } from "../pwa/register";
import { Button, linkClass, Notice, Panel, Segmented } from "../ui/kit";
import { ExportBackup, RestoreBackup } from "./Backup";
import { DestroyVault } from "./DestroyVault";
import { AddressBook } from "./settings/AddressBook";
import { ChangePassphrase } from "./settings/ChangePassphrase";
import { Explorer } from "./settings/Explorer";
import { Labels } from "./settings/Labels";
import { Notifications } from "./settings/Notifications";
import { Wallets } from "./settings/Wallets";

const idleOptions = [1, 5, 15, 60].map((m) => ({ value: String(m), label: m === 60 ? "1 hour" : `${m} min` }));

const persistenceText = {
  persisted: { tone: "ok" as const, text: "The browser will keep this site's data until you delete it." },
  denied: {
    tone: "warn" as const,
    text: "The browser hasn't promised to keep this site's data, and may delete it when space runs low. Keep your descriptors backed up. Installing the app or bookmarking it can make the browser keep it.",
  },
  unsupported: {
    tone: "warn" as const,
    text: "This browser doesn't say whether it will keep this site's data. Keep your descriptors backed up.",
  },
};

export function Settings() {
  const { settings, saveSettings, lock, passphrase, persistence } = useVault();
  const { connection } = useConnection();
  const [destroying, setDestroying] = useState(false);
  const status = persistence && persistenceText[persistence];

  return (
    <div className="grid max-w-[1040px] gap-6 @min-[900px]:grid-cols-2">
      <h1 className="m-0 text-xl font-bold @min-[900px]:col-span-2">Settings</h1>
      <div className="grid content-start gap-6">
        <Panel title="Server" aside={connection.phase === "connected" ? "Connected" : "Not connected"}>
          <p className="m-0 font-mono text-[0.86em] break-all">{settings.server ?? "None yet"}</p>
          <a className={linkClass} href="#/connect">
            Change server or see the connection
          </a>
        </Panel>
        <Panel title="Fiat prices">
          <FiatControl />
        </Panel>
        <Explorer />
        <Wallets />
        <Labels />
        <AddressBook />
        <Panel title="Storage">
          {status ? (
            <Notice tone={status.tone}>{status.text}</Notice>
          ) : (
            <p className="m-0 text-sm text-ink-3">Asking the browser.</p>
          )}
        </Panel>
        <Panel title="About">
          <p className="m-0 text-sm text-ink-2">
            Version <span className="font-mono">{APP_VERSION}</span>. Compare it with the published release before
            trusting a hosted copy with real money.
          </p>
          <a className={linkClass} href="#/trust">
            What this app can and can't protect you from
          </a>
          <a className={linkClass} href="#/guide">
            Reaching your node: certificates and the local container
          </a>
        </Panel>
      </div>
      <div className="grid content-start gap-6">
        {passphrase && (
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
        )}
        <Panel title="Spending">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!settings.skipForeignUnconfirmed}
              onChange={(e) => void saveSettings({ skipForeignUnconfirmed: !e.target.checked })}
              className="size-4 accent-carbon"
            />
            Spend unconfirmed payments from others
          </label>
          <p className="m-0 text-sm text-ink-2">
            Until it confirms, the sender can replace a payment, and a transaction that spends it fails with it. Off,
            they're left out of automatic picks and Max, and you're asked before picking one. Your own unconfirmed
            change is spent either way.
          </p>
        </Panel>
        <Notifications />
        <Panel title="Passphrase">
          <ChangePassphrase />
        </Panel>
        <Panel title="Backup">
          <ExportBackup />
        </Panel>
        <Panel title="Restore from a backup">
          <RestoreBackup />
        </Panel>
        <Panel title="Delete the vault">
          <p className="m-0 text-sm text-ink-2">
            Removes every wallet, label and setting from this browser. Your coins aren't affected.
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
