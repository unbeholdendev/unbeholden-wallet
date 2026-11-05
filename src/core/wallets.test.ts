import { expect, it } from "vitest";
import { memoryStore } from "../vault/vault";
import { getSettings, mergeBackup } from "./wallets";

it.each([undefined, null])("does not import price-service consent over %s", async (fiat) => {
  const vault = memoryStore();
  await vault.put("settings", { server: null, fiat });
  await mergeBackup(vault, { settings: { fiat: { source: "mempool", currency: "USD" } } });
  expect((await vault.get<{ fiat?: unknown }>("settings"))?.fiat).toBe(fiat);
  expect((await getSettings(vault)).server).toBeNull();
});
