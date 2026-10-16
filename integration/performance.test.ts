import { beforeAll, expect, it, vi } from "vitest";
import { scriptHash } from "../src/backend/backend";
import { electrumBackend } from "../src/backend/electrum";
import {
  buildLargeHistory,
  ELECTRUM_WS,
  LARGE,
  rpc,
  script,
} from "../scripts/regtest/fixture";

const TRANSACTIONS = 500;

const hashes = [
  ...Array.from({ length: TRANSACTIONS / 2 + 20 }, (_, i) => script(LARGE, 0, i)),
  ...Array.from({ length: 20 }, (_, i) => script(LARGE, 1, i)),
].map(scriptHash);

beforeAll(async () => {
  await buildLargeHistory(TRANSACTIONS);
  const height = await rpc("getblockcount");
  const backend = electrumBackend(ELECTRUM_WS);
  await backend.connect();
  await vi.waitFor(async () => expect((await backend.chainTip()).height).toBe(height), {
    timeout: 10_000,
  });
  backend.close();
});

it(`fetches a ${TRANSACTIONS}-transaction wallet in well under ten seconds`, async () => {
  const started = performance.now();
  const backend = electrumBackend(ELECTRUM_WS);
  await backend.connect();
  const histories = await backend.history(hashes);
  const txids = [...new Set(histories.flat().map((entry) => entry.txid))];
  const heights = [...new Set(histories.flat().map((entry) => entry.height!))];
  const [transactions, headers] = await Promise.all([
    backend.transactions(txids),
    backend.blockHeaders(heights),
  ]);
  const elapsed = performance.now() - started;
  backend.close();

  expect(transactions).toHaveLength(TRANSACTIONS);
  expect(headers).toHaveLength(heights.length);
  console.log(`Fetched ${TRANSACTIONS} transactions in ${elapsed.toFixed(0)}ms`);
  expect(elapsed).toBeLessThan(5_000);
});
