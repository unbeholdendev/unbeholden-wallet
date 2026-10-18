import { useState } from "react";
import { useReceiveSkips, useWallet, useWalletSnapshot } from "../app/session";
import { qrPath } from "../transport/qr";
import { Field, inputClass, LinkButton, linkClass } from "../ui/kit";
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

export function Receive() {
  const snapshot = useWalletSnapshot();
  const skips = useReceiveSkips();
  const { id } = useWallet().record;
  const [from, setFrom] = useState(() => skips.get(id) ?? "");
  const [amount, setAmount] = useState("");
  const [withLabel, setWithLabel] = useState(false);
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
  const unused = receive.filter((a) => !a.used && a.index >= snapshot.nextReceive.index);
  const next = unused.find((a) => a.index >= skipTo) ?? snapshot.nextReceive;
  const after = unused.find((a) => a.index > next.index);
  const sats = parseBtc(amount);
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
          <span className="text-sm text-ink-2">{next.index === snapshot.nextReceive.index ? "Next unused address" : "Unused address"}</span>
          <p data-testid="receive-address" className="m-0 text-md leading-relaxed select-all">
            <GroupedAddress address={next.address} />
          </p>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CopyButton text={next.address} what="Address" />
            {after && <LinkButton onClick={() => {
                  skips.set(id, after.address);
                  setFrom(after.address);
                }}>Use a new address</LinkButton>}
          </span>
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
    </div>
  );
}
