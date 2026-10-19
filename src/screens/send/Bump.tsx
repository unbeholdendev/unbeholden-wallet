import { useState } from "react";
import { useWallet, useWalletSnapshot } from "../../app/session";
import { planBump, type BumpProblem } from "../../core/bump";
import { nextChange } from "../../core/view";
import { Amount, groupSats } from "../../ui/amount";
import { Button, Empty, Notice, Panel } from "../../ui/kit";
import { buildPsbt } from "../../wallet/psbt";
import { FeePanel, rateOf, rateText, useFeeHistogram, type FeeChoice } from "./fees";
import type { Built } from "./Send";
import { SignFlow } from "./Sign";

function why(problem: BumpProblem): string {
  switch (problem.kind) {
    case "confirmed":
      return "This transaction is already in a block, so there is nothing to speed up.";
    case "not-ours":
      return "Some of its coins are not this wallet's, so it cannot be rebuilt and signed here.";
    case "has-children":
      return "A later transaction of yours spends its change. Replacing this one would cancel that one too, so it is not offered.";
    case "unsupported-output":
      return "It has an output with no address, such as an OP_RETURN, which this wallet cannot rebuild.";
    case "below-minimum":
      return `A replacement has to pay at least ${rateText(problem.minFeeRate)} sat/vB, or your node will refuse it.`;
    case "insufficient":
      return `Your confirmed coins are ${groupSats(problem.missing)} sats short of the higher fee.`;
  }
}

/** Rebuilds an unconfirmed wallet transaction at a higher fee rate, then the same signing round trip. */
export function Bump({ txid }: { txid: string }) {
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

  const wallet = { ...kind, network, nextChange: nextChange(snapshot) };
  const floor = planBump(tx, snapshot.coins, rateOf(fee, histogram), wallet).minFeeRate;
  const rate = rateOf(fee, histogram, floor);
  const plan = planBump(tx, snapshot.coins, rate, wallet);
  const added = plan.coins.slice(tx.inputs.length);
  const oldChange = tx.outputs.find((o) => o.mine?.chain === 1)?.value ?? 0;

  if (built)
    return <SignFlow built={built.psbt} title="Sign the replacement" warnings={built.warnings} summary={built.summary} label={built.label} onBack={() => setBuilt(null)} />;

  const build = () => {
    try {
      const { psbt, warnings } = buildPsbt({ descriptor, network, coins: plan.coins, recipients: plan.recipients, change: plan.change, tip: snapshot.tip });
      setError(null);
      setBuilt({
        psbt,
        warnings,
        label: tx.label ?? "",
        summary: [
          ["Replaces", <span className="font-mono text-[0.86em]">{`${txid.slice(0, 10)}…${txid.slice(-6)}`}</span>],
          ["Extra cost", `${groupSats(plan.spend.fee - plan.oldFee)} sats`],
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

  return (
    <div className="@container grid gap-4">
      <div className="grid gap-1">
        <h1 className="m-0 text-xl font-semibold">Speed up this transaction</h1>
        <p className="m-0 max-w-[60ch] text-ink-2">
          {tx.label ? `${tx.label}. ` : ""}A replacement pays the same people the same amounts with a higher fee, so miners prefer it. It goes through your signer again.
        </p>
      </div>
      <div className="grid gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_440px] @min-[900px]:items-start">
        <FeePanel histogram={histogram} choice={fee} onChange={setFee} floor={plan.minFeeRate} />
        <Panel title="Old and new" aside={<span className="font-mono">{`${txid.slice(0, 8)}…${txid.slice(-6)}`}</span>}>
          <div className="grid grid-cols-2 gap-2">
            {side("Now", plan.oldFeeRate, plan.oldFee, false)}
            {side("Replacement", plan.spend.fee / plan.spend.vsize, plan.spend.fee, true)}
          </div>
          <dl className="m-0 grid text-sm [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-dotted [&>div]:border-rule-2 [&>div]:py-1.5 [&_dt]:text-ink-2 [&_dd]:m-0">
            <div>
              <dt>Extra cost</dt>
              <dd className="font-semibold">{groupSats(Math.max(plan.spend.fee - plan.oldFee, 0))} sats</dd>
            </div>
            <div>
              <dt>Payments, unchanged</dt>
              <dd><Amount sats={plan.recipients.reduce((a, r) => a + r.value, 0)} /></dd>
            </div>
            <div>
              <dt>Change back to you</dt>
              <dd>
                <Amount sats={oldChange} /> to {plan.change ? <Amount sats={plan.change.value} /> : "none"}
              </dd>
            </div>
            <div className="border-b-0">
              <dt>Lowest rate your node accepts</dt>
              <dd>{rateText(plan.minFeeRate)} sat/vB</dd>
            </div>
          </dl>
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
          {plan.problem && <Notice tone="bad">{why(plan.problem)}</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <Button variant="primary" wide disabled={!!plan.problem} onClick={build}>
            Build the replacement
          </Button>
        </Panel>
      </div>
    </div>
  );
}
