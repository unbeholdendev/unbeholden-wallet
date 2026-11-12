import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Amount } from "../../app/amount";
import { useConnection } from "../../app/connection";
import { useSendDraft, useWallet, useWalletSession, useWalletSnapshot } from "../../app/session";
import { useBook, useVault } from "../../app/vault";
import {
  blankDraft,
  buildSend,
  bulk,
  type Draft,
  planSend,
  type SendDraft,
  type SendProblem,
  selectable,
  stillPending,
} from "../../core/send";
import { type Source, sourcesOf } from "../../core/sources";
import { nextChange } from "../../core/view";
import type { WalletCoin, WalletSnapshot } from "../../core/wallet";
import { groupSats } from "../../ui/amount";
import { shortId } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { Button, Chip, linkClass, Notice } from "../../ui/kit";
import { Sheet } from "../../ui/sheet";
import { outpoint } from "../../wallet/coin";
import { type FeeChoice, rateOf, rateText } from "../../wallet/fees";
import { CoinList } from "./CoinList";
import { CustodyLog } from "./CustodyLog";
import { FeePanel, useFeeHistogram } from "./fees";
import { Recipients } from "./Recipients";
import { SignFlow } from "./Sign";

const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);

/** Plays its background once whenever the value changes, so a moved total catches the eye. */
function Flash({ value, children }: { value: number; children: ReactNode }) {
  const first = useRef(value);
  return (
    <span key={value} className={`rounded-chip px-0.5 ${value === first.current ? "" : "animate-value-flash"}`}>
      {children}
    </span>
  );
}

function blocker(problem: SendProblem | null): string | null {
  switch (problem?.kind) {
    case "no-recipient":
      return "Enter who to pay";
    case "bad-address":
      return "Fix the address first";
    case "no-amount":
      return "Enter an amount";
    case "no-coins":
      return "Select coins to pay from";
    case "insufficient":
      return `Short by ${groupSats(problem.missing)} sats`;
    case "dust":
      return `Payment ${problem.recipient + 1} is too small to send`;
    default:
      return null;
  }
}

function Compose({
  snapshot,
  draft,
  update,
  onDiscard,
}: {
  snapshot: WalletSnapshot;
  draft: SendDraft;
  update: (patch: Partial<SendDraft>) => void;
  onDiscard?: () => void;
}) {
  const { descriptor, network, kind } = useWallet();
  const { drafts, fee } = draft;
  const setDrafts = (drafts: Draft[]) => update({ drafts });
  const setFee = (fee: FeeChoice) => update({ fee });
  const setSelected = (next: Set<string>) => update({ picked: [...next] });
  const [pending, setPending] = useState<WalletCoin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLElement>(null);
  const histogram = useFeeHistogram();
  const [book, saveBook] = useBook();
  const skip = !!useVault().settings.skipForeignUnconfirmed;
  const take = skip ? bulk : selectable;
  const named = new Map(book.map((c) => [c.address, c.name]));

  const sources = useMemo(() => sourcesOf(snapshot), [snapshot]);
  const own = useMemo(
    () => new Set([...snapshot.addresses.receive, ...snapshot.addresses.change].map((a) => a.address)),
    [snapshot],
  );
  const rate = rateOf(fee, histogram);
  const plan = useMemo(
    () => planSend(snapshot, sources, draft, rate, { ...kind, network }, skip),
    [snapshot, sources, draft, rate, kind, network, skip],
  );
  const { selected, chosen, spend: result, privacy: report, left, foreign, suggestion } = plan;
  const linked = report.sources.length;
  const stop = blocker(plan.problem);
  const change = nextChange(snapshot);
  const leftOut = (
    [
      [left.filter((c) => c.frozen).length, "frozen"],
      [left.filter((c) => !c.frozen && c.status === "unconfirmed-parents").length, "waiting on an unconfirmed parent"],
      [left.filter((c) => !c.frozen && c.status === "foreign-unconfirmed").length, "unconfirmed from someone else"],
    ] as const
  )
    .filter(([n]) => n)
    .map(([n, why]) => `${n} ${why}`)
    .join(", ");

  const toggle = (coin: WalletCoin) => {
    const key = outpoint(coin);
    if (skip && !selected.has(key) && coin.status === "foreign-unconfirmed") return setPending(coin);
    const next = new Set(selected);
    if (!next.delete(key)) next.add(key);
    setSelected(next);
  };

  const review = () => {
    try {
      const built = buildSend(plan, drafts, snapshot, { descriptor, network }, named);
      setError(null);
      update({ built });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const group = (source: Source) => {
    const open = source.coins.filter(take).map(outpoint);
    const next = new Set(selected);
    if (open.every((k) => next.has(k))) open.forEach((k) => next.delete(k));
    else open.forEach((k) => next.add(k));
    setSelected(next);
  };
  const primary = (size: "sm" | "md") => (
    <Button variant="primary" size={size} wide={size === "md"} disabled={!!stop} onClick={review}>
      {size === "sm" ? "Review" : (stop ?? "Review and sign")}
    </Button>
  );

  return (
    <div className="@container">
      <h1 className="sr-only">Send</h1>
      <div className="grid gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_440px] @min-[900px]:items-start">
        <div className="grid min-w-0 gap-4">
          <Recipients
            drafts={drafts}
            onChange={setDrafts}
            network={network}
            own={own}
            maxAmounts={result.amounts}
            book={book}
            onSave={(c) => saveBook([...book.filter((b) => b.address !== c.address), c])}
          />
          {left.length > 0 && (
            <Notice tone="warn">
              Sending everything spendable. Left out, <Amount sats={left.reduce((a, c) => a + c.value, 0)} unit />:{" "}
              {leftOut}.
            </Notice>
          )}
          <FeePanel histogram={histogram} choice={fee} onChange={setFee} />
          <CoinList
            sources={sources}
            tip={snapshot.tip?.height ?? null}
            rate={rate}
            selected={selected}
            onToggle={toggle}
            onGroup={group}
            onPick={() => update({ picked: null })}
            onClear={() => update({ picked: [] })}
            picking={!draft.picked || !snapshot.coins.some(selectable)}
            take={take}
          />
        </div>
        <div className="grid min-w-0 content-start gap-4 @min-[900px]:sticky @min-[900px]:top-20 @min-[900px]:max-h-[calc(100dvh-96px)] @min-[900px]:overflow-y-auto">
          <section
            ref={log}
            aria-label="Custody log"
            className="scroll-mt-20 rounded-panel border border-rule bg-sheet"
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-4">
              <h2 className="text-md font-bold">Custody log</h2>
              {linked > 1 && (
                <Chip tone="join">
                  <Icon name="join" className="size-3.5" />
                  Joins {linked}
                </Chip>
              )}
            </div>
            <p className="m-0 px-4 pt-1 text-sm text-ink-3">
              What a chain analyst would write down about this transaction.
            </p>
            <p aria-live="polite" className="sr-only">
              {linked > 1 ? `Joins ${linked} sources` : linked === 1 ? "No new links" : ""}
            </p>
            <div className="grid gap-2.5 px-4 pt-3 pb-4">
              <CustodyLog sources={sources} selected={selected} />
              {linked !== 1 && (
                <p className={`m-0 max-w-[60ch] ${linked ? "" : "text-ink-2"}`}>
                  {linked === 0
                    ? draft.picked
                      ? "Pick coins from the list, or let Pick for me choose."
                      : "Enter an amount and coins are picked for you, from one source where they can be. Tap a coin to choose yourself."
                    : report.warnings.find((w) => w.kind === "links-sources")!.message}
                </p>
              )}
              {report.warnings
                .filter((w) => w.kind !== "links-sources")
                .map((w) => (
                  <p key={w.kind + w.message} className="m-0 max-w-[60ch] text-sm text-ink-2">
                    {w.message}
                  </p>
                ))}
              {suggestion &&
                (suggestion.coins ? (
                  <div className="grid justify-items-start gap-2 rounded-control border border-rule-2 p-3">
                    <span>
                      No single source covers this payment. Use only coins from sources that already know who you are,{" "}
                      {and(suggestion.known)}, and {and(suggestion.open)}{" "}
                      {suggestion.open.length > 1 ? "stay" : "stays"} private.
                    </span>
                    <Button size="sm" onClick={() => setSelected(new Set(suggestion.coins!.map(outpoint)))}>
                      Use only those coins
                    </Button>
                  </div>
                ) : (
                  <p className="m-0 max-w-[60ch] text-sm text-ink-2">
                    No single source covers this payment, and neither do the sources that already know you, so some
                    private coins have to be joined.
                  </p>
                ))}
              {report.change && <p className="m-0 max-w-[60ch] text-sm text-ink-2">{report.change}</p>}
              {foreign.length > 0 && (
                <Notice tone="warn">
                  {foreign.length === 1 ? "One selected coin is" : `${foreign.length} selected coins are`} an
                  unconfirmed payment from someone else. They can still replace it, and then this transaction fails with
                  it.
                </Notice>
              )}
            </div>
          </section>
          <section aria-label="Summary" className="rounded-panel border border-rule bg-sheet">
            <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
              <h2 className="text-md font-bold">Summary</h2>
              <span className="text-sm text-ink-3">Replaceable (RBF)</span>
            </div>
            <dl className="m-0 grid px-4 pt-1 pb-4 text-sm [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-dotted [&>div]:border-rule-2 [&>div]:py-1.5 [&_dt]:text-ink-2 [&_dd]:m-0 [&_dd]:text-right">
              <div>
                <dt>Coins in ({chosen.length})</dt>
                <dd>
                  <Flash value={result.coins.reduce((a, c) => a + c.value, 0)}>
                    <Amount sats={result.coins.reduce((a, c) => a + c.value, 0)} />
                  </Flash>
                </dd>
              </div>
              <div>
                <dt>Sending</dt>
                <dd>
                  <Amount sats={result.amounts.reduce((a, b) => a + b, 0)} />
                </dd>
              </div>
              <div>
                <dt>
                  Fee
                  <small className="block text-xs text-ink-3">
                    {rateText(rate)} sat/vB &middot; {result.vsize} vB
                  </small>
                </dt>
                <dd>
                  <Flash value={result.fee}>{groupSats(result.fee)} sats</Flash>
                </dd>
              </div>
              <div>
                <dt>
                  Change back to you
                  {result.change > 0 && (
                    <small className="block font-mono text-xs text-ink-3">
                      {shortId(change.address, 10, 6)} &middot; {change.path}
                    </small>
                  )}
                </dt>
                <dd>
                  <Flash value={result.change}>{result.change ? <Amount sats={result.change} /> : "None"}</Flash>
                </dd>
              </div>
              <div className="border-b-0 pt-2.5 text-md font-bold [&_dt]:text-ink">
                <dt>Total leaving the wallet</dt>
                <dd>
                  <Flash value={result.total}>
                    <Amount sats={result.total} unit />
                  </Flash>
                </dd>
              </div>
            </dl>
            <div className="grid gap-2 px-4 pb-4">
              {error && <Notice tone="bad">{error}</Notice>}
              {primary("md")}
              {onDiscard && (
                <Button variant="danger" size="sm" onClick={onDiscard} className="justify-self-center">
                  Discard this send
                </Button>
              )}
              <a href="#/broadcast" className={`${linkClass} justify-self-center text-sm`}>
                Broadcast a PSBT signed elsewhere
              </a>
            </div>
          </section>
        </div>
      </div>
      <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-[2] -mx-4 mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-rule-2 bg-sheet px-4 pt-2.5 pb-3 shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)] @min-[900px]:hidden">
        <span className="truncate text-sm text-ink-2">
          <b className="font-bold text-ink">
            {chosen.length} coin{chosen.length === 1 ? "" : "s"}
          </b>
          , <Amount sats={result.coins.reduce((a, c) => a + c.value, 0)} /> in &middot; fee {groupSats(result.fee)} sats
        </span>
        {primary("sm")}
        {linked > 1 ? (
          <button
            type="button"
            onClick={() => log.current?.scrollIntoView({ behavior: "smooth" })}
            className="justify-self-start"
          >
            <Chip tone="join">
              <Icon name="join" className="size-3.5" />
              Joins {linked} sources
            </Chip>
          </button>
        ) : (
          <span />
        )}
        <span className="text-right text-sm text-ink-2">
          {stop ??
            (result.change ? (
              <>
                Change <Amount sats={result.change} />
              </>
            ) : (
              "No change"
            ))}
        </span>
      </div>
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Spend someone else's unconfirmed payment?">
        <p className="m-0 text-ink-2">
          {pending && (
            <>
              <Amount sats={pending.value} unit /> {pending.label ? `(${pending.label}) ` : ""}
            </>
          )}
          hasn't confirmed yet, and it came from someone else. Until it confirms they can replace it with a transaction
          that pays you nothing, and anything that spends it disappears too.
        </p>
        <p className="m-0 text-ink-2">Waiting for one confirmation is the safe choice.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            onClick={() => {
              setSelected(new Set(selected).add(outpoint(pending!)));
              setPending(null);
            }}
          >
            Spend it anyway
          </Button>
          <Button variant="primary" onClick={() => setPending(null)}>
            Leave it out
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

export function Send() {
  const snapshot = useWalletSnapshot();
  const session = useWalletSession();
  const [stored, store] = useSendDraft();
  const [blank] = useState(blankDraft);
  const { phase } = useConnection().connection;
  const synced = phase === "connected" && !!snapshot && !snapshot.progress && !snapshot.error;
  // Checked once synced and on the way out, not on every change, so a broadcast does not flash the screen back to an empty form.
  useEffect(() => {
    if (!session) return;
    const drop = () => store((d) => (d?.built && !stillPending(d.built, session.getSnapshot()) ? null : d));
    if (synced) drop();
    return drop;
  }, [session, store, synced]);
  if (!snapshot) return <p className="m-0 text-ink-2">Opening this wallet.</p>;
  const draft = stored ?? blank;
  const update = (patch: Partial<SendDraft>) => store((d) => ({ ...(d ?? blank), ...patch }));
  const built = draft.built;
  return (
    <>
      <div hidden={!!built}>
        <Compose snapshot={snapshot} draft={draft} update={update} onDiscard={stored ? () => store(null) : undefined} />
      </div>
      {built && (
        <SignFlow
          built={built.psbt}
          title={built.title ?? "Sign and send"}
          warnings={built.warnings}
          summary={built.summary}
          label={built.label}
          names={built.names}
          inputs={built.replaces ? undefined : built.inputs}
          onBack={() => update({ built: null })}
          done={built.signed}
          onDone={(signed) => update({ built: { ...built, signed } })}
          partial={built.partial}
          onPartial={(partial) => update({ built: { ...built, partial } })}
        />
      )}
    </>
  );
}
