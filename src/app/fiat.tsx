import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import {
  type Currency,
  currencies,
  type FiatSettings,
  type History,
  parseHistory,
  priceAt,
  refreshed,
  stale,
  withSpot,
} from "../core/prices";
import type { WalletTx } from "../core/view";
import { type Key, readRecord, vaultKey, writeRecord } from "../core/wallets";
import { Button, Field, inputClass, LinkButton, Notice } from "../ui/kit";
import { Sheet } from "../ui/sheet";
import { useHidden, useVault, useVaultState } from "./vault";

type PriceSource = {
  name: string;
  current(signal: AbortSignal): Promise<Partial<Record<Currency, unknown>>>;
  history?(currency: Currency, signal: AbortSignal): Promise<unknown>;
};

async function get(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Price request failed");
  return response.json();
}

const DAY = 86400;
// UTC midnights around the demo fixture's blocks, July to October 2026.
const DEMO_START = 1_783_987_200;
const DEMO_END = 1_792_195_200;
const demoRates: Record<Currency, number> = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, AUD: 1.52, CHF: 0.88, JPY: 151 };
const demoPrices = (time: number) =>
  Object.fromEntries(
    currencies.map((currency) => [
      currency,
      Math.round(
        (62000 + 6000 * Math.sin(time / (9 * DAY)) + 2500 * Math.sin(time / (2.3 * DAY))) * demoRates[currency] * 100,
      ) / 100,
    ]),
  );

export const priceSources: Partial<Record<FiatSettings["source"], PriceSource>> =
  import.meta.env.MODE === "demo"
    ? {
        demo: {
          name: "Demo prices",
          current: async () => demoPrices(DEMO_END),
          history: async () => ({
            prices: Array.from({ length: (DEMO_END - DEMO_START) / DAY + 1 }, (_, day) => ({
              time: DEMO_START + day * DAY,
              ...demoPrices(DEMO_START + day * DAY),
            })),
          }),
        },
      }
    : {
        blockchain: {
          name: "Blockchain.com",
          current: async (signal) => {
            const body = await get("https://blockchain.info/ticker", signal);
            return Object.fromEntries(currencies.map((currency) => [currency, body?.[currency]?.last]));
          },
        },
        mempool: {
          name: "mempool.space",
          current: (signal) => get("https://mempool.space/api/v1/prices", signal),
          history: (currency, signal) =>
            get(`https://mempool.space/api/v1/historical-price?currency=${currency}`, signal),
        },
      };

type Quote = {
  source: FiatSettings["source"];
  rates: Partial<Record<Currency, { value: number; fetchedAt: number }>>;
  fetchedAt: number;
};
type Held = { key: Key<History>; history?: History; failed: boolean };
const FiatContext = createContext<{ quote: Quote | null; failed: boolean; now: number; held: Held | null }>({
  quote: null,
  failed: false,
  now: 0,
  held: null,
});
const seconds = () => Math.floor(Date.now() / 1000);

export function FiatProvider({ children }: { children: ReactNode }) {
  const { state } = useVaultState();
  const settings = state.phase === "open" ? state.settings.fiat : undefined;
  const source = settings && Object.hasOwn(priceSources, settings.source) ? settings.source : undefined;
  const currency = settings?.currency;
  const vault = state.phase === "open" ? state.vault : null;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [held, setHeld] = useState<Held | null>(null);
  useEffect(() => {
    setQuote(null);
    setFailed(false);
    if (!source) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const body = await priceSources[source]!.current(controller.signal);
        const rates: Quote["rates"] = {};
        const fetchedAt = Date.now();
        for (const currency of currencies) {
          const value = body?.[currency];
          if (typeof value === "number" && Number.isFinite(value) && value > 0) rates[currency] = { value, fetchedAt };
        }
        if (!Object.keys(rates).length) throw new Error("No prices returned");
        if (!controller.signal.aborted) {
          setQuote((previous) => ({
            source,
            rates: { ...(previous?.source === source ? previous.rates : {}), ...rates },
            fetchedAt,
          }));
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 300000);
      }
    };
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [source]);

  const download = source && priceSources[source]!.history;
  useEffect(() => {
    setHeld(null);
    if (!source || !download || !currency || !vault) return;
    const key = vaultKey.prices(source, currency);
    const controller = new AbortController();
    const refresh = async () => {
      const cached = await readRecord(vault, key).catch(() => undefined);
      if (controller.signal.aborted) return;
      setHeld({ key, history: cached, failed: false });
      if (!stale(cached, seconds())) return;
      try {
        const points = parseHistory(await download(currency, controller.signal), currency);
        if (!points.length) throw new Error("No prices returned");
        const next = refreshed(await readRecord(vault, key), points, seconds());
        if (controller.signal.aborted) return;
        await writeRecord(vault, key, next);
        if (!controller.signal.aborted) setHeld({ key, history: next, failed: false });
      } catch {
        if (!controller.signal.aborted) setHeld({ key, history: cached, failed: true });
      }
    };
    void refresh();
    const timer = setInterval(refresh, 3600000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [vault, source, download, currency]);

  const shownQuote = quote?.source === source ? quote : null;
  const shownHeld = (source && currency && held?.key === vaultKey.prices(source, currency) && held) || null;
  useEffect(() => {
    const rate = currency && shownQuote?.rates[currency];
    if (!rate || !vault || !shownHeld) return;
    const next = withSpot(
      shownHeld.history ?? { fetchedAt: 0, points: [] },
      rate.value,
      Math.floor(rate.fetchedAt / 1000),
    );
    if (!next) return;
    setHeld({ ...shownHeld, history: next });
    writeRecord(vault, shownHeld.key, next).catch(() => {});
  }, [shownQuote, shownHeld, vault, currency]);

  const off = state.phase === "open" && !state.settings.fiat;
  useEffect(() => {
    if (off && vault)
      vault
        .keys(vaultKey.prices.prefix)
        .then((keys) => (keys.length ? vault.delete(...keys) : undefined))
        .catch(() => {});
  }, [off, vault]);

  return (
    <FiatContext.Provider value={{ quote: shownQuote, failed, now, held: shownHeld }}>{children}</FiatContext.Provider>
  );
}

const formats: Partial<Record<Currency, Intl.NumberFormat>> = {};

function useFiat() {
  const { state } = useVaultState();
  const hidden = useHidden();
  const settings = state.phase === "open" ? state.settings.fiat : null;
  const source = settings && Object.hasOwn(priceSources, settings.source) ? priceSources[settings.source] : undefined;
  if (!settings || !source || hidden) return null;
  const format = (formats[settings.currency] ??= new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: settings.currency,
    currencyDisplay: "code",
  }));
  const money = (sats: number, value: number) => format.format((sats / 1e8) * value);
  return { settings, source, money };
}

const utc = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const utcText = (time: number) => `${utc.format(time * 1000)} UTC`;

/** `brief` drops the source and freshness, for a figure beside one that already shows them. */
export function FiatAmount({ sats, brief = false }: { sats: number; brief?: boolean }) {
  const fiat = useFiat();
  const { quote, failed, now } = useContext(FiatContext);
  if (!fiat) return null;
  const { settings, source, money } = fiat;
  const rate = quote?.rates[settings.currency];
  if (brief)
    return rate ? (
      <span className="block text-xs font-normal tabular-nums text-ink-3">≈ {money(sats, rate.value)}</span>
    ) : null;
  const age = quote ? Math.max(0, Math.floor((now - (rate?.fetchedAt ?? quote.fetchedAt)) / 60000)) : 0;
  return (
    <span className="block text-sm font-normal tabular-nums text-ink-3">
      {rate ? (
        <>
          ≈ {money(sats, rate.value)} at current rate · {source.name}
          {(failed || rate.fetchedAt < quote!.fetchedAt || age >= 10) && ` · last fetched ${age} min ago`}
        </>
      ) : failed || quote ? (
        "Price unavailable. Check the price source in Settings."
      ) : (
        "Fetching price…"
      )}
    </span>
  );
}

function useThen(tx: WalletTx) {
  const { held } = useContext(FiatContext);
  const point = tx.time !== null && held?.history ? priceAt(held.history.points, tx.time) : null;
  const downloaded = !!held?.history?.fetchedAt;
  return { point, fetching: tx.time !== null && !downloaded && !held?.failed, failed: !downloaded && !!held?.failed };
}

/** What the transaction was worth when it confirmed, above its value now. */
export function TxFiat({ tx }: { tx: WalletTx }) {
  const fiat = useFiat();
  const { point, fetching, failed } = useThen(tx);
  if (!fiat) return null;
  if (tx.confirmations === 0) return <FiatAmount sats={Math.abs(tx.net)} />;
  const { source, money } = fiat;
  return (
    <>
      <span className="block text-sm font-normal tabular-nums text-ink-3">
        {!source.history
          ? "Historical estimates need mempool.space as the price source."
          : point
            ? `≈ ${money(Math.abs(tx.net), point[1])} · price at ${utcText(point[0])} · ${source.name}`
            : fetching
              ? "Fetching price…"
              : failed
                ? "Price history unavailable. Check the price source in Settings."
                : "No historical price for this date."}
      </span>
      <FiatAmount sats={Math.abs(tx.net)} />
    </>
  );
}

/** A transaction's fiat value in the history list, preferring its historical price. */
export function TxRowFiat({ tx }: { tx: WalletTx }) {
  const fiat = useFiat();
  const { quote } = useContext(FiatContext);
  const { point } = useThen(tx);
  if (!fiat) return null;
  const { settings, source, money } = fiat;
  const rate = quote?.rates[settings.currency];
  const current = tx.confirmations === 0 || !point;
  const [value, label] = current
    ? [rate?.value, `Current rate, ${source.name}`]
    : [point?.[1], point && `Price at ${utcText(point[0])}, ${source.name}`];
  if (value === undefined) return null;
  return (
    <span className="block text-xs font-normal tabular-nums text-ink-3">
      <span title={label!}>
        ≈ {money(Math.abs(tx.net), value)}
        {current && " at current rate"}
      </span>
      <span className="sr-only">, {label}</span>
    </span>
  );
}

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
