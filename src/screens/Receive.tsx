import { useEffect, useState } from "react";
import { useReceiveSkips, useWallet, useWalletSnapshot } from "../app/session";
import { useVault } from "../app/vault";
import type { WalletSnapshot } from "../core/wallet";
import { qrPath } from "../transport/qr";
import { Amount } from "../ui/amount";
import { shortId } from "../ui/format";
import { Button, Chip, Field, inputClass, LinkButton, linkClass, Panel } from "../ui/kit";
import { useToast } from "../ui/toast";
import { CopyButton, EditableLabel, GroupedAddress, Opening } from "./parts";
import { btcText, parseBtc } from "./send/Recipients";

/** A BIP21 request. Only the address part is upper case: that fits the denser alphanumeric QR mode, and a label keeps its case. */
// https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
export function bip21(address: string, sats: number | null, label: string | null) {
  const query = new URLSearchParams();
  if (sats) query.set("amount", btcText(sats));
  if (label) query.set("label", label);
  const params = query.toString().replace(/\+/g, "%20");
  return `bitcoin:${address}`.toUpperCase() + (params && `?${params}`);
}

/** Its label is the address's label. */
export type PaymentRequest = { address: string; sats: number | null };

function received(snapshot: WalletSnapshot, address: string) {
  let confirmed = 0;
  let unconfirmed = 0;
  for (const tx of snapshot.transactions)
    for (const o of tx.outputs) if (o.address === address) tx.height === null ? (unconfirmed += o.value!) : (confirmed += o.value!);
  return { confirmed, unconfirmed };
}

function Requests({ snapshot, requests, onShow, onRemove }: { snapshot: WalletSnapshot; requests: PaymentRequest[]; onShow: (r: PaymentRequest) => void; onRemove: (r: PaymentRequest) => void }) {
  const labels = new Map(snapshot.addresses.receive.map((a) => [a.address, a.label]));
  return (
    <Panel title="Requests" className="@min-[720px]/app:col-span-2">
      <ul className="m-0 grid list-none gap-3 p-0">
        {requests.map((r) => {
          const name = labels.get(r.address) ?? shortId(r.address);
          const { confirmed, unconfirmed } = received(snapshot, r.address);
          const got = confirmed + unconfirmed;
          const status = !got ? "Waiting" : r.sats && got < r.sats ? "Partly paid" : "Paid";
          return (
            <li key={r.address} className="grid gap-1 border-t border-rule pt-3 text-sm first:border-0 first:pt-0">
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 font-medium break-words">{name}</span>
                <Chip tone={status === "Waiting" ? "neutral" : status === "Paid" && !unconfirmed ? "ok" : "warn"}>{status}</Chip>
                <LinkButton aria-label={`Show request ${name}`} onClick={() => onShow(r)}>Show</LinkButton>
                <LinkButton aria-label={`Remove request ${name}`} onClick={() => onRemove(r)}>Remove</LinkButton>
              </span>
              <span className="text-ink-2">
                {r.sats ? <>Asked <Amount sats={r.sats} unit /></> : "No amount asked"}
                {got > 0 && <>, received <Amount sats={got} unit /></>}
                {unconfirmed > 0 && <>, <Amount sats={unconfirmed} unit /> not yet confirmed</>}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function Receive() {
  const snapshot = useWalletSnapshot();
  const skips = useReceiveSkips();
  const { vault } = useVault();
  const toast = useToast();
  const { record: { id }, descriptor: { keys, multi } } = useWallet();
  const [from, setFrom] = useState(() => skips.get(id) ?? "");
  const [amount, setAmount] = useState("");
  const [withLabel, setWithLabel] = useState(false);
  const [requests, setRequests] = useState<PaymentRequest[] | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    vault.get<PaymentRequest[]>(`requests/${id}`).then((saved) => setRequests(saved ?? []), () => {});
  }, [vault, id]);
  if (!snapshot) return <Opening title="Receive" />;
  // Before the first sync this wallet cannot know which addresses have been paid.
  const ready = snapshot.tip !== null && snapshot.progress?.stage !== "history";
  if (!ready)
    return (
      <div className="grid content-start gap-2">
        <h1 className="m-0 text-xl font-semibold">Receive</h1>
        <p className="m-0 text-ink-3">Checking which addresses have been paid, so as not to show you a used one.</p>
      </div>
    );

  const { receive } = snapshot.addresses;
  const skipTo = receive.find((a) => a.address === from)?.index ?? 0;
  const requested = new Set(requests?.map((r) => r.address));
  const unused = receive.filter((a) => !a.used && a.index >= snapshot.nextReceive.index && !requested.has(a.address));
  const next = receive.find((a) => a.address === shown) ?? unused.find((a) => a.index >= skipTo) ?? snapshot.nextReceive;
  const after = unused.find((a) => a.index > next.index);
  const sats = parseBtc(amount);
  const isRequest = requested.has(next.address);
  const saveRequests = (list: PaymentRequest[], done: () => void) =>
    vault.put(`requests/${id}`, list).then(
      () => (setRequests(list), done()),
      () => toast("The request list was not saved"),
    );
  const save = () =>
    saveRequests([{ address: next.address, sats }, ...requests!.filter((r) => r.address !== next.address)], () => {
      setShown(next.address);
      toast("Request saved");
    });
  const fresh = () => {
    setShown(null);
    setAmount("");
    setWithLabel(false);
  };
  const qr = qrPath(bip21(next.address, sats, withLabel ? next.label : null), "medium");
  return (
    <div className="grid max-w-[880px] content-start items-start gap-6 @min-[720px]/app:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <h1 className="m-0 text-xl font-semibold @min-[720px]/app:col-span-2">Receive</h1>
      <div className="grid justify-items-center rounded-panel border border-rule bg-qr p-4">
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code for ${next.address}`} shapeRendering="crispEdges" className="aspect-square w-full max-w-[360px]">
          <path d={qr.d} className="fill-qr-ink" />
        </svg>
      </div>
      <section className="grid gap-4 rounded-panel border border-rule bg-sheet p-4">
        <div className="grid gap-1.5">
          <span className="text-sm text-ink-2">{isRequest ? "Requested address" : next.index === snapshot.nextReceive.index ? "Next unused address" : "Unused address"}</span>
          <p data-testid="receive-address" className="m-0 text-md leading-relaxed select-all">
            <GroupedAddress address={next.address} />
          </p>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CopyButton text={next.address} what="Address" />
            {isRequest ? <LinkButton onClick={fresh}>New request</LinkButton> : after && <LinkButton onClick={() => {
                  skips.set(id, after.address);
                  setFrom(after.address);
                }}>Use a new address</LinkButton>}
          </span>
          {multi && (
            <p className="m-0 text-sm text-ink-2">
              A {multi.threshold}-of-{keys.length} multisig address. Check it on a cosigner device before you share it, so a
              tampered page cannot hand out an address the multisig does not control. It is at{" "}
              <span className="font-mono text-[0.86em]">{next.path}</span>.
            </p>
          )}
        </div>
        <div className="grid gap-1 border-t border-rule pt-3">
          <span className="text-sm text-ink-2">Who is paying, or what for</span>
          <EditableLabel type="addr" target={next.address} value={next.label} placeholder="Label it before you share it" />
          {next.label && (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={withLabel} onChange={(e) => setWithLabel(e.target.checked)} className="size-4 accent-route" />
              Put the label in the QR code for the payer to see
            </label>
          )}
        </div>
        <Field label="Amount to ask for, BTC (optional)" error={amount && sats === null ? "Write it as BTC, up to eight decimals." : undefined}>
          {(props) => (
            <input
              {...props}
              className={`${inputClass} tabular-nums`}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        {requests && (sats || next.label) && (
          <Button className="justify-self-start" disabled={!!amount && sats === null} onClick={save}>
            {isRequest ? "Update the request" : "Save as a request"}
          </Button>
        )}
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-t border-rule pt-3 text-sm">
          <dt className="text-ink-2">Derivation path</dt>
          <dd className="m-0 text-right font-mono">{next.path}</dd>
          <dt className="text-ink-2">Index</dt>
          <dd className="m-0 text-right">Receive #{next.index}</dd>
        </dl>
        <details className="rounded-control bg-sunk p-3 text-sm text-ink-2">
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
            <span>For a large amount, check this address on your signer first.</span>
            <span className={linkClass}>Verify on signer</span>
          </summary>
          <div className="mt-2 grid gap-2">
            <p className="m-0">
              A hosted copy of this app could, in principle, be changed to show someone else&rsquo;s address. A
              SeedSigner can scan this same QR code and check the address belongs to your wallet. On another signer,
              look up the derivation path above and compare every character.
            </p>
            <a className={linkClass} href="#/trust">
              What this app can and cannot protect you from
            </a>
          </div>
        </details>
      </section>
      {!!requests?.length && (
        <Requests
          snapshot={snapshot}
          requests={requests}
          onShow={(r) => {
            setShown(r.address);
            setAmount(r.sats ? btcText(r.sats) : "");
            setWithLabel(false);
          }}
          onRemove={(r) => {
            saveRequests(requests.filter((x) => x !== r), () => shown === r.address && fresh());
          }}
        />
      )}
    </div>
  );
}
