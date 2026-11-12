import { Amount } from "../../app/amount";
import { sourcesOf } from "../../core/sources";
import type { WalletSnapshot } from "../../core/wallet";
import { linkClass, Panel } from "../../ui/kit";
import { SourceTag } from "../../ui/sources";

/** The wallet's coins by source, largest first: a bar sized by value, and the biggest few by name. */
export function Sources({ snapshot }: { snapshot: WalletSnapshot }) {
  const sources = sourcesOf(snapshot).sort((a, b) => b.total - a.total);
  const total = sources.reduce((a, s) => a + s.total, 0);
  if (!total) return null;
  const gap = sources.length > 1 ? 4 : 0;
  const width = 1000 - gap * (sources.length - 1);
  let at = 0;
  const shown = sources.slice(0, 3);
  return (
    <Panel title="Where it came from" aside={sources.length === 1 ? "1 source" : `${sources.length} sources`}>
      <svg
        viewBox="0 0 1000 14"
        preserveAspectRatio="none"
        className="h-3.5 w-full"
        role="img"
        aria-label={sources.map((s) => `${s.name}, ${Math.round((s.total / total) * 100)}%`).join("; ")}
      >
        {sources.map((s) => {
          const w = (s.total / total) * width;
          const rect = <rect key={s.id} x={at} width={Math.max(w, 2)} height="14" rx="2" className="fill-manila" />;
          at += w + gap;
          return rect;
        })}
      </svg>
      <ul className="m-0 grid list-none gap-2 p-0">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <SourceTag source={s} />
            </span>
            <span className="flex-none text-ink-2">
              <Amount sats={s.total} /> · {Math.round((s.total / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
      <a className={`${linkClass} justify-self-start text-sm`} href="#/coins">
        {sources.length > shown.length ? `All ${sources.length} sources` : "See the coins"}
      </a>
    </Panel>
  );
}
