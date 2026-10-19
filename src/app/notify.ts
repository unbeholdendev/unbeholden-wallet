import { useEffect, useRef } from "react";
import { isOutgoing } from "../core/view";
import { useConnection } from "./connection";
import { useWalletSession } from "./session";
import { useVault } from "./vault";

/** No amount and no wallet name: the notification stays on the device's lock screen after the vault locks. */
async function show(title: string, tag: string) {
  if (Notification.permission !== "granted") return;
  // A phone's browser shows a notification only through the service worker.
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) await registration.showNotification(title, { tag });
  else new Notification(title, { tag });
}

/** While the vault is open and the setting is on, tells the user of a payment in, and of its first confirmation. */
export function usePaymentNotifications() {
  const notify = useRef(false);
  notify.current = !!useVault().settings.notify;
  const connected = useRef(false);
  connected.current = useConnection().connection.phase === "connected";
  const session = useWalletSession();
  useEffect(() => {
    if (!session || typeof Notification === "undefined") return;
    const incoming = () =>
      new Map(session.getSnapshot().transactions.filter((tx) => !isOutgoing(tx)).map((tx) => [tx.txid, tx.height !== null]));
    let known = incoming();
    // What the first sync finds arrived while the app was closed, so it is taken in silently.
    let synced = false;
    let syncing = false;
    session.settled().then(() => {
      if (!syncing && connected.current) synced = true;
    });
    return session.subscribe(() => {
      const now = incoming();
      for (const [txid, confirmed] of synced && notify.current ? now : []) {
        const was = known.get(txid);
        if (was === undefined) void show("A payment arrived", txid);
        else if (!was && confirmed) void show("A payment confirmed", txid);
      }
      known = now;
      if (session.getSnapshot().progress) syncing = true;
      else if (syncing) synced = true;
    });
  }, [session]);
}
