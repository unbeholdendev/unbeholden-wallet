import { expect, it } from "vitest";
import { memoryStore } from "../vault/vault";
import { getSettings, mergeBackup, vaultKey } from "./wallets";

it.each([undefined, null])("does not import price-service consent over %s", async (fiat) => {
  const vault = memoryStore();
  await vault.put("settings", { server: null, fiat });
  await mergeBackup(vault, { settings: { fiat: { source: "mempool", currency: "USD" } } });
  expect((await vault.get<{ fiat?: unknown }>("settings"))?.fiat).toBe(fiat);
  expect((await getSettings(vault)).server).toBeNull();
});

it("names records as existing vaults and backups store them", () => {
  expect([vaultKey.settings, vaultKey.book]).toEqual(["settings", "book"]);
  expect(
    [vaultKey.wallet, vaultKey.labels, vaultKey.frozen, vaultKey.kyc, vaultKey.requests, vaultKey.send].map((k) =>
      k("w"),
    ),
  ).toEqual(["wallet/w", "labels/w", "frozen/w", "kyc/w", "requests/w", "send/w"]);
  expect(vaultKey.cache("w")).toEqual({ prefix: "cache/w/", state: "cache/w/state", txs: "cache/w/txs" });
  expect(vaultKey.prices("mempool", "USD")).toBe("prices/mempool/USD");
  expect(vaultKey.prices.prefix).toBe("prices/");
});
