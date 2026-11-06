import { expect, it } from "vitest";
import { parseHistory, priceAt, refreshed, stale, withSpot, type History } from "./prices";

const HOUR = 3600;
const DAY = 86400;

// Made-up prices in the shape of mempool.space's /api/v1/historical-price?currency=EUR, newest first, per
// https://github.com/mempool/mempool/blob/master/backend/src/repositories/PricesRepository.ts
const response = {
  prices: [
    { time: 1700010800, EUR: 33000, USD: 36000 },
    { time: 1700007200, EUR: 0, USD: 35900 },
    { time: 1700000000, EUR: 32000, USD: 35000 },
    { time: 1279497600, EUR: 0, USD: 0 },
  ],
  exchangeRates: { USDEUR: 0.92 },
};

it("reads the currency's prices oldest first, skipping zero and missing ones", () => {
  expect(parseHistory(response, "EUR")).toEqual([[1700000000, 32000], [1700010800, 33000]]);
  expect(parseHistory(response, "GBP")).toEqual([]);
  expect(parseHistory({ prices: "nope" }, "EUR")).toEqual([]);
  expect(parseHistory(null, "EUR")).toEqual([]);
});

it("prices a block time at the latest point at or before it", () => {
  const points: History["points"] = [[1000, 10], [1000 + DAY, 20], [1000 + DAY + HOUR, 30]];
  expect(priceAt(points, 1000)).toEqual([1000, 10]);
  expect(priceAt(points, 1000 + DAY - 1)).toEqual([1000, 10]);
  expect(priceAt(points, 1000 + DAY + HOUR + 5)).toEqual([1000 + DAY + HOUR, 30]);
  expect(priceAt(points, 999)).toBeNull();
});

it("has no price across a gap of more than 48 hours", () => {
  const points: History["points"] = [[0, 10], [5 * DAY, 20]];
  expect(priceAt(points, 2 * DAY)).toEqual([0, 10]);
  expect(priceAt(points, 2 * DAY + 1)).toBeNull();
  expect(priceAt(points, 7 * DAY + 1)).toBeNull();
});

it("goes stale after a day", () => {
  expect(stale(undefined, 0)).toBe(true);
  expect(stale({ fetchedAt: 0, points: [] }, DAY - 1)).toBe(false);
  expect(stale({ fetchedAt: 0, points: [] }, DAY)).toBe(true);
});

it("adds at most one current price an hour", () => {
  const history: History = { fetchedAt: 0, points: [[1000, 10]] };
  expect(withSpot(history, 11, 1000 + HOUR - 1)).toBeUndefined();
  expect(withSpot(history, 11, 1000 + HOUR)).toEqual({ fetchedAt: 0, points: [[1000, 10], [1000 + HOUR, 11]] });
});

it("replaces the series on refresh but keeps current prices newer than it", () => {
  const old: History = { fetchedAt: 0, points: [[1000, 10], [2000, 11], [9000, 12]] };
  expect(refreshed(old, [[1000, 9], [5000, 13]], 50)).toEqual({ fetchedAt: 50, points: [[1000, 9], [5000, 13], [9000, 12]] });
  expect(refreshed(undefined, [[1000, 9]], 50)).toEqual({ fetchedAt: 50, points: [[1000, 9]] });
});
