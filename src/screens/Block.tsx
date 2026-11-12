import { type ReactNode, useEffect, useState } from "react";
import { useConnection } from "../app/connection";
import { type LookedUpBlock, lookupBlock } from "../core/lookup";
import { groupSats } from "../ui/amount";
import { dateText, timeText } from "../ui/format";
import { Empty, linkClass } from "../ui/kit";
import { CopyButton } from "./parts";

type Found = { height: number } & ({ block: LookedUpBlock } | { error: string });

const difficultyText = (d: number) => (d < 1 ? d.toPrecision(3) : groupSats(d));

/** A block on the server's chain by its height, read fresh when opened and on each block. */
export function Block({ height: param }: { height: string | undefined }) {
  const { backend, connection } = useConnection();
  const live = connection.phase === "connected" ? backend : null;
  const tip = connection.phase === "connected" ? connection.tip : null;
  const height = param && /^\d+$/.test(param) ? Number(param) : null;
  const mined = height !== null && tip !== null && height <= tip;
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    if (!live || !mined) return;
    let cancelled = false;
    lookupBlock(live, height).then(
      (block) => cancelled || setFound({ height, block }),
      (error) => cancelled || setFound({ height, error: String((error as Error)?.message ?? error) }),
    );
    return () => void (cancelled = true);
  }, [live, height, mined, tip]);

  if (height === null)
    return (
      <Empty title="That isn't a block height">
        <p className="m-0">A block height is a whole number, 0 for the first block.</p>
      </Empty>
    );
  if (tip === null)
    return (
      <Empty title="Not connected">
        <p className="m-0">
          Looking a block up needs the server.{" "}
          <a href="#/connect" className={linkClass}>
            Connect to it
          </a>
          .
        </p>
      </Empty>
    );
  if (!mined)
    return (
      <Empty title={`Block ${groupSats(height)} isn't mined yet`}>
        <p className="m-0">
          The chain's tip is{" "}
          <a href={`#/block/${tip}`} className={linkClass}>
            block {groupSats(tip)}
          </a>
          .
        </p>
      </Empty>
    );
  const current = found?.height === height ? found : null;
  if (!current) return <p className="m-0 text-ink-3">Looking the block up.</p>;
  if ("error" in current)
    return (
      <Empty title="The lookup failed">
        <p className="m-0">{current.error}</p>
      </Empty>
    );

  const { block } = current;
  const rows: [string, ReactNode][] = [
    ["Time", `${dateText(block.time)}, ${timeText(block.time)}`],
    ["Confirmations", groupSats(tip - height + 1)],
    ["Difficulty", difficultyText(block.difficulty)],
  ];
  return (
    <section className="grid max-w-2xl gap-4 rounded-panel border border-rule bg-sheet p-4">
      <h1 className="m-0 text-lg font-bold">Block {groupSats(height)}</h1>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-ink-2">{name}</dt>
            <dd className="m-0 text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-1.5 border-t border-rule pt-3">
        <span className="text-sm text-ink-2">Block hash</span>
        <span className="font-mono text-[0.86em] break-all select-all">{block.hash}</span>
        <span className="justify-self-start">
          <CopyButton text={block.hash} what="Block hash" />
        </span>
      </div>
      <nav aria-label="Neighbouring blocks" className="flex justify-between gap-3 border-t border-rule pt-3 text-sm">
        {height > 0 ? (
          <a href={`#/block/${height - 1}`} className={linkClass}>
            ← Block {groupSats(height - 1)}
          </a>
        ) : (
          <span />
        )}
        {height < tip && (
          <a href={`#/block/${height + 1}`} className={linkClass}>
            Block {groupSats(height + 1)} →
          </a>
        )}
      </nav>
    </section>
  );
}
