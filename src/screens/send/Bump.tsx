import { useState } from "react";
import { useWallet, useWalletSnapshot } from "../../app/session";
import { planBump, planCpfp, type BumpProblem } from "../../core/bump";
import { nextChange } from "../../core/view";
import { Amount, groupSats } from "../../ui/amount";
import { Button, Empty, Notice, Panel } from "../../ui/kit";
import { buildPsbt } from "../../wallet/psbt";
import { FeePanel, rateOf, rateText, useFeeHistogram, type FeeChoice } from "./fees";
import type { Built } from "./Send";
import { SignFlow } from "./Sign";

export type BumpMode = "speed" | "cancel" | "cpfp";

const COPY = {
  speed: {
    heading: "Speed up this transaction",
    intro: "A replacement pays the same people the same amounts with a higher fee, so miners prefer it. It goes through your signer again.",
    after: "Replacement",
    build: "Build the replacement",
    sign: "Sign the replacement",
    link: "Replaces",
  },
  cancel: {
    heading: "Cancel this transaction",
    intro: "A replacement sends the same coins back to your own address with a higher fee, so miners prefer it. It works only if it reaches a block first: if the original confirms before it, the payment stands. It goes through your signer again.",
    after: "Replacement",
    build: "Build the cancellation",
    sign: "Sign the cancellation",
    link: "Cancels",
  },
  cpfp: {
    heading: "Speed up with a child transaction",
    intro: "A new transaction spends what this one pays you back to your own address, with a fee high enough that miners take both together. The original stays as it is. The child goes through your signer.",
    after: "With the child",
    build: "Build the child",
    sign: "Sign the child transaction",
    link: "Pays for",
  },
};

function why(problem: BumpProblem, mode: BumpMode): string {
  switch (problem.kind) {
    case "confirmed":
      return "This transaction is already in a block, so there is nothing to speed up.";
    case "not-ours":
      return "Some of its coins are not this wallet's, so it cannot be rebuilt and signed here.";
    case "has-children":
      return "A later transaction of yours spends its change. Replacing this one would cancel that one too, so it is not offered.";
    case "unsupported-output":
      return "It has an output with no address, such as an OP_RETURN, which this wallet cannot rebuild.";
    case "fee-unknown":
      return "Its fee is unknown, because this wallet does not have the transactions its coins came from, so it cannot work out what the child must pay.";
    case "nothing-to-spend":
      return "Nothing it pays this wallet is left unspent and unfrozen, so there is no coin for a child to spend.";
    case "below-minimum":
      return mode === "cpfp"
        ? `It already pays about that. Choose at least ${rateText(problem.minFeeRate)} sat/vB.`
        : `A replacement has to pay at least ${rateText(problem.minFeeRate)} sat/vB, or your node will refuse it.`;
    case "insufficient":
      return mode === "cpfp"
        ? `What this transaction pays you is ${groupSats(problem.missing)} sats short of the child's fee.`
        : `Your confirmed coins are ${groupSats(problem.missing)} sats short of the higher fee.`;
  }
}

/** Rebuilds an unconfirmed wallet transaction at a higher fee rate, cancels it, or pays for it with a child, then the same signing round trip. */
export function Bump({ txid, mode }: { txid: string; mode: BumpMode }) {
  const snapshot = useWalletSnapshot();
  const { descriptor, network, kind } = useWallet();
  const histogram = useFeeHistogram();
  const [fee, setFee] = useState<FeeChoice>({ preset: "nextBlock" });
  const [built, setBuilt] = useState<Built | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!snapshot) return <p className="m-0 text-ink-2">Opening this wallet.</p>;
  const tx = snapshot.transactions.find((t) => t.txid === txid);
  if (!tx)
    return (
      <Empty title="This transaction is not in this wallet">
        <p className="m-0">It may belong to another wallet, or a replacement has already taken its place.</p>
      </Empty>
    );

  const copy = COPY[mode];
  const wallet = { ...kind, network, nextChange: nextChange(snapshot) };
  const planAt = (rate: number) =>
    mode === "cpfp" ? planCpfp(tx, snapshot.coins, rate, wallet) : planBump(tx, snapshot.coins, rate, wallet, mode === "cancel");
  const plan = planAt(rateOf(fee, histogram, planAt(rateOf(fee, histogram)).minFeeRate));
  const added = mode === "cpfp" ? [] : plan.coins.slice(tx.inputs.length);
  const changeOut = (o: { mine: { chain: number } | null }) => o.mine?.chain === 1;
  const before = mode === "cpfp" ? plan.coins.reduce((a, c) => a + c.value, 0) : (tx.outputs.find(changeOut)?.value ?? 0);
  const payments = tx.outputs.filter((o) => !changeOut(o)).reduce((a, o) => a + (o.value ?? 0), 0);
  const extra = mode === "cpfp" ? plan.spend.fee : plan.spend.fee - plan.oldFee;

  if (built)
    return <SignFlow built={built.psbt} title={copy.sign} warnings={built.warnings} summary={built.summary} label={built.label} onBack={() => setBuilt(null)} />;

  const build = () => {
    try {
      const { psbt, warnings } = buildPsbt({ descriptor, network, coins: plan.coins, recipients: plan.recipients, change: plan.change, tip: snapshot.tip });
      setError(null);
      setBuilt({
        psbt,
        warnings,
        label: tx.label ?? "",
        summary: [
          [copy.link, <span className="font-mono text-[0.86em]">{`${txid.slice(0, 10)}…${txid.slice(-6)}`}</span>],
          ["Extra cost", `${groupSats(extra)} sats`],
        ],
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const side = (title: string, r: number, sats: number, accent: boolean) => (
    <div className={`grid gap-1 rounded-control border px-3 py-3 ${accent ? "border-route bg-route-tint" : "border-rule bg-sunk"}`}>
      <span className="text-sm font-medium text-ink-2">{title}</span>
      <span className="text-xl font-medium">
        {rateText(r)} <small className="text-sm font-normal text-ink-2">sat/vB</small>
      </span>
      <span className="text-sm text-ink-2">{groupSats(sats)} sats fee</span>
    </div>
  );
  const after =
    mode === "cpfp"
      ? side(copy.after, (plan.oldFee + plan.spend.fee) / (tx.vsize + plan.spend.vsize), plan.oldFee + plan.spend.fee, true)
      : side(copy.after, plan.spend.fee / plan.spend.vsize, plan.spend.fee, true);

  return (
    <div className="@container grid gap-4">
      <div className="grid gap-1">
        <h1 className="m-0 text-xl font-semibold">{copy.heading}</h1>
        <p className="m-0 max-w-[60ch] text-ink-2">
          {tx.label ? `${tx.label}. ` : ""}
          {copy.intro}
        </p>
      </div>
      <div className="grid gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_440px] @min-[900px]:items-start">
        <FeePanel histogram={histogram} choice={fee} onChange={setFee} floor={plan.minFeeRate} />
        <Panel title="Old and new" aside={<span className="font-mono">{`${txid.slice(0, 8)}…${txid.slice(-6)}`}</span>}>
          <div className="grid grid-cols-2 gap-2">
            {side("Now", plan.oldFeeRate, plan.oldFee, false)}
            {after}
          </div>
          <dl className="m-0 grid text-sm [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-dotted [&>div]:border-rule-2 [&>div]:py-1.5 [&_dt]:text-ink-2 [&_dd]:m-0">
            <div>
              <dt>Extra cost</dt>
              <dd className="font-semibold">{groupSats(Math.max(extra, 0))} sats</dd>
            </div>
            {mode !== "cpfp" && (
              <div>
                <dt>{mode === "cancel" ? "Payments, cancelled" : "Payments, unchanged"}</dt>
                <dd><Amount sats={payments} /></dd>
              </div>
            )}
            <div>
              <dt>{mode === "speed" ? "Change back to you" : "Back to you"}</dt>
              <dd>
                <Amount sats={before} /> to {plan.change ? <Amount sats={Math.max(plan.change.value, 0)} /> : "none"}
              </dd>
            </div>
            <div className="border-b-0">
              <dt>{mode === "cpfp" ? "Lowest rate that helps" : "Lowest rate your node accepts"}</dt>
              <dd>{rateText(plan.minFeeRate)} sat/vB</dd>
            </div>
          </dl>
          {mode === "cpfp" && (
            <p className="m-0 text-sm text-ink-2">
              The child alone pays {rateText(plan.spend.fee / plan.spend.vsize)} sat/vB. Your node takes it only if that meets its minimum relay fee, or if it supports package relay and takes the two together. If the original is replaced, the child goes with it.
            </p>
          )}
          {added.length > 0 && (
            <Notice tone="warn">
              Change could not cover the higher fee, so {added.length === 1 ? "this coin is" : "these coins are"} added:{" "}
              {added.map((c, i) => (
                <span key={`${c.txid}:${c.vout}`}>
                  {i ? ", " : ""}
                  <Amount sats={c.value} />
                </span>
              ))}
              . That links {added.length === 1 ? "it" : "them"} to this transaction's coins.
            </Notice>
          )}
          {plan.problem && <Notice tone="bad">{why(plan.problem, mode)}</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <Button variant="primary" wide disabled={!!plan.problem} onClick={build}>
            {copy.build}
          </Button>
        </Panel>
      </div>
    </div>
  );
}
