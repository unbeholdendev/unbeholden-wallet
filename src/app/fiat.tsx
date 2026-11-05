import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useHidden, useVaultState } from "./vault";

export const currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"] as const;
export type Currency = typeof currencies[number];
export type FiatSettings = { source: "blockchain" | "mempool"; currency: Currency };
export const priceSources = {
  blockchain: { name: "Blockchain.com", url: "https://blockchain.info/ticker" },
  mempool: { name: "mempool.space", url: "https://mempool.space/api/v1/prices" },
};

type Quote = { source: FiatSettings["source"]; rates: Partial<Record<Currency, { value: number; fetchedAt: number }>>; fetchedAt: number };
const FiatContext = createContext<{ quote: Quote | null; failed: boolean; now: number }>({ quote: null, failed: false, now: 0 });

export function FiatProvider({ children }: { children: ReactNode }) {
  const { state } = useVaultState();
  const source = import.meta.env.MODE !== "demo" && state.phase === "open" ? state.settings.fiat?.source : undefined;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setQuote(null);
    setFailed(false);
    if (!source || !Object.hasOwn(priceSources, source)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(priceSources[source].url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
        });
        if (!response.ok) throw new Error("Price request failed");
        const body = await response.json();
        const rates: Quote["rates"] = {};
        const fetchedAt = Date.now();
        for (const currency of currencies) {
          const value = source === "blockchain" ? body?.[currency]?.last : body?.[currency];
          if (typeof value === "number" && Number.isFinite(value) && value > 0) rates[currency] = { value, fetchedAt };
        }
        if (!Object.keys(rates).length) throw new Error("No prices returned");
        if (!controller.signal.aborted) {
          setQuote(previous => ({
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
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock); };
  }, [source]);
  return <FiatContext.Provider value={{ quote: quote?.source === source ? quote : null, failed, now }}>{children}</FiatContext.Provider>;
}

export function FiatAmount({ sats }: { sats: number }) {
  const { state } = useVaultState();
  const { quote, failed, now } = useContext(FiatContext);
  const hidden = useHidden();
  const settings = state.phase === "open" ? state.settings.fiat : null;
  if (!settings || hidden || import.meta.env.MODE === "demo") return null;
  const rate = quote?.rates[settings.currency];
  const age = quote ? Math.max(0, Math.floor((now - (rate?.fetchedAt ?? quote.fetchedAt)) / 60000)) : 0;
  return <span className="block text-sm font-normal tabular-nums text-ink-3">
    {rate ? <>≈ {new Intl.NumberFormat("en-GB", { style: "currency", currency: settings.currency, currencyDisplay: "code" }).format(sats / 1e8 * rate.value)} at current rate · {priceSources[settings.source].name}{(failed || rate.fetchedAt < quote!.fetchedAt || age >= 10) && ` · last fetched ${age} min ago`}</> : failed || quote ? "Price unavailable. Check the price source in Settings." : "Fetching price…"}
  </span>;
}
