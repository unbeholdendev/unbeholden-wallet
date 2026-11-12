import { useEffect, useRef } from "react";
import { isOutgoing } from "../core/view";
import type { WalletSession } from "../core/wallet";
import { useConnection } from "./connection";
import { useWalletSessions } from "./session";
import { useVault } from "./vault";

/** No amount: the notification stays on the device's lock screen after the vault locks. */
async function show(title: string, tag: string) {
  if (Notification.permission !== "granted") return;
  // A phone's browser shows a notification only through the service worker.
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) await registration.showNotification(title, { tag });
  else new Notification(title, { tag });
}

/** Calls `paid` with each payment into the session's wallet, and with its first confirmation. */
function watch(session: WalletSession, connected: () => boolean, paid: (txid: string, confirmed: boolean) => void) {
  const incoming = () =>
    new Map(
      session
        .getSnapshot()
        .transactions.filter((tx) => !isOutgoing(tx))
        .map((tx) => [tx.txid, tx.height !== null]),
    );
  let known = incoming();
  // What the first sync finds arrived while the app was closed, so it is taken in silently.
  let synced = false;
  let syncing = false;
  session.settled().then(() => {
    if (!syncing && connected()) synced = true;
  });
  return session.subscribe(() => {
    const now = incoming();
    for (const [txid, confirmed] of synced ? now : []) {
      const was = known.get(txid);
      if (was === undefined) paid(txid, false);
      else if (!was && confirmed) paid(txid, true);
    }
    known = now;
    if (session.getSnapshot().progress) syncing = true;
    else if (syncing) synced = true;
  });
}

/** While the vault is open and the setting is on, tells the user of a payment into any wallet, and of its first confirmation. */
export function usePaymentNotifications() {
  const { settings, wallets, walletId } = useVault();
  const now = useRef({ notify: false, connected: false, wallets, walletId });
  now.current = {
    notify: !!settings.notify,
    connected: useConnection().connection.phase === "connected",
    wallets,
    walletId,
  };
  const sessions = useWalletSessions();
  const watching = useRef(new Map<WalletSession, () => void>());
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const open = new Set(sessions.values());
    for (const [session, stop] of watching.current) if (!open.has(session)) stop(), watching.current.delete(session);
    for (const [id, session] of sessions) {
      if (watching.current.has(session)) continue;
      const stop = watch(
        session,
        () => now.current.connected,
        (txid, confirmed) => {
          if (!now.current.notify) return;
          const name = id === now.current.walletId ? null : now.current.wallets.find((w) => w.id === id)?.name;
          void show(`A payment ${confirmed ? "confirmed" : "arrived"}${name ? ` in ${name}` : ""}`, txid);
        },
      );
      watching.current.set(session, stop);
    }
  }, [sessions]);
  useEffect(
    () => () => {
      for (const stop of watching.current.values()) stop();
      watching.current.clear();
    },
    [],
  );
}
