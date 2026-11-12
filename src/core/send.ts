import { hex } from "@scure/base";
import type { Store } from "../vault/vault";
import { outpoint } from "../wallet/coin";
import type { Descriptor } from "../wallet/descriptor";
import type { FeeChoice } from "../wallet/fees";
import type { Network } from "../wallet/network";
import { checkAddress, parseAmount } from "../wallet/parse";
import { assessPrivacy, type PrivacyReport } from "../wallet/privacy";
import { buildPsbt } from "../wallet/psbt";
import { type Payment, type Spend, type SpendProblem, selectCoins, spend, type WalletKind } from "../wallet/select";
import type { Source } from "./sources";
import { nextChange } from "./view";
import type { WalletCoin, WalletSnapshot } from "./wallet";
import { readRecord, vaultKey, writeRecord } from "./wallets";

/** One recipient as typed. */
export type Draft = { key: number; address: string; amount: string; max: boolean; label: string };

export type Built = {
  psbt: Uint8Array;
  warnings: string[];
  title?: string;
  label: string;
  names?: Record<string, string>;
  /** Extra facts for the review. Kept in the vault as JSON, so text only. */
  summary: [string, string][];
};

/** `picked` null lets the wallet choose coins for the amount; a tap fixes the choice. `replaces` is set for a fee bump or cancellation, whose `inputs` are only the coins it adds. */
export type SendDraft = {
  drafts: Draft[];
  fee: FeeChoice;
  seed: string;
  picked: string[] | null;
  built: (Built & { inputs: string[]; replaces?: string; signed?: Uint8Array; partial?: Uint8Array }) | null;
};

/** Whether a built send can still go out: its coins unspent and what it replaces still unconfirmed. */
export function stillPending(built: NonNullable<SendDraft["built"]>, snapshot: WalletSnapshot) {
  const unspent = new Set(snapshot.coins.map(outpoint));
  return (
    built.inputs.every((k) => unspent.has(k)) &&
    (!built.replaces || snapshot.transactions.some((t) => t.txid === built.replaces && t.height === null))
  );
}

const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16)).join("");

export const blankDraft = (): SendDraft => ({
  drafts: [{ key: 0, address: "", amount: "", max: false, label: "" }],
  fee: { preset: "threeBlocks" },
  seed: seed(),
  picked: null,
  built: null,
});

export type SavedSend = Omit<SendDraft, "built"> & {
  built: Omit<NonNullable<SendDraft["built"]>, "psbt" | "signed" | "partial"> & {
    psbt: string;
    signed?: string;
    partial?: string;
  };
};

/** Keeps a send with a built PSBT in the vault, so it outlasts a lock or a reload, and forgets one without. */
export async function saveSend(vault: Store, walletId: string, draft: SendDraft | null): Promise<void> {
  const built = draft?.built;
  if (!built) return vault.delete(vaultKey.send(walletId));
  const signed = built.signed && hex.encode(built.signed);
  const partial = built.partial && hex.encode(built.partial);
  await writeRecord(vault, vaultKey.send(walletId), {
    ...draft,
    built: { ...built, psbt: hex.encode(built.psbt), signed, partial },
  });
}

export async function loadSend(vault: Store, walletId: string): Promise<SendDraft | null> {
  const saved = await readRecord(vault, vaultKey.send(walletId));
  if (!saved) return null;
  const { psbt, signed, partial, ...built } = saved.built;
  const bytes = (text?: string) => (text ? hex.decode(text) : undefined);
  return { ...saved, built: { ...built, psbt: hex.decode(psbt), signed: bytes(signed), partial: bytes(partial) } };
}

/** Frozen coins and coins waiting on someone else's unconfirmed transaction cannot be chosen. */
export const selectable = (c: WalletCoin) => !c.frozen && c.status !== "unconfirmed-parents";

/** What a group tap or Max takes when the setting leaves out someone else's unconfirmed payment. */
export const bulk = (c: WalletCoin) => selectable(c) && c.status !== "foreign-unconfirmed";

/** Why a send cannot go to review yet. */
export type SendProblem = { kind: "no-recipient" } | { kind: "bad-address" } | { kind: "no-amount" } | SpendProblem;

export type SendPlan = {
  /** Per recipient, its address spelt canonically, or "" while it is not a valid one. */
  addresses: string[];
  selected: Set<string>;
  /** The selected coins, in wallet order. */
  chosen: WalletCoin[];
  spend: Spend;
  privacy: PrivacyReport;
  problem: SendProblem | null;
  /** When a send-max takes every coin it can, the wallet's coins it still leaves out; otherwise empty. */
  left: WalletCoin[];
  /** Selected coins that are someone else's unconfirmed payment. */
  foreign: WalletCoin[];
  /**
   * Set when the selection joins sources, some of them private, and no one
   * source covers the payment. `coins` are those from sources that already
   * know the user, or null when they do not cover it either.
   */
  suggestion: { known: string[]; open: string[]; coins: WalletCoin[] | null } | null;
};

/**
 * Plans a send from the form as it stands: the coins, picked by hand or by
 * the wallet, what spending them comes to, what it reveals, and what stops it
 * going to review. `skipForeign` keeps someone else's unconfirmed payments out
 * of automatic and bulk picks.
 */
export function planSend(
  snapshot: Pick<WalletSnapshot, "coins" | "groups">,
  sources: Pick<Source, "name" | "kyc" | "coins">[],
  draft: SendDraft,
  feeRate: number,
  wallet: WalletKind & { network: Network },
  skipForeign: boolean,
): SendPlan {
  const { drafts } = draft;
  const { network, ...kind } = wallet;
  const take = skipForeign ? bulk : selectable;
  // An unfinished address still has to cost its output's bytes, so it stands in as one of the wallet's own type.
  const placeholder =
    kind.scriptType === "wpkh"
      ? `0014${"00".repeat(20)}`
      : `${kind.scriptType === "tr" ? "5120" : "0020"}${"00".repeat(32)}`;
  const checks = drafts.map((d) => (d.address.trim() ? checkAddress(d.address, network) : null));
  const payment: Payment = {
    recipients: drafts.map((d, i) => {
      const check = checks[i];
      return {
        script: check && "script" in check ? check.script : placeholder,
        value: d.max ? "max" : (parseAmount(d.amount) ?? 0),
      };
    }),
    feeRate,
    ...kind,
  };
  const typed = drafts.every((d) => !d.max && parseAmount(d.amount));
  const auto = () =>
    typed
      ? selectCoins(snapshot.coins, payment, draft.seed, snapshot.groups, !skipForeign).coins.map(outpoint)
      : drafts.some((d) => d.max)
        ? snapshot.coins.filter(take).map(outpoint)
        : [];
  const selected = new Set(draft.picked ?? auto());
  const chosen = snapshot.coins.filter((c) => selected.has(outpoint(c)));
  const result = spend(chosen, payment);

  const nameOf = new Map(sources.flatMap((s) => s.coins.map((c) => [outpoint(c), s.name])));
  const kycOf = new Set(sources.filter((s) => s.kyc.length).flatMap((s) => s.coins.map(outpoint)));
  const privacy = assessPrivacy(result, payment, snapshot.groups, {
    label: (c) => nameOf.get(outpoint(c)),
    kyc: (c) => kycOf.has(outpoint(c)),
  });

  const linked = privacy.sources.length;
  const covers = (coins: WalletCoin[]) => !spend(coins, payment).problem;
  const known = sources.filter((s) => s.kyc.length && s.coins.some(bulk));
  const open = sources.filter((s) => !s.kyc.length && s.coins.some((c) => selected.has(outpoint(c))));
  const knownCoins = known.flatMap((s) => s.coins.filter(bulk));
  const suggest =
    linked > 1 &&
    typed &&
    open.length > 0 &&
    open.length < linked &&
    !sources.some((s) => covers(s.coins.filter(bulk)));

  const sweepable = snapshot.coins.filter(take);
  const swept = drafts.some((d) => d.max) && sweepable.length > 0 && sweepable.every((c) => selected.has(outpoint(c)));

  return {
    addresses: checks.map((c) => (c && "address" in c ? c.address : "")),
    selected,
    chosen,
    spend: result,
    privacy,
    problem: drafts.some((d) => !d.address.trim())
      ? { kind: "no-recipient" }
      : checks.some((c) => c && !("script" in c))
        ? { kind: "bad-address" }
        : drafts.some((d) => !d.max && !parseAmount(d.amount))
          ? { kind: "no-amount" }
          : result.problem,
    left: swept ? snapshot.coins.filter((c) => !selected.has(outpoint(c)) && !sweepable.includes(c)) : [],
    foreign: chosen.filter((c) => c.status === "foreign-unconfirmed"),
    suggestion: suggest
      ? {
          known: known.map((s) => s.name),
          open: open.map((s) => s.name),
          coins: covers(knownCoins) ? knownCoins : null,
        }
      : null,
  };
}

/**
 * The PSBT for a planned send, with what the review shows about it. `names`
 * are address book names by address. Throws when the PSBT cannot be built.
 */
export function buildSend(
  plan: SendPlan,
  drafts: Draft[],
  snapshot: WalletSnapshot,
  wallet: { descriptor: Descriptor; network: Network },
  names: Map<string, string>,
): NonNullable<SendDraft["built"]> {
  const result = plan.spend;
  const change = nextChange(snapshot);
  const linked = plan.privacy.sources.length;
  const built = buildPsbt({
    descriptor: wallet.descriptor,
    network: wallet.network,
    coins: result.coins,
    recipients: drafts.map((d, i) => ({ address: d.address.trim(), value: result.amounts[i]! })),
    change: result.change ? { chain: change.chain, index: change.index, value: result.change } : null,
    tip: snapshot.tip,
  });
  return {
    ...built,
    label: drafts
      .map((d, i) => d.label.trim() || names.get(plan.addresses[i]!))
      .filter(Boolean)
      .join(", "),
    names: Object.fromEntries(plan.addresses.flatMap((a) => (names.has(a) ? [[a, names.get(a)!]] : []))),
    summary: [
      [
        "Inputs",
        `${result.coins.length} coin${result.coins.length === 1 ? "" : "s"} from ${linked} source${linked === 1 ? "" : "s"}`,
      ],
    ],
    inputs: result.coins.map(outpoint),
  };
}
