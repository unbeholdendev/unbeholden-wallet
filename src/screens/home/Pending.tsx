import { useEffect, useState } from "react";
import { Amount } from "../../app/amount";
import { useWallet } from "../../app/session";
import { useVault } from "../../app/vault";
import type { WalletSnapshot } from "../../core/wallet";
import { type PaymentRequest, readRecord, vaultKey } from "../../core/wallets";
import { linkClass, Panel } from "../../ui/kit";
import { received } from "../Receive";

/** What is still moving: unconfirmed payments, a send not yet out, and payment requests not yet paid. */
export function Pending({ snapshot, waiting }: { snapshot: WalletSnapshot; waiting: "sign" | "broadcast" | null }) {
  const { vault } = useVault();
  const { record } = useWallet();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  useEffect(() => {
    readRecord(vault, vaultKey.requests(record.id)).then(
      (saved) => setRequests(saved ?? []),
      () => {},
    );
  }, [vault, record.id]);
  const unconfirmed = snapshot.transactions.filter((t) => t.height === null);
  const incoming = unconfirmed.reduce((a, t) => a + Math.max(t.net, 0), 0);
  const outgoing = unconfirmed.reduce((a, t) => a + Math.min(t.net, 0), 0);
  const open = requests.filter((r) => {
    const { confirmed, unconfirmed: coming } = received(snapshot, r.address);
    return !(confirmed + coming) || (r.sats !== null && confirmed + coming < r.sats);
  });
  if (!waiting && !unconfirmed.length && !open.length) return null;
  const row =
    "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-rule pt-3 text-sm first:border-0 first:pt-0";
  return (
    <Panel title="Pending">
      <ul className="m-0 grid list-none gap-3 p-0">
        {waiting && (
          <li className={row}>
            <span>
              {waiting === "broadcast"
                ? "A signed transaction is waiting to be broadcast."
                : "A transaction you built is waiting to be signed."}
            </span>
            <a className={linkClass} href="#/send">
              Resume it
            </a>
          </li>
        )}
        {unconfirmed.length > 0 && (
          <li className={row}>
            <span>{unconfirmed.length === 1 ? "1 payment" : `${unconfirmed.length} payments`} not yet confirmed</span>
            <span className="flex gap-3">
              {incoming > 0 && <Amount sats={incoming} signed />}
              {outgoing < 0 && <Amount sats={outgoing} />}
            </span>
          </li>
        )}
        {open.length > 0 && (
          <li className={row}>
            <span>{open.length === 1 ? "1 payment request" : `${open.length} payment requests`} not yet paid</span>
            <a className={linkClass} href="#/receive">
              See them
            </a>
          </li>
        )}
      </ul>
    </Panel>
  );
}
