import { useEffect, useState } from "react";
import { useConnection } from "../../app/connection";
import { useWalletSession } from "../../app/session";
import { useVault } from "../../app/vault";
import type { WalletSnapshot } from "../../core/wallet";
import { groupSats } from "../../ui/amount";
import { ageText, dateText, hostText, timeText } from "../../ui/format";
import { LinkButton, linkClass } from "../../ui/kit";
import { reasons } from "../Connect";

const stages = { history: "Checking addresses", transactions: "Fetching transactions", blocks: "Fetching block times" };

// A healthy chain goes two hours without a block about once in three years.
const STALE_TIP = 2 * 3600;

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);
  return now;
}

export function SyncLine({ snapshot }: { snapshot: WalletSnapshot }) {
  const session = useWalletSession();
  const { connection, connect } = useConnection();
  const { settings } = useVault();
  const server = settings.server ? hostText(settings.server) : "your server";
  const { progress, error, tip } = snapshot;
  const failed = connection.phase === "failed";
  const synced =
    snapshot.syncedAt === null
      ? ""
      : `, ${dateText(snapshot.syncedAt / 1000)} at ${timeText(snapshot.syncedAt / 1000)}`;
  const stale = `Balances are as of the last sync${synced}.`;
  const now = useNow();
  // The demo's chain never moves.
  const tipAge = tip && import.meta.env.MODE !== "demo" ? now / 1000 - tip.time : 0;
  const [dot, text] = failed
    ? [
        "bg-bad",
        `Not connected to ${server}. ${connection.failure ? reasons[connection.failure] : connection.message} ${stale}`,
      ]
    : connection.phase === "retrying"
      ? ["bg-warn animate-pulse", `Lost ${server}, trying again. ${stale}`]
      : connection.phase !== "connected"
        ? ["bg-warn animate-pulse", `Connecting to ${server}.`]
        : progress
          ? [
              "bg-warn animate-pulse",
              `${stages[progress.stage]}, ${groupSats(progress.done)} of ${groupSats(progress.total)}.`,
            ]
          : error
            ? ["bg-bad", `The last sync failed. ${error}`]
            : tip && tipAge > STALE_TIP
              ? [
                  "bg-warn",
                  `Your server's newest block, ${groupSats(tip.height)}, is ${tipAge < 172_800 ? `${Math.floor(tipAge / 3600)} hours` : ageText(tipAge)} old. Its node may be stuck or have lost its peers.`,
                ]
              : ["bg-ok", tip ? `Up to date at block ${groupSats(tip.height)}.` : "Up to date."];
  return (
    <div role="status" className="flex items-center gap-2.5 border-t border-rule px-4 py-3 text-sm text-ink-2">
      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${dot}`} />
      <span className="min-w-0 flex-1">{text}</span>
      {failed && (
        <a href="#/connect" className={`${linkClass} text-sm`}>
          What to do
        </a>
      )}
      {(failed || (connection.phase === "connected" && error && !progress)) && (
        <LinkButton className="text-sm" onClick={() => (failed ? connect(connection.url) : session?.refresh())}>
          Try again
        </LinkButton>
      )}
    </div>
  );
}
