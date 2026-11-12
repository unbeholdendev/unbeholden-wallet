import { hex } from "@scure/base";
import { Address, NETWORK, OutScript } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { outpoint } from "../wallet/coin";
import { deriveAddress } from "../wallet/derive";
import { descriptorFromExtendedKey } from "../wallet/descriptor";
import { BIP84_ZPUB } from "../wallet/vectors";
import { blankDraft, type Draft, planSend, type SendDraft } from "./send";
import type { Source } from "./sources";
import type { WalletCoin } from "./wallet";

const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");
const wallet = { scriptType: "wpkh" as const, network: "mainnet" as const };
// A P2WPKH address from the BIP173 examples.
// https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
const PAYEE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const OTHER = deriveAddress(descriptor, "mainnet", 0, 9);

function coin(n: number, value: number, status: WalletCoin["status"] = "confirmed", frozen = false): WalletCoin {
  const address = deriveAddress(descriptor, "mainnet", 0, n);
  return {
    txid: n.toString(16).padStart(64, "0"),
    vout: 0,
    value,
    script: hex.encode(OutScript.encode(Address(NETWORK).decode(address))),
    address,
    chain: 0,
    index: n,
    height: status === "confirmed" ? 100 : null,
    status,
    frozen,
    label: null,
    kyc: false,
  };
}

const pay = (address: string, amount: string, max = false): Draft => ({ key: 0, address, amount, max, label: "" });
const draftOf = (drafts: Draft[], picked: string[] | null = null): SendDraft => ({ ...blankDraft(), drafts, picked });
const each = (coins: WalletCoin[]): Pick<Source, "name" | "kyc" | "coins">[] =>
  coins.map((c) => ({ name: c.address, kyc: [], coins: [c] }));

function plan(coins: WalletCoin[], draft: SendDraft, skipForeign = false) {
  return planSend({ coins, groups: new Map() }, each(coins), draft, 2, wallet, skipForeign);
}

describe("planSend", () => {
  it("pays several recipients from the coins it picks", () => {
    const coins = [coin(1, 100_000), coin(2, 200_000)];
    const p = plan(coins, draftOf([pay(PAYEE, "0.0005"), { ...pay(OTHER, "30000 sats"), key: 1 }]));
    expect(p.problem).toBeNull();
    expect(p.spend.amounts).toEqual([50_000, 30_000]);
    expect(p.addresses).toEqual([PAYEE, OTHER]);
    expect(p.chosen.length).toBeGreaterThan(0);
    expect(p.chosen.map(outpoint)).toEqual(coins.filter((c) => p.selected.has(outpoint(c))).map(outpoint));
    const input = p.chosen.reduce((a, c) => a + c.value, 0);
    expect(input).toBe(80_000 + p.spend.fee + p.spend.change);
  });

  it("sweeps every spendable coin to a max recipient and lists what it leaves out", () => {
    const frozen = coin(3, 40_000, "confirmed", true);
    const waiting = coin(4, 30_000, "unconfirmed-parents");
    const coins = [coin(1, 100_000), coin(2, 200_000), frozen, waiting];
    const p = plan(coins, draftOf([pay(PAYEE, "", true)]));
    expect(p.problem).toBeNull();
    expect([...p.selected]).toEqual([outpoint(coins[0]!), outpoint(coins[1]!)]);
    expect(p.spend.change).toBe(0);
    expect(p.spend.amounts[0]! + p.spend.fee).toBe(300_000);
    expect(p.left).toEqual([frozen, waiting]);
  });

  it("leaves nothing out when a max send does not take every spendable coin", () => {
    const coins = [coin(1, 100_000), coin(2, 200_000), coin(3, 40_000, "confirmed", true)];
    const p = plan(coins, draftOf([pay(PAYEE, "", true)], [outpoint(coins[0]!)]));
    expect(p.left).toEqual([]);
  });

  it("reports what the picked coins are short by", () => {
    const coins = [coin(1, 10_000), coin(2, 200_000)];
    const p = plan(coins, draftOf([pay(PAYEE, "0.0005")], [outpoint(coins[0]!)]));
    expect([...p.selected]).toEqual([outpoint(coins[0]!)]);
    expect(p.problem).toMatchObject({ kind: "insufficient" });
    expect(p.problem?.kind === "insufficient" && p.problem.missing).toBe(50_000 + p.spend.fee - 10_000);
  });

  it("refuses a payment too small to relay", () => {
    const p = plan([coin(1, 100_000)], draftOf([pay(PAYEE, "100 sats")]));
    expect(p.problem).toEqual({ kind: "dust", recipient: 0 });
  });

  it("keeps the picked coins rather than choosing", () => {
    const coins = [coin(1, 100_000), coin(2, 200_000)];
    const auto = plan(coins, draftOf([pay(PAYEE, "0.0005")]));
    const other = coins.map(outpoint).filter((k) => !auto.selected.has(k));
    const picked = plan(coins, draftOf([pay(PAYEE, "0.0005")], [...other, ...auto.selected]));
    expect(picked.selected).toEqual(new Set(coins.map(outpoint)));
    expect(plan(coins, draftOf([pay(PAYEE, "0.0005")], [])).problem).toEqual({ kind: "no-coins" });
  });

  it("chooses someone else's unconfirmed payment only when allowed", () => {
    const coins = [coin(1, 100_000, "foreign-unconfirmed")];
    const draft = draftOf([pay(PAYEE, "0.0005")]);
    expect(plan(coins, draft, true).problem).toEqual({ kind: "no-coins" });
    const allowed = plan(coins, draft, false);
    expect(allowed.problem).toBeNull();
    expect(allowed.foreign).toEqual(coins);
    expect(plan(coins, draftOf([pay(PAYEE, "", true)]), true).selected.size).toBe(0);
  });

  it("asks for the recipient, a valid address and an amount, in that order", () => {
    const coins = [coin(1, 100_000)];
    expect(plan(coins, draftOf([pay(" ", "0.0005")])).problem).toEqual({ kind: "no-recipient" });
    expect(plan(coins, draftOf([pay("bc1qnotanaddress", "0.0005")])).problem).toEqual({ kind: "bad-address" });
    expect(plan(coins, draftOf([pay(PAYEE, "")])).problem).toEqual({ kind: "no-amount" });
  });

  it("suggests the sources that already know the user when no one source covers the payment", () => {
    const coins = [coin(1, 30_000), coin(2, 30_000), coin(3, 30_000)];
    const sources: Pick<Source, "name" | "kyc" | "coins">[] = [
      { name: "Exchange", kyc: [coins[0]!], coins: [coins[0]!] },
      { name: "Broker", kyc: [coins[1]!], coins: [coins[1]!] },
      { name: "Friend", kyc: [], coins: [coins[2]!] },
    ];
    const draft = draftOf([pay(PAYEE, "0.0005")], coins.map(outpoint));
    const p = planSend({ coins, groups: new Map() }, sources, draft, 2, wallet, false);
    expect(p.privacy.sources.length).toBe(3);
    expect(p.suggestion).toEqual({ known: ["Exchange", "Broker"], open: ["Friend"], coins: [coins[0], coins[1]] });
  });
});
