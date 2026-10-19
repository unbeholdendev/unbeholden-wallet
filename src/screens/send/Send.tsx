import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnection } from "../../app/connection";
import { useSendDraft, useWallet, useWalletSession, useWalletSnapshot } from "../../app/session";
import { useBook, useVault } from "../../app/vault";
import { nextChange } from "../../core/view";
import type { WalletCoin, WalletSnapshot } from "../../core/wallet";
import { Amount, groupSats } from "../../ui/amount";
import { shortId } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { Button, Chip, LinkButton, linkClass, Notice } from "../../ui/kit";
import { Sheet } from "../../ui/sheet";
import { sourcesOf, type Source } from "../../ui/sources";
import { outpoint } from "../../wallet/coin";
import { assessPrivacy } from "../../wallet/privacy";
import { buildPsbt } from "../../wallet/psbt";
import { selectCoins, spend, type Payment, type Spend } from "../../wallet/select";
import { bulk, CoinList, selectable } from "./CoinList";
import { FeePanel, rateOf, rateText, useFeeHistogram, type FeeChoice } from "./fees";
import { PrivacyMap } from "./PrivacyMap";
import { checkAddress, parseAmount, Recipients, type Draft } from "./Recipients";
import { SignFlow } from "./Sign";

const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16)).join("");

/** Plays its background once whenever the value changes, so a moved total catches the eye. */
function Flash({ value, children }: { value: number; children: ReactNode }) {
  const first = useRef(value);
  return (
    <span key={value} className={`rounded-chip px-0.5 ${value === first.current ? "" : "animate-value-flash"}`}>
      {children}
    </span>
  );
}

export type Built = { psbt: Uint8Array; warnings: string[]; title?: string; label: string; names?: Record<string, string>; summary: [ReactNode, ReactNode][] };

/** `picked` null lets the wallet choose coins for the amount; a tap fixes the choice. `replaces` is set for a fee bump or cancellation, whose `inputs` are only the coins it adds. */
export type SendDraft = { drafts: Draft[]; fee: FeeChoice; seed: string; picked: string[] | null; built: (Built & { inputs: string[]; replaces?: string; signed?: Uint8Array; partial?: Uint8Array }) | null };

/** Whether a built send can still go out: its coins unspent and what it replaces still unconfirmed. */
export function stillPending(built: NonNullable<SendDraft["built"]>, snapshot: WalletSnapshot) {
  const unspent = new Set(snapshot.coins.map(outpoint));
  return built.inputs.every((k) => unspent.has(k)) && (!built.replaces || snapshot.transactions.some((t) => t.txid === built.replaces && t.height === null));
}

export const blankDraft = (): SendDraft => ({
  drafts: [{ key: 0, address: "", amount: "", max: false, label: "" }],
  fee: { preset: "threeBlocks" },
  seed: seed(),
  picked: null,
  built: null,
});

function blocker(drafts: Draft[], valid: boolean[], result: Spend): string | null {
  if (drafts.some((d) => !d.address.trim())) return "Enter who to pay";
  if (valid.includes(false)) return "Fix the address first";
  if (drafts.some((d) => !d.max && !parseAmount(d.amount))) return "Enter an amount";
  const p = result.problem;
  if (p?.kind === "no-coins") return "Select coins to pay from";
  if (p?.kind === "insufficient") return `Short by ${groupSats(p.missing)} sats`;
  if (p?.kind === "dust") return `Payment ${p.recipient + 1} is too small to send`;
  return null;
}

function Compose({ snapshot, draft, update, onDiscard }: { snapshot: WalletSnapshot; draft: SendDraft; update: (patch: Partial<SendDraft>) => void; onDiscard?: () => void }) {
  const { descriptor, network, kind } = useWallet();
  const { drafts, fee } = draft;
  const setDrafts = (drafts: Draft[]) => update({ drafts });
  const setFee = (fee: FeeChoice) => update({ fee });
  const setSelected = (next: Set<string>) => update({ picked: [...next] });
  const [pending, setPending] = useState<WalletCoin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const map = useRef<HTMLElement>(null);
  const histogram = useFeeHistogram();
  const [book, saveBook] = useBook();
  const skip = !!useVault().settings.skipForeignUnconfirmed;
  const take = skip ? bulk : selectable;
  const named = new Map(book.map((c) => [c.address, c.name]));

  const sources = useMemo(() => sourcesOf(snapshot), [snapshot]);
  const nameOf = useMemo(() => new Map(sources.flatMap((s) => s.coins.map((c) => [outpoint(c), s.name]))), [sources]);
  const kycOf = useMemo(() => new Set(sources.filter((s) => s.kyc.length).flatMap((s) => s.coins.map(outpoint))), [sources]);
  const own = useMemo(() => new Set([...snapshot.addresses.receive, ...snapshot.addresses.change].map((a) => a.address)), [snapshot]);
  const rate = rateOf(fee, histogram);
  // An unfinished address still has to cost its output's bytes, so it stands in as one of the wallet's own type.
  const placeholder = kind.scriptType === "wpkh" ? `0014${"00".repeat(20)}` : `${kind.scriptType === "tr" ? "5120" : "0020"}${"00".repeat(32)}`;
  const checks = drafts.map((d) => (d.address.trim() ? checkAddress(d.address, network) : null));
  const addresses = checks.map((c) => (c && "address" in c ? c.address : ""));
  const payment: Payment = {
    recipients: drafts.map((d, i) => {
      const check = checks[i];
      return { script: check && "script" in check ? check.script : placeholder, value: d.max ? "max" : (parseAmount(d.amount) ?? 0) };
    }),
    feeRate: rate,
    ...kind,
  };
  const typed = drafts.every((d) => !d.max && parseAmount(d.amount));
  const paymentKey = JSON.stringify(payment);
  const auto = useMemo(
    () => (typed ? selectCoins(snapshot.coins, payment, draft.seed, snapshot.groups, !skip).coins.map(outpoint) : []),
    [typed, paymentKey, snapshot, draft.seed, skip],
  );
  const selected = new Set(draft.picked ?? auto);
  const chosen = snapshot.coins.filter((c) => selected.has(outpoint(c)));
  const result = spend(chosen, payment);
  const report = assessPrivacy(result, payment, snapshot.groups, {
    label: (c) => nameOf.get(outpoint(c)),
    kyc: (c) => kycOf.has(outpoint(c)),
  });
  const linked = report.sources.length;
  const foreign = chosen.filter((c) => c.status === "foreign-unconfirmed");
  const stop = blocker(drafts, checks.map((c) => !c || "script" in c), result);
  const change = nextChange(snapshot);
  const sweepable = snapshot.coins.filter(take);
  const swept = drafts.length === 1 && drafts[0]!.max && sweepable.length > 0 && sweepable.every((c) => selected.has(outpoint(c)));
  const left = snapshot.coins.filter((c) => !selected.has(outpoint(c)) && !sweepable.includes(c));
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
      const built = buildPsbt({
        descriptor,
        network,
        coins: result.coins,
        recipients: drafts.map((d, i) => ({ address: d.address.trim(), value: result.amounts[i]! })),
        change: result.change ? { chain: change.chain, index: change.index, value: result.change } : null,
        tip: snapshot.tip,
      });
      setError(null);
      update({
        built: {
          ...built,
          label: drafts.map((d, i) => d.label.trim() || named.get(addresses[i]!)).filter(Boolean).join(", "),
          names: Object.fromEntries(addresses.flatMap((a) => (named.has(a) ? [[a, named.get(a)!]] : []))),
          summary: [["Inputs", `${result.coins.length} coin${result.coins.length === 1 ? "" : "s"} from ${linked} source${linked === 1 ? "" : "s"}`]],
          inputs: result.coins.map(outpoint),
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const badge =
    linked === 0 ? (
      <Chip>Nothing selected</Chip>
    ) : linked === 1 ? (
      <Chip tone="ok"><Icon name="check" className="size-3.5" />No new links</Chip>
    ) : (
      <Chip tone={linked > 2 ? "bad" : "warn"}><Icon name="warn" className="size-3.5" />Links {linked} sources</Chip>
    );
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
            onSweep={() => update({ drafts: [{ ...drafts[0]!, max: true }], picked: sweepable.map(outpoint) })}
          />
          {swept && left.length > 0 && (
            <Notice tone="warn">
              Sending everything spendable. Left out, <Amount sats={left.reduce((a, c) => a + c.value, 0)} unit />: {leftOut}.
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
          <section ref={map} aria-label="What this links" className="scroll-mt-20 rounded-panel border border-rule bg-sheet">
            <div className="flex items-center justify-between gap-3 px-4 pt-4">
              <h2 className="text-md font-semibold">What this links</h2>
              {badge}
            </div>
            <div className="px-4 pt-3 pb-1">
              <PrivacyMap sources={sources} selected={selected} onGroup={group} />
            </div>
            <div aria-live="polite" className="grid gap-2.5 px-4 pb-4">
              <p className="m-0 max-w-[60ch]">
                {linked === 0
                  ? draft.picked
                    ? "Pick coins from the list, or let Pick for me choose."
                    : "Enter an amount and coins are picked for you, from one source where they can be. Tap a coin to choose yourself."
                  : linked === 1
                    ? `All selected coins come from ${nameOf.get(outpoint(chosen[0]!))}. They are already linked, so this adds nothing new.`
                    : report.warnings.find((w) => w.kind === "links-sources")!.message}
              </p>
              {report.warnings
                .filter((w) => w.kind !== "links-sources")
                .map((w) => (
                  <p key={w.kind + w.message} className="m-0 max-w-[60ch] text-sm text-ink-2">
                    {w.message}
                  </p>
                ))}
              {report.change && <p className="m-0 max-w-[60ch] text-sm text-ink-2">{report.change}</p>}
              {foreign.length > 0 && (
                <Notice tone="warn">
                  {foreign.length === 1 ? "One selected coin is" : `${foreign.length} selected coins are`} an unconfirmed payment from someone else. They can still replace it, and then this transaction fails with it.
                </Notice>
              )}
            </div>
          </section>
          <section aria-label="Summary" className="rounded-panel border border-rule bg-sheet">
            <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
              <h2 className="text-md font-semibold">Summary</h2>
              <span className="text-sm text-ink-3">Replaceable (RBF)</span>
            </div>
            <dl className="m-0 grid px-4 pt-1 pb-4 text-sm [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-dotted [&>div]:border-rule-2 [&>div]:py-1.5 [&_dt]:text-ink-2 [&_dd]:m-0 [&_dd]:text-right">
              <div>
                <dt>Coins in ({chosen.length})</dt>
                <dd><Flash value={result.coins.reduce((a, c) => a + c.value, 0)}><Amount sats={result.coins.reduce((a, c) => a + c.value, 0)} /></Flash></dd>
              </div>
              <div>
                <dt>Sending</dt>
                <dd><Amount sats={result.amounts.reduce((a, b) => a + b, 0)} /></dd>
              </div>
              <div>
                <dt>
                  Fee
                  <small className="block text-xs text-ink-3">{rateText(rate)} sat/vB &middot; {result.vsize} vB</small>
                </dt>
                <dd><Flash value={result.fee}>{groupSats(result.fee)} sats</Flash></dd>
              </div>
              <div>
                <dt>
                  Change back to you
                  {result.change > 0 && <small className="block font-mono text-xs text-ink-3">{shortId(change.address, 10, 6)} &middot; {change.path}</small>}
                </dt>
                <dd><Flash value={result.change}>{result.change ? <Amount sats={result.change} /> : "None"}</Flash></dd>
              </div>
              <div className="border-b-0 pt-2.5 text-md font-semibold [&_dt]:text-ink">
                <dt>Total leaving the wallet</dt>
                <dd><Flash value={result.total}><Amount sats={result.total} unit /></Flash></dd>
              </div>
            </dl>
            <div className="grid gap-2 px-4 pb-4">
              {error && <Notice tone="bad">{error}</Notice>}
              {primary("md")}
              {onDiscard && <LinkButton onClick={onDiscard} className="justify-self-center">Discard this send</LinkButton>}
              <a href="#/broadcast" className={`${linkClass} justify-self-center text-sm`}>Broadcast a PSBT signed elsewhere</a>
            </div>
          </section>
        </div>
      </div>
      <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] z-[2] -mx-4 mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-rule-2 bg-sheet px-4 pt-2.5 pb-3 shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)] @min-[900px]:hidden">
        <span className="truncate text-sm text-ink-2">
          <b className="font-semibold text-ink">{chosen.length} coin{chosen.length === 1 ? "" : "s"}</b>, <Amount sats={result.coins.reduce((a, c) => a + c.value, 0)} /> in &middot; fee {groupSats(result.fee)} sats
        </span>
        {primary("sm")}
        <button type="button" onClick={() => map.current?.scrollIntoView({ behavior: "smooth" })} className="justify-self-start">
          {badge}
        </button>
        <span className="text-right text-sm text-ink-2">{stop ?? (result.change ? <>Change <Amount sats={result.change} /></> : "No change")}</span>
      </div>
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Spend someone else's unconfirmed payment?">
        <p className="m-0 text-ink-2">
          {pending && <><Amount sats={pending.value} unit /> {pending.label ? `(${pending.label}) ` : ""}</>}
          has not confirmed yet, and it came from someone else. Until it confirms they can replace it with a transaction that pays you nothing, and anything that spends it disappears too.
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
      {built && <SignFlow built={built.psbt} title={built.title ?? "Sign and send"} warnings={built.warnings} summary={built.summary} label={built.label} names={built.names} onBack={() => update({ built: null })} done={built.signed} onDone={(signed) => update({ built: { ...built, signed } })} partial={built.partial} onPartial={(partial) => update({ built: { ...built, partial } })} />}
    </>
  );
}
