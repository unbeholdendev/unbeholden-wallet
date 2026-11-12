import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { WalletTx } from "../core/view";
import { FiatControl } from "../ui/fiat";
import { createVault, destroyVault, unlockVault } from "../vault/vault";
import { FiatAmount, FiatProvider, type FiatSettings, TxFiat, TxRowFiat } from "./fiat";
import { useVault, useVaultState, VaultProvider } from "./vault";

async function storedHistory(currency: string) {
  const vault = await unlockVault(null).catch(() => null);
  if (!vault) return undefined;
  const history = await vault.get<{ points: unknown[] }>(`prices/mempool/${currency}`);
  vault.lock();
  return history;
}

function Prices() {
  const { saveSettings } = useVault();
  return (
    <>
      <button type="button" onClick={() => void saveSettings({ fiat: { source: "blockchain", currency: "USD" } })}>
        Enable USD
      </button>
      <FiatAmount sats={100000000} />
    </>
  );
}

function OpenPrices() {
  return (
    <FiatProvider>
      <Prices />
    </FiatProvider>
  );
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await destroyVault();
});

it.each([undefined, { last: -1 }])("retains USD and its age when a partial refresh returns USD %s", async (usd) => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ USD: { last: 100000 } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ EUR: { last: 90000 }, USD: usd })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ USD: { last: 110000 } })));
  function Ready() {
    return useVaultState().state.phase === "open" ? <OpenPrices /> : null;
  }
  render(
    <VaultProvider>
      <Ready />
    </VaultProvider>,
  );
  await screen.findByRole("button", { name: "Enable USD" });
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Enable USD" }));
  });
  expect(screen.getByText(/USD.*100,000.00 at current rate/)).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/USD.*100,000.00.*last fetched 5 min ago/)).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300000);
  });
  expect(screen.getByText(/USD.*110,000.00 at current rate/)).toBeTruthy();
  expect(screen.queryByText(/last fetched/)).toBeNull();
});

const CHEAP = { m: 8, t: 1, p: 1 };
const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);

async function seed(fiat: FiatSettings, records: Record<string, unknown> = {}) {
  const vault = await createVault(null, CHEAP);
  await vault.put("settings", { server: null, fiat });
  for (const [key, value] of Object.entries(records)) await vault.put(key, value);
  vault.lock();
}

function prices({
  history,
  spot = { EUR: 50000, GBP: 43000, USD: 54000 },
}: {
  history?: Record<string, unknown>[];
  spot?: object;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/prices")) return new Response(JSON.stringify(spot));
    if (url.includes("/api/v1/historical-price?") && history)
      return new Response(JSON.stringify({ prices: history, exchangeRates: {} }));
    throw new TypeError("offline");
  });
}

const historyCalls = (fetcher: ReturnType<typeof prices>) =>
  fetcher.mock.calls.filter(([url]) => String(url).includes("historical-price"));

function Shown({ txs }: { txs: Pick<WalletTx, "net" | "time" | "confirmations">[] }) {
  const ready = useVaultState().state.phase === "open";
  return ready ? (
    <FiatProvider>
      {txs.map((tx, i) => (
        <div key={i} data-testid={`tx${i}`}>
          <TxFiat tx={tx as WalletTx} />
          <TxRowFiat tx={tx as WalletTx} />
        </div>
      ))}
    </FiatProvider>
  ) : null;
}

function Settled({ children }: { children: ReactNode }) {
  return useVaultState().state.phase === "open" ? children : null;
}

const show = (...txs: Pick<WalletTx, "net" | "time" | "confirmations">[]) =>
  render(
    <VaultProvider kdf={CHEAP}>
      <Shown txs={txs} />
    </VaultProvider>,
  );
const confirmed = (time: number | null) => ({ net: 100000000, time, confirmations: 3 });

it("downloads mempool.space's history once and reuses it across a reload", async () => {
  await seed({ source: "mempool", currency: "EUR" });
  const fetcher = prices({
    history: [
      { time: 1700000000, EUR: 32000 },
      { time: 1700003600, EUR: 32500 },
    ],
  });
  show(confirmed(1700003700));
  expect(await screen.findByText("≈ EUR 32,500.00 · price at 14 Nov 2023, 23:13 UTC · mempool.space")).toBeTruthy();
  expect(screen.getByText("≈ EUR 50,000.00 at current rate · mempool.space")).toBeTruthy();
  expect(screen.getByTitle("Price at 14 Nov 2023, 23:13 UTC, mempool.space").textContent).toMatch(
    /^≈ EUR\s32,500\.00$/,
  );
  expect(String(historyCalls(fetcher)[0]![0])).toBe("https://mempool.space/api/v1/historical-price?currency=EUR");
  await waitFor(async () => expect(await storedHistory("EUR")).toBeTruthy());
  cleanup();
  show(confirmed(1700003700));
  expect(await screen.findByText(/EUR 32,500.00 · price at/)).toBeTruthy();
  expect(historyCalls(fetcher)).toHaveLength(1);
});

it("shows cached estimates offline, and no price across a gap in the data", async () => {
  await seed(
    { source: "mempool", currency: "EUR" },
    { "prices/mempool/EUR": { fetchedAt: now() - 2 * 86400, points: [[1700000000, 32000]] } },
  );
  prices({ spot: {} });
  show(confirmed(1700000000 + 3600), confirmed(1700000000 + 3 * 86400), confirmed(null));
  expect(
    await within(await screen.findByTestId("tx0")).findByText(/EUR 32,000.00 · price at 14 Nov 2023, 22:13 UTC/),
  ).toBeTruthy();
  expect(within(screen.getByTestId("tx1")).getByText("No historical price for this date.")).toBeTruthy();
  expect(within(screen.getByTestId("tx2")).getByText("No historical price for this date.")).toBeTruthy();
});

it("keeps each currency's history apart", async () => {
  await seed(
    { source: "mempool", currency: "GBP" },
    { "prices/mempool/EUR": { fetchedAt: now(), points: [[1700000000, 32000]] } },
  );
  const fetcher = prices({ history: [{ time: 1700000000, EUR: 1, GBP: 28000 }] });
  show(confirmed(1700000000));
  expect(await screen.findByText(/GBP 28,000.00 · price at/)).toBeTruthy();
  expect(String(historyCalls(fetcher)[0]![0])).toMatch(/currency=GBP$/);
});

it("asks for mempool.space when the source has no history", async () => {
  await seed(
    { source: "blockchain", currency: "USD" },
    { "prices/mempool/USD": { fetchedAt: now(), points: [[1700000000, 36000]] } },
  );
  const fetcher = prices({ spot: { USD: { last: 54000 } } });
  show(confirmed(1700000000));
  expect(await screen.findByText("Historical estimates need mempool.space as the price source.")).toBeTruthy();
  expect(screen.queryByText(/36,000/)).toBeNull();
  expect(historyCalls(fetcher)).toHaveLength(0);
});

it("prices a fresh transaction at the latest current price kept, and a pending one at the current rate", async () => {
  await seed(
    { source: "mempool", currency: "EUR" },
    { "prices/mempool/EUR": { fetchedAt: now(), points: [[now() - 2 * HOUR, 49000]] } },
  );
  prices({});
  show(confirmed(now() + 60), { net: 100000000, time: null, confirmations: 0 });
  expect(await within(await screen.findByTestId("tx0")).findByText(/EUR 50,000.00 · price at/)).toBeTruthy();
  const pending = within(screen.getByTestId("tx1"));
  expect(pending.queryByText(/price at/)).toBeNull();
  expect(pending.getByTitle("Current rate, mempool.space").textContent).toMatch(/^≈ EUR\s50,000\.00 at current rate$/);
  await waitFor(async () => expect((await storedHistory("EUR"))?.points).toHaveLength(2));
});

it("forgets the price history when fiat prices are turned off", async () => {
  await seed(
    { source: "mempool", currency: "EUR" },
    { "prices/mempool/EUR": { fetchedAt: now(), points: [[1700000000, 32000]] } },
  );
  prices({});
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  render(
    <VaultProvider kdf={CHEAP}>
      <Settled>
        <FiatProvider>
          <FiatControl />
        </FiatProvider>
      </Settled>
    </VaultProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Fiat price settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Turn off fiat prices" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Show fiat value" })).toBeTruthy());
  await waitFor(async () => expect(await storedHistory("EUR")).toBeUndefined());
});

it("says so when the first history download fails, and still keeps current prices", async () => {
  await seed({ source: "mempool", currency: "EUR" });
  prices({});
  show(confirmed(1700000000), confirmed(now() + 60));
  expect(
    await within(await screen.findByTestId("tx0")).findByText(
      "Price history unavailable. Check the price source in Settings.",
    ),
  ).toBeTruthy();
  expect(await within(screen.getByTestId("tx1")).findByText(/EUR 50,000.00 · price at/)).toBeTruthy();
  await waitFor(async () => expect((await storedHistory("EUR"))?.points).toHaveLength(1));
});
