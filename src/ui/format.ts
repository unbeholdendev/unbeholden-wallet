import { groupSats } from "./amount";

/** Counted up to six, the depth past which a reorg is no longer a practical worry. */
export const confText = (confirmations: number) =>
  confirmations === 0 ? "Unconfirmed" : confirmations < 6 ? `${confirmations} conf` : "Confirmed";

export const dateText = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const timeText = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function ageText(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  if (days < 1) return "today";
  if (days < 60) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} months` : `${(months / 12).toFixed(1)} years`;
}

export const shortId = (s: string, head = 8, tail = 6) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export const satsText = (n: number) => `${groupSats(n)} sats`;
