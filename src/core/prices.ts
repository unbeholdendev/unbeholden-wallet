/** A price in fiat per bitcoin at a unix time in seconds. */
export type Point = [time: number, value: number];

/** A provider's price history for one currency, oldest first, with current prices added since. `fetchedAt` is 0 until a download succeeds. */
export type History = { fetchedAt: number; points: Point[] };

const HOUR = 3600;
const DAY = 24 * HOUR;

export const historyKey = (source: string, currency: string) => `prices/${source}/${currency}`;

export function parseHistory(body: unknown, currency: string): Point[] {
  const prices = (body as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(prices)) return [];
  return prices
    .flatMap((price): Point[] => {
      const time = price?.time;
      const value = price?.[currency];
      return Number.isInteger(time) && typeof value === "number" && Number.isFinite(value) && value > 0
        ? [[time, value]]
        : [];
    })
    .sort((a, b) => a[0] - b[0]);
}

/** The latest point at or before `time`, unless the provider has nothing in the 48 hours before it. */
export function priceAt(points: Point[], time: number): Point | null {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid]![0] <= time) low = mid + 1;
    else high = mid;
  }
  const point = points[low - 1];
  return point && time - point[0] <= 2 * DAY ? point : null;
}

export const stale = (history: History | undefined, now: number) => !history || now - history.fetchedAt >= DAY;

/** Adds a current price, at most one an hour; `undefined` when it adds nothing. */
export function withSpot(history: History, value: number, at: number): History | undefined {
  const last = history.points.at(-1);
  if (last && at - last[0] < HOUR) return undefined;
  return { ...history, points: [...history.points, [at, value]] };
}

/** Replaces the series with a fresh download, keeping current prices newer than its end. */
export function refreshed(old: History | undefined, points: Point[], now: number): History {
  const end = points.at(-1)?.[0] ?? -Infinity;
  return { fetchedAt: now, points: [...points, ...(old?.points.filter(([time]) => time > end) ?? [])] };
}
