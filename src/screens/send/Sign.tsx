import { useMemo, useState, type ReactNode } from "react";
import { useConnection } from "../../app/connection";
import { navigate } from "../../app/route";
import { useWallet, useWalletSession, useWalletSnapshot } from "../../app/session";
import { Amount, groupSats } from "../../ui/amount";
import { Icon } from "../../ui/icons";
import { hostText } from "../../ui/format";
import { Button, Chip, LinkButton, Notice, Panel } from "../../ui/kit";
import { finaliseExternal, finaliseSigned, parsePsbt, reviewPsbt } from "../../wallet/psbt";
import { download, ExportQr } from "./ExportQr";
import { rateText } from "./fees";
import { ScanBack } from "./ScanBack";

type Stage = "show" | "scan" | "verified";

const STEPS: [Stage, string][] = [
  ["show", "Show"],
  ["scan", "Scan back"],
  ["verified", "Broadcast"],
];

function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="m-0 grid">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-dotted border-rule-2 py-2 text-sm last:border-b-0">
          <dt className="text-ink-2">{k}</dt>
          <dd className="m-0 min-w-0 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Check and show to the signer, take the signed PSBT back, broadcast. `built` is
 * the unsigned PSBT the signed one has to match.
 */
export function SignFlow({
  built,
  title,
  warnings,
  summary,
  label,
  names = {},
  onBack,
  done = null,
  onDone,
  external = false,
}: {
  built: Uint8Array;
  title: string;
  warnings: string[];
  /** Extra facts for the check, such as where the coins come from. */
  summary: [ReactNode, ReactNode][];
  label: string;
  /** Address book names by address, for the outputs that pay them. */
  names?: Record<string, string>;
  onBack: () => void;
  /** The signed transaction already scanned back, to resume at Broadcast. */
  done?: Uint8Array | null;
  onDone?: (raw: Uint8Array) => void;
  /** `built` was signed elsewhere, so there is nothing to match and the check stays up to broadcast. */
  external?: boolean;
}) {
  const { descriptor, network } = useWallet();
  const snapshot = useWalletSnapshot();
  const session = useWalletSession();
  const { backend, connection } = useConnection();
  const [stage, setStage] = useState<Stage>(done ? "verified" : "show");
  const [raw, setRaw] = useState<Uint8Array | null>(done);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const paths = new Map([...(snapshot?.addresses.receive ?? []), ...(snapshot?.addresses.change ?? [])].map((a) => [a.address, a.path]));
  const review = useMemo(() => {
    const review = reviewPsbt(built, descriptor, network);
    // A PSBT signed elsewhere need not say which outputs are this wallet's, so its known addresses say too.
    const change = new Set(snapshot?.addresses.change.map((a) => a.address));
    const outputs = review.outputs.map((o) => (o.address && paths.has(o.address) ? { ...o, mine: true, change: change.has(o.address) } : o));
    return { ...review, outputs };
  }, [built, descriptor, network, snapshot]);
  const inputs = useMemo(() => parsePsbt(built).inputsLength, [built]);

  const signed = (psbt: Uint8Array) => {
    try {
      const final = finaliseSigned(built, psbt);
      setRaw(final);
      onDone?.(final);
      setRefusal(null);
      setFailure(null);
      setStage("verified");
    } catch (e) {
      setRefusal(`This PSBT was refused: ${(e as Error).message}.`);
    }
  };

  const broadcast = async () => {
    if (!backend || !raw || !session) return;
    setSending(true);
    setFailure(null);
    try {
      const txid = await backend.broadcast(raw);
      await session.addTransaction(raw);
      if (label) await session.setLabel("tx", txid, label);
      for (const [vout, o] of review.outputs.entries()) if (o.address && names[o.address]) await session.setLabel("output", `${txid}:${vout}`, names[o.address]!);
      navigate(`/tx/${txid}`);
    } catch (e) {
      setFailure((e as Error).message);
      setSending(false);
    }
  };

  const at = STEPS.findIndex(([s]) => s === stage);
  const payments = review.outputs.filter((o) => !o.change);
  const leaving = payments.filter((o) => !o.mine).reduce((a, o) => a + o.value, 0);
  const notices =
    review.fee > leaving / 10 && leaving > 0
      ? [...warnings, `The fee is ${Math.round((review.fee / leaving) * 100)}% of what you are sending. Make sure that is what you meant.`]
      : warnings;

  const check = (
    <Panel title={external ? "Check before you broadcast" : "Check before you sign"} aside={`${review.outputs.length} output${review.outputs.length === 1 ? "" : "s"}`}>
      <ul className="m-0 grid list-none gap-2 p-0">
        {review.outputs.map((o, i) => (
          <li key={i} className={`grid gap-1 rounded-control border px-3 py-2.5 ${o.change ? "border-rule bg-sunk" : "border-rule-2"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-ink-2">
                {o.change ? "Change back to you" : o.mine ? "To one of your own addresses" : `Payment ${payments.indexOf(o) + 1}${o.address && names[o.address] ? ` to ${names[o.address]}` : ""}`}
              </span>
              <span className="text-md font-medium">
                <Amount sats={o.value} unit />
              </span>
            </div>
            <span className="font-mono text-[0.86em] break-all">{o.address ?? "A script with no address"}</span>
            {o.mine && o.address && paths.get(o.address) && <span className="font-mono text-xs text-ink-3">{paths.get(o.address)}</span>}
          </li>
        ))}
      </ul>
      <Facts
        rows={[
          ["Fee", `${groupSats(review.fee)} sats`],
          ["Fee rate", `${rateText(review.feeRate)} sat/vB, about ${review.vsize} vB`],
          ...summary,
          ["Total leaving the wallet", <Amount sats={leaving + review.fee} unit />],
        ]}
      />
      {!external && (
        <p className="m-0 text-sm text-ink-2">
          <Chip tone="route">Replaceable (RBF)</Chip> Every transaction this wallet builds can be replaced, so you can raise its fee later if it is slow to confirm.
        </p>
      )}
      {notices.map((w) => (
        <Notice key={w} tone="warn">{w}</Notice>
      ))}
    </Panel>
  );

  const body = (
    <>
      {(stage === "show" || external) && check}
      <section
        className={`grid justify-items-stretch gap-4 rounded-panel border border-rule bg-sheet p-4 @min-[900px]:items-start @min-[900px]:gap-x-8 @min-[900px]:gap-y-5 @min-[900px]:p-6 ${stage === "show" ? "@min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @min-[900px]:grid-rows-[repeat(4,auto)_1fr]" : "@min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)]"}`}
      >
        {stage === "show" && (
          <>
            <ExportQr psbt={built} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="camera" onClick={() => setStage("scan")}>
                Signed it, scan it back
              </Button>
              <Button icon="file" onClick={() => download(built)}>
                Save PSBT file
              </Button>
            </div>
          </>
        )}
        {stage === "scan" && (
          <>
            <ScanBack onSigned={signed} error={refusal} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStage("show")}>Back to the code</Button>
            </div>
          </>
        )}
        {stage === "verified" && (
          <div className="grid gap-4 @min-[900px]:col-span-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-md font-semibold">Signed and checked</h2>
              <Chip tone="ok">Ready to broadcast</Chip>
            </div>
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {[
                ["Every input carries a signature", `${inputs} of ${inputs}`],
                ...(external
                  ? [["Every input is one of your coins", `${inputs} of ${inputs}`]]
                  : [
                      ["Outputs match what you built", `${review.outputs.length} of ${review.outputs.length}`],
                      ["Fee matches", `${groupSats(review.fee)} sats`],
                    ]),
              ].map(([what, detail]) => (
                <li key={what} className="grid grid-cols-[24px_1fr_auto] items-center gap-2.5 rounded-control border border-rule px-3 py-2.5">
                  <span className="grid size-[22px] place-items-center rounded-full bg-ok text-sheet">
                    <Icon name="check" className="size-3.5 stroke-[2.6]" />
                  </span>
                  <span>{what}</span>
                  <small className="text-sm text-ink-3">{detail}</small>
                </li>
              ))}
            </ul>
            <p className="m-0 text-sm text-ink-3">
              {connection.phase === "connected"
                ? `Broadcasting sends the transaction to ${hostText(connection.url)} only. Your server relays it to the network.`
                : "Not connected to your server, so there is nowhere to broadcast. Reconnect, then try again."}
            </p>
            {failure && (
              <div role="alert" className="grid gap-1.5 rounded-control bg-bad-tint px-3 py-2.5 text-sm text-bad">
                <b className="font-semibold">Your node refused this transaction. Its reason:</b>
                <span className="font-mono text-[0.86em] break-words">{failure}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={broadcast} disabled={sending || !backend || connection.phase !== "connected"}>
                {sending ? "Broadcasting" : "Broadcast through your server"}
              </Button>
              <Button variant="danger" onClick={onBack} className="ml-auto">
                Discard
              </Button>
            </div>
          </div>
        )}
      </section>
    </>
  );

  return (
    <div className="@container grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="m-0 text-xl font-semibold">{title}</h1>
        <LinkButton onClick={onBack}>{external ? "Load another" : "Back to coins"}</LinkButton>
      </div>
      <nav aria-label="Signing steps" hidden={external} className="flex overflow-hidden rounded-panel border border-rule-2 bg-sheet @min-[900px]:max-w-[720px]">
        {STEPS.map(([s, name], i) => (
          <button
            key={s}
            type="button"
            aria-current={s === stage ? "step" : undefined}
            disabled={s === "verified" ? !raw : false}
            onClick={() => setStage(s)}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 border-l border-rule px-1 text-sm font-medium text-ink-3 first:border-l-0 disabled:cursor-not-allowed aria-[current=step]:bg-route-tint aria-[current=step]:text-ink"
          >
            <i className={`grid size-5 flex-none place-items-center rounded-full border-[1.5px] border-current text-[11px] font-semibold not-italic ${s === stage ? "border-route bg-route text-route-ink" : i < at ? "text-ink-2" : ""}`}>
              {i < at ? <Icon name="check" className="size-3 stroke-[2.6]" /> : i + 1}
            </i>
            {name}
          </button>
        ))}
      </nav>
      {body}
    </div>
  );
}

/** Takes a PSBT signed outside this wallet's own round trip, checks it spends this wallet's coins, and broadcasts it. */
export function BroadcastSigned() {
  const snapshot = useWalletSnapshot();
  const [loaded, setLoaded] = useState<{ psbt: Uint8Array; raw: Uint8Array } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const title = "Broadcast a signed transaction";
  if (!snapshot) return <p className="m-0 text-ink-2">Opening this wallet.</p>;
  if (loaded) return <SignFlow external built={loaded.psbt} done={loaded.raw} title={title} warnings={[]} summary={[]} label="" onBack={() => setLoaded(null)} />;

  const signed = (psbt: Uint8Array) => {
    try {
      setLoaded({ psbt, raw: finaliseExternal(psbt, snapshot.coins) });
      setRefusal(null);
    } catch (e) {
      setRefusal(`This PSBT was refused: ${(e as Error).message}.`);
    }
  };
  return (
    <div className="@container grid gap-4">
      <h1 className="m-0 text-xl font-semibold">{title}</h1>
      <section className="grid justify-items-stretch gap-4 rounded-panel border border-rule bg-sheet p-4 @min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] @min-[900px]:items-start @min-[900px]:gap-x-8 @min-[900px]:gap-y-5 @min-[900px]:p-6">
        <ScanBack onSigned={signed} error={refusal} />
      </section>
    </div>
  );
}
