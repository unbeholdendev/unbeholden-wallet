import type { Source } from "../core/sources";

/** A manila luggage tag with the source's name: carbon once any of its coins are picked, grey when all are frozen. */
export function SourceTag({ source, large = false, on = false }: { source: Source; large?: boolean; on?: boolean }) {
  const muted = !on && source.coins.every((c) => c.frozen);
  return (
    <span
      className={`relative inline-flex max-w-full flex-none items-center font-bold tracking-[0.03em] [clip-path:polygon(7px_0,100%_0,100%_100%,7px_100%,0_50%)] ${large ? "h-[26px] min-w-10 pr-2 pl-[15px] text-[14px] [mask:radial-gradient(circle_at_9px_50%,transparent_2px,#000_2.5px)]" : "h-[22px] min-w-[34px] pr-[7px] pl-[13px] text-xs [mask:radial-gradient(circle_at_8px_50%,transparent_2px,#000_2.5px)]"} ${on ? "bg-carbon text-carbon-ink" : muted ? "bg-sunk text-ink-3" : "bg-manila text-manila-ink"}`}
    >
      <span className="truncate">{source.name}</span>
    </span>
  );
}
