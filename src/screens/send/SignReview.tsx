import { type ReactNode, useMemo } from "react";
import { Amount } from "../../app/amount";
import { useWalletSnapshot } from "../../app/session";
import { tally } from "../../core/sign";
import { sourcesOf } from "../../core/sources";
import { groupSats } from "../../ui/amount";
import { shortId } from "../../ui/format";
import { Chip, Notice, Panel } from "../../ui/kit";
import { rateText } from "../../wallet/fees";
import type { PsbtReview } from "../../wallet/psbt";
import { CustodyLog } from "./CustodyLog";

function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="m-0 grid">
      {rows.map(([k, v], i) => (
        <div
          key={i}
          className="flex items-baseline justify-between gap-3 border-b border-dotted border-rule-2 py-2 text-sm last:border-b-0"
        >
          <dt className="text-ink-2">{k}</dt>
          <dd className="m-0 min-w-0 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every output of the transaction to sign, with its fee, for checking against the signer's screen. */
export function Check({
  title,
  review,
  names,
  summary,
  notices,
  external,
}: {
  title: string;
  review: PsbtReview;
  names: Record<string, string>;
  summary: [ReactNode, ReactNode][];
  notices: string[];
  external: boolean;
}) {
  const snapshot = useWalletSnapshot();
  const paths = new Map(
    [...(snapshot?.addresses.receive ?? []), ...(snapshot?.addresses.change ?? [])].map((a) => [a.address, a.path]),
  );
  const { payments, leaving } = tally(review);
  return (
    <Panel title={title} aside={`${review.outputs.length} output${review.outputs.length === 1 ? "" : "s"}`}>
      <ul className="m-0 grid list-none gap-2 p-0">
        {[...review.outputs]
          .sort((a, b) => Number(a.change) - Number(b.change))
          .map((o, i) => (
            <li
              key={i}
              className={`grid gap-1 rounded-control border px-3 py-2.5 ${o.change ? "border-rule bg-sunk" : "border-rule-2"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-ink-2">
                  {o.change
                    ? "Change back to you"
                    : o.mine
                      ? "To one of your own addresses"
                      : `Payment ${payments.indexOf(o) + 1}${o.address && names[o.address] ? ` to ${names[o.address]}` : ""}`}
                </span>
                <span className="text-md font-medium">
                  <Amount sats={o.value} unit />
                </span>
              </div>
              <span className="font-mono text-[0.86em] break-all">{o.address ?? "A script with no address"}</span>
              {o.mine && o.address && paths.get(o.address) && (
                <span className="font-mono text-xs text-ink-3">{paths.get(o.address)}</span>
              )}
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
          <Chip tone="carbon">Replaceable (RBF)</Chip> Every transaction this wallet builds can be replaced, so you can
          raise its fee later if it's slow to confirm.
        </p>
      )}
      {notices.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
    </Panel>
  );
}

/** The payment in brief, beside the steps. `inputs` are the coins it spends, for the custody log. */
export function Recap({ label, review, inputs }: { label: string; review: PsbtReview; inputs?: string[] }) {
  const snapshot = useWalletSnapshot();
  const sources = useMemo(() => (snapshot && inputs ? sourcesOf(snapshot) : []), [snapshot, inputs]);
  const { payments, leaving, change } = tally(review);
  return (
    <Panel title={label || "This payment"} className="@min-[900px]:sticky @min-[900px]:top-20">
      <Facts
        rows={[
          ["Sending", <Amount sats={leaving} unit />],
          [
            "To",
            payments.length === 1 ? (
              <span className="font-mono">
                {payments[0]!.address ? shortId(payments[0]!.address, 10, 8) : "A script with no address"}
              </span>
            ) : (
              `${payments.length} recipients`
            ),
          ],
          ["Fee", `${groupSats(review.fee)} sats, ${rateText(review.feeRate)} sat/vB`],
          ["Change", change ? <Amount sats={change} /> : "None"],
        ]}
      />
      {inputs && <CustodyLog sources={sources} selected={new Set(inputs)} still />}
    </Panel>
  );
}
