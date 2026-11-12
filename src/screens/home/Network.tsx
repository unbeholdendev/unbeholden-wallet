import { groupSats } from "../../ui/amount";
import { Panel } from "../../ui/kit";
import { BLOCK_VSIZE, eta, feeTargets, rateText } from "../../wallet/fees";
import { useFeeHistogram } from "../send/fees";

/** What the node's mempool says sending costs right now. */
export function Network() {
  const histogram = useFeeHistogram();
  if (!histogram) return null;
  const targets = feeTargets(histogram);
  const vsize = histogram.reduce((a, b) => a + b.vsize, 0);
  const blocks = Math.ceil(vsize / BLOCK_VSIZE);
  return (
    <Panel title="Network" aside="From your node">
      {vsize ? (
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-ink-2">Next block</dt>
          <dd className="m-0 text-right tabular-nums">{rateText(targets.nextBlock)} sat/vB</dd>
          <dt className="text-ink-2">Within an hour</dt>
          <dd className="m-0 text-right tabular-nums">{rateText(targets.sixBlocks)} sat/vB</dd>
          <dt className="text-ink-2">Waiting in the mempool</dt>
          <dd className="m-0 text-right tabular-nums">
            {groupSats(blocks)} block{blocks === 1 ? "" : "s"}, {eta(blocks)}
          </dd>
        </dl>
      ) : (
        <p className="m-0 text-sm text-ink-2">The mempool is empty. Any fee from 1 sat/vB gets into the next block.</p>
      )}
    </Panel>
  );
}
