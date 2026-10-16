import { useWalletSnapshot } from "../app/session";
import { qrPath } from "../transport/qr";
import { linkClass } from "../ui/kit";
import { CopyButton, EditableLabel, GroupedAddress, Opening } from "./parts";

export function Receive() {
  const snapshot = useWalletSnapshot();
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

  const next = snapshot.nextReceive;
  // Upper case fits the denser alphanumeric QR mode; BIP21 and bech32 both allow it.
  const qr = qrPath(`bitcoin:${next.address}`.toUpperCase(), "medium");
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
          <span className="text-sm text-ink-2">Next unused address</span>
          <p data-testid="receive-address" className="m-0 text-md leading-relaxed select-all">
            <GroupedAddress address={next.address} />
          </p>
          <span className="justify-self-start">
            <CopyButton text={next.address} what="Address" />
          </span>
        </div>
        <div className="grid gap-1 border-t border-rule pt-3">
          <span className="text-sm text-ink-2">Who is paying, or what for</span>
          <EditableLabel type="addr" target={next.address} value={next.label} placeholder="Label it before you share it" />
        </div>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-t border-rule pt-3 text-sm">
          <dt className="text-ink-2">Derivation path</dt>
          <dd className="m-0 text-right font-mono">{next.path}</dd>
          <dt className="text-ink-2">Index</dt>
          <dd className="m-0 text-right">Receive #{next.index}</dd>
        </dl>
        <p className="m-0 rounded-control bg-sunk p-3 text-sm text-ink-2">
          A hosted copy of this app could, in principle, be changed to show someone else&rsquo;s address. For a large
          amount, check this address on your signer first: look up the derivation path above and compare every
          character.{" "}
          <a className={linkClass} href="#/trust">
            What this app can and cannot protect you from
          </a>
        </p>
      </section>
    </div>
  );
}
