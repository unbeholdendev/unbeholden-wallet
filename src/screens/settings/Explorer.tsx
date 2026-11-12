import { type FormEvent, useState } from "react";
import { explorerBase } from "../../app/explorer";
import { useVault } from "../../app/vault";
import { Button, Field, inputClass, Panel } from "../../ui/kit";
import { useToast } from "../../ui/toast";
import { NETWORKS, type Network } from "../../wallet/network";

export function Explorer() {
  const { settings, saveSettings, wallets, walletId } = useVault();
  const [network, setNetwork] = useState<Network>(wallets.find((w) => w.id === walletId)?.network ?? "mainnet");
  const [url, setUrl] = useState(settings.explorers?.[network] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const base = explorerBase(url);
      await saveSettings({ explorers: { ...settings.explorers, [network]: base } });
      setUrl(base);
      toast(base ? "Explorer saved" : "Explorer links turned off");
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Enter an http:// or https:// base URL without a login, query or fragment."
          : "Couldn't save the explorer. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Block explorer">
      <form onSubmit={save} className="grid gap-4" noValidate>
        <Field label="Explorer network">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={network}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as Network;
                setNetwork(next);
                setUrl(settings.explorers?.[next] ?? "");
                setError(null);
              }}
            >
              {Object.keys(NETWORKS).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Explorer URL"
          error={error}
          hint="Use your explorer's base URL, including its network path. Leave blank to hide links."
        >
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="url"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        <p className="m-0 text-sm text-ink-2">
          For explorers using /tx/ and /address/ paths, such as mempool and Esplora. Links open in a new tab. Opening
          one shares that transaction or address with the explorer. Nothing is sent until you follow a link.
        </p>
        <Button type="submit" disabled={busy} className="justify-self-start">
          {busy ? "Saving" : "Save explorer"}
        </Button>
      </form>
    </Panel>
  );
}
