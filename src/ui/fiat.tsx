import { useState } from "react";
import { type Currency, currencies, type FiatSettings, priceSources } from "../app/fiat";
import { useVault } from "../app/vault";
import { Button, Field, inputClass, LinkButton, Notice } from "./kit";
import { Sheet } from "./sheet";

export function FiatControl() {
  const { settings, saveSettings } = useVault();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<FiatSettings["source"] | "">(settings.fiat?.source ?? "");
  const [currency, setCurrency] = useState<Currency>(settings.fiat?.currency ?? "USD");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (fiat: FiatSettings | null) => {
    setBusy(true);
    setError(false);
    try {
      await saveSettings({ fiat });
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <LinkButton
        className="justify-self-start text-sm"
        onClick={() => {
          setSource(settings.fiat?.source ?? "");
          setCurrency(settings.fiat?.currency ?? "USD");
          setOpen(true);
        }}
      >
        {settings.fiat ? "Fiat price settings" : "Show fiat value"}
      </LinkButton>
      <Sheet open={open} onClose={() => setOpen(false)} title="Fiat prices">
        <p className="m-0 text-sm text-ink-2">
          {import.meta.env.MODE === "demo"
            ? "The demo uses made-up prices and contacts no price service."
            : "Your chosen service will see your IP address and when you request prices. mempool.space also sees your currency, as it sends that currency's price history. Wallet addresses and balances stay in this browser. Prices refresh every five minutes while the vault is unlocked."}
        </p>
        <Field label="Price source">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={source}
              onChange={(e) => setSource(e.target.value as FiatSettings["source"])}
            >
              <option value="" disabled>
                Choose a service
              </option>
              {Object.entries(priceSources).map(([value, item]) => (
                <option key={value} value={value}>
                  {item!.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Currency">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {currencies.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          )}
        </Field>
        {import.meta.env.MODE !== "demo" && (
          <p className="m-0 text-sm text-ink-3">
            With mempool.space, past transactions use its price history, downloaded once a day. Blockchain.com offers
            current prices only.
          </p>
        )}
        {error && <Notice tone="bad">Could not save your choice. Try again.</Notice>}
        <Button disabled={!source || busy} onClick={() => source && void save({ source, currency })}>
          {settings.fiat ? "Save fiat settings" : "Enable fiat prices"}
        </Button>
        {settings.fiat && (
          <Button disabled={busy} onClick={() => void save(null)}>
            Turn off fiat prices
          </Button>
        )}
      </Sheet>
    </>
  );
}
