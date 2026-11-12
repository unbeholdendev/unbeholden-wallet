import { hex } from "@scure/base";
import { RawTx } from "@scure/btc-signer";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "../../app/connection";
import { navigate } from "../../app/route";
import { useNetwork, useWalletSessions } from "../../app/session";
import { type DecodedTx, decodeTransaction } from "../../core/lookup";
import { hostText } from "../../ui/format";
import { Button, Chip, Empty, linkClass } from "../../ui/kit";
import { TxDetails } from "../Lookup";

function parseRaw(text: string): Uint8Array | null {
  try {
    const raw = hex.decode(text.toLowerCase());
    RawTx.decode(raw);
    return raw;
  } catch {
    return null;
  }
}

/** A raw transaction in hex, anyone's: shown with its fee, then broadcast through the server. */
export function BroadcastRaw({ text }: { text: string }) {
  const { backend, connection } = useConnection();
  const live = connection.phase === "connected" ? backend : null;
  const network = useNetwork();
  const sessions = useWalletSessions();
  const raw = useMemo(() => parseRaw(text), [text]);
  const [decoded, setDecoded] = useState<
    { raw: Uint8Array; tx: DecodedTx } | { raw: Uint8Array; error: string } | null
  >(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => void (shown.current = false);
  }, []);

  useEffect(() => {
    if (!live || !raw) return;
    let cancelled = false;
    decodeTransaction(live, raw, network).then(
      (tx) => cancelled || setDecoded({ raw, tx }),
      (error) => cancelled || setDecoded({ raw, error: String((error as Error)?.message ?? error) }),
    );
    return () => void (cancelled = true);
  }, [live, raw, network]);

  if (!raw)
    return (
      <Empty title="That isn't a raw transaction">
        <p className="m-0">A raw transaction is its bytes in hex, as a signer or another wallet exports it.</p>
      </Empty>
    );
  const current = decoded?.raw === raw ? decoded : null;
  if (!current)
    return live ? (
      <p className="m-0 text-ink-3">Reading the transaction.</p>
    ) : (
      <Empty title="Not connected">
        <p className="m-0">
          Broadcasting needs the server.{" "}
          <a href="#/connect" className={linkClass}>
            Connect to it
          </a>
          .
        </p>
      </Empty>
    );
  if ("error" in current)
    return (
      <Empty title="Reading the transaction failed">
        <p className="m-0">{current.error}</p>
      </Empty>
    );
  const { tx } = current;

  const broadcast = async () => {
    if (!live) return;
    setSending(true);
    setFailure(null);
    try {
      const txid = await live.broadcast(raw);
      const touched = new Set([...tx.inputs, ...tx.outputs].map((e) => e.address));
      const touching = [...sessions.values()].filter((session) => {
        const { receive, change } = session.getSnapshot().addresses;
        return [...receive, ...change].some((a) => touched.has(a.address));
      });
      await Promise.all(touching.map((session) => session.addTransaction(raw)));
      if (shown.current) navigate(`/tx/${txid}`);
    } catch (e) {
      if (!shown.current) return;
      setFailure((e as Error).message);
      setSending(false);
    }
  };

  return (
    <TxDetails tx={tx} title="Broadcast a transaction" chip={<Chip tone="warn">Not broadcast</Chip>} rows={[]}>
      <div className="grid gap-3 border-t border-rule pt-3">
        <p className="m-0 text-sm text-ink-3">
          {connection.phase === "connected"
            ? `Broadcasting sends the transaction to ${hostText(connection.url)} only. Your server relays it to the network.`
            : "Not connected to your server, so there's nowhere to broadcast. Reconnect, then try again."}
        </p>
        {failure && (
          <div role="alert" className="grid gap-1.5 rounded-control bg-bad-tint px-3 py-2.5 text-sm text-bad">
            <b className="font-bold">Your node refused this transaction. Its reason:</b>
            <span className="font-mono text-[0.86em] break-words">{failure}</span>
          </div>
        )}
        <Button variant="primary" className="justify-self-start" onClick={broadcast} disabled={sending || !live}>
          {sending ? "Broadcasting" : "Broadcast through your server"}
        </Button>
      </div>
    </TxDetails>
  );
}
