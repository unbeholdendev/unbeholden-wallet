import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FiatAmount, FiatProvider } from "./fiat";
import { useVault, useVaultState, VaultProvider } from "./vault";
import { destroyVault } from "../vault/vault";

function Prices() {
  const { saveSettings } = useVault();
  return <><button onClick={() => void saveSettings({ fiat: { source: "blockchain", currency: "USD" } })}>Enable USD</button><FiatAmount sats={100000000} /></>;
}

function OpenPrices() {
  return <FiatProvider><Prices /></FiatProvider>;
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await destroyVault();
});

it.each([undefined, { last: -1 }])("retains USD and its age when a partial refresh returns USD %s", async (usd) => {
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ USD: { last: 100000 } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ EUR: { last: 90000 }, USD: usd })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ USD: { last: 110000 } })));
  function Ready() {
    return useVaultState().state.phase === "open" ? <OpenPrices /> : null;
  }
  render(<VaultProvider><Ready /></VaultProvider>);
  await screen.findByRole("button", { name: "Enable USD" });
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enable USD" })); });
  expect(screen.getByText(/USD.*100,000.00 at current rate/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/USD.*100,000.00.*last fetched 5 min ago/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
  expect(screen.getByText(/USD.*110,000.00 at current rate/)).toBeTruthy();
  expect(screen.queryByText(/last fetched/)).toBeNull();
});
