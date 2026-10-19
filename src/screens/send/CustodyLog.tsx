import { useLayoutEffect, useRef } from "react";
import { Amount } from "../../ui/amount";
import { Icon } from "../../ui/icons";
import { SourceTag, type Source } from "../../ui/sources";
import { outpoint } from "../../wallet/coin";

/**
 * Each source the picked coins come from, numbered, as a chain analyst would
 * note them, and whether spending them together joins them. `still` skips the motion.
 */
export function CustodyLog({ sources, selected, still = false }: { sources: Source[]; selected: Set<string>; still?: boolean }) {
  const linked = sources.flatMap((source) => {
    const coins = source.coins.filter((c) => selected.has(outpoint(c)));
    return coins.length ? [{ source, coins }] : [];
  });
  const n = linked.length;
  const last = useRef<{ ids: Set<string>; n: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const before = still ? null : last.current;
  const grow = !!before && n > 1 && n > before.n;
  useLayoutEffect(() => {
    if (grow && before) list.current?.style.setProperty("--from", String(before.n > 1 ? (before.n - 1) / n : 0));
    last.current = { ids: new Set(linked.map((l) => l.source.id)), n };
  });
  if (!n) return null;
  return (
    <div className="grid">
      <ol
        key={n}
        ref={list}
        className={`relative m-0 list-none border-t border-ink p-0 ${n > 1 ? "before:absolute before:top-6 before:bottom-0 before:left-[37.5px] before:w-[3px] before:origin-top before:bg-tamper before:content-['']" : ""} ${grow ? "before:animate-seam" : ""}`}
      >
        {linked.map(({ source, coins }, i) => (
          <li
            key={source.id}
            className={`grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-2 border-b border-rule py-[11px] ${before && !before.ids.has(source.id) ? "animate-entry-in" : ""}`}
          >
            <span className="text-sm leading-[26px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            <div className="grid min-w-0 justify-items-start">
              <SourceTag source={source} large />
              <span className={`ml-[18px] text-sm ${source.kyc.length ? "font-medium text-ink" : "text-ink-2"}`}>
                {source.kyc.length ? "Knows who you are" : "Not marked as knowing who you are"}
              </span>
              <span className="mt-1.5 ml-[18px] text-sm text-ink-2">
                {coins.length} coin{coins.length === 1 ? "" : "s"} picked
              </span>
            </div>
            <span className="text-[14px] leading-[26px]">
              <Amount sats={coins.reduce((a, c) => a + c.value, 0)} />
            </span>
          </li>
        ))}
      </ol>
      {n > 1 ? (
        <div className="ml-8 flex min-h-[30px] items-center gap-2 bg-tamper bg-[repeating-linear-gradient(-45deg,transparent_0_10px,rgb(255_255_255/.14)_10px_20px)] px-5 py-1 text-xs font-bold tracking-[0.08em] text-tamper-ink uppercase [clip-path:polygon(0_0,100%_0,calc(100%-8px)_50%,100%_100%,0_100%,8px_50%)]">
          <Icon name="join" className="size-[15px] stroke-[2.2]" />
          Joined in one transaction
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-control bg-ok-tint px-3 py-2.5 text-[14px] text-ok">
          <Icon name="check" className="mt-px size-[18px]" />
          <span>No new links. Every coin picked comes from {linked[0]!.source.name}, which is already linked.</span>
        </div>
      )}
    </div>
  );
}
