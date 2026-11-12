import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type History, historyKey, parseHistory, priceAt, refreshed, stale, withSpot } from "../core/prices";
import type { WalletTx } from "../core/view";
import { useHidden, useVaultState } from "./vault";

export const currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"] as const;
export type Currency = (typeof currencies)[number];
export type FiatSettings = { source: "blockchain" | "mempool" | "demo"; currency: Currency };

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
type Held = { key: string; history?: History; failed: boolean };
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
    const key = historyKey(source, currency);
    const controller = new AbortController();
    const refresh = async () => {
      const cached = await vault.get<History>(key).catch(() => undefined);
      if (controller.signal.aborted) return;
      setHeld({ key, history: cached, failed: false });
      if (!stale(cached, seconds())) return;
      try {
        const points = parseHistory(await download(currency, controller.signal), currency);
        if (!points.length) throw new Error("No prices returned");
        const next = refreshed(await vault.get<History>(key), points, seconds());
        if (controller.signal.aborted) return;
        await vault.put(key, next);
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
  const shownHeld = (source && currency && held?.key === historyKey(source, currency) && held) || null;
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
    vault.put(shownHeld.key, next).catch(() => {});
  }, [shownQuote, shownHeld, vault, currency]);

  const off = state.phase === "open" && !state.settings.fiat;
  useEffect(() => {
    if (off && vault)
      vault
        .keys("prices/")
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
