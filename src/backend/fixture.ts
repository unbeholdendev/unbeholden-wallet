import { Transaction } from "@scure/btc-signer";
import { parseDescriptor } from "../wallet/descriptor";
import { derivePayment } from "../wallet/derive";
import { BIP84_ZPUB, BIP86_XPUB } from "../wallet/vectors";
import { openWallet } from "../core/wallet";
import { createWallet, saveSettings } from "../core/wallets";
import { createVault, type KdfParams } from "../vault/vault";
import { fakeBackend } from "./fake";

/**
 * A spending wallet with three months of history, for UI tests and
 * the e2e demo page and the public demo build.
 */
export const DEMO_DESCRIPTOR = `wpkh([d34db33f/84h/0h/0h]${BIP84_ZPUB}/<0;1>/*)`;

const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};

const ours = parseDescriptor(DEMO_DESCRIPTOR, "mainnet");
const others = parseDescriptor(`wpkh(${BIP86_XPUB}/0/*)`, "mainnet");
const mine = (chain: number, index: number) => derivePayment(ours, "mainnet", chain, index).script;
const theirs = (index: number) => derivePayment(others, "mainnet", 0, index).script;

function tx(inputs: [string, number][], outputs: [Uint8Array, number][]): Uint8Array {
  const t = new Transaction(PARSE);
  for (const [txid, index] of inputs) t.addInput({ txid, index, sequence: 0xfffffffd });
  for (const [script, amount] of outputs) t.addOutput({ script, amount: BigInt(amount) });
  return t.unsignedTx;
}
const id = (raw: Uint8Array) => Transaction.fromRaw(raw, PARSE).id;

// The fake server dates block h at 1 700 000 000 + 600h, so this tip lands in October 2026.
export const DEMO_TIP = 153_500;
const DAYS = 90;
const START = DEMO_TIP - DAYS * 144;
const daysAgo = (d: number) => DEMO_TIP - d * 144;

const faucet = tx([["00".repeat(32), 0xffffffff]], Array.from({ length: 10 }, (_, i): [Uint8Array, number] => [theirs(i), 50_000_000]));
const pay = (vout: number, to: Uint8Array, value: number, change: number) =>
  tx([[id(faucet), vout]], [[to, value], [theirs(20 + vout), 50_000_000 - value - change]]);

const kraken = pay(0, mine(0, 0), 15_418_220, 1_780);
const bisq = pay(1, mine(0, 1), 5_842_113, 2_210);
const dust = pay(2, mine(0, 4), 21_400, 1_100);
const ocean = pay(3, mine(0, 3), 6_000_000, 1_650);
const payrollAug = pay(4, mine(0, 2), 2_500_000, 1_320);
const hardware = tx([[id(kraken), 0]], [[theirs(30), 830_000], [mine(1, 0), 14_586_100]]);
const payrollSep = pay(5, mine(0, 2), 2_500_000, 1_320);
const tom = pay(6, mine(0, 5), 650_000, 990);
const rent = tx([[id(payrollAug), 0]], [[theirs(31), 1_450_000], [mine(1, 1), 1_048_560]]);
const meridian = pay(7, mine(0, 6), 300_000, 1_400);

export const DEMO_TXIDS = {
  kraken: id(kraken),
  bisq: id(bisq),
  dust: id(dust),
  ocean: id(ocean),
  payrollAug: id(payrollAug),
  hardware: id(hardware),
  payrollSep: id(payrollSep),
  tom: id(tom),
  rent: id(rent),
  meridian: id(meridian),
};

const placed: [number, Uint8Array][] = [
  [DAYS, faucet],
  [88, kraken],
  [70, bisq],
  [50, dust],
  [45, ocean],
  [47, payrollAug],
  [42, hardware],
  [16, payrollSep],
];

/** A fresh fake server holding the demo history, with two payments still in the mempool. */
export function demoBackend() {
  const blocks: Uint8Array[][] = Array.from({ length: DEMO_TIP - START + 1 }, () => []);
  for (const [d, raw] of placed) blocks[daysAgo(d) - START]!.push(raw);
  blocks[DEMO_TIP - 2 - START]!.push(tom);
  return fakeBackend({ startHeight: START, blocks, mempool: [rent, meridian] });
}

/** A locked vault holding the demo wallet, synced once, with its labels. */
export async function seedDemoVault(passphrase: string | null, kdf: KdfParams, server: string) {
  const vault = await createVault(passphrase, kdf);
  await saveSettings(vault, { server });
  const wallet = await createWallet(vault, { name: "Spending", descriptor: DEMO_DESCRIPTOR, network: "mainnet" });
  const backend = demoBackend();
  await backend.connect();
  const session = await openWallet(vault, wallet.id, backend);
  await session.settled();
  await session.importLabels(DEMO_LABELS);
  session.close();
  vault.lock();
  return wallet.id;
}

/** Labels and a frozen coin as a BIP329 file, as another wallet would export them. */
export const DEMO_LABELS = [
  { type: "tx", ref: DEMO_TXIDS.kraken, label: "Kraken withdrawal, July" },
  { type: "tx", ref: DEMO_TXIDS.bisq, label: "Bisq trade #4417" },
  { type: "tx", ref: DEMO_TXIDS.dust, label: "Unknown deposit" },
  { type: "tx", ref: DEMO_TXIDS.ocean, label: "Ocean payout, August" },
  { type: "tx", ref: DEMO_TXIDS.payrollAug, label: "Northwind payroll, August" },
  { type: "tx", ref: DEMO_TXIDS.hardware, label: "Hardware shop, SeedSigner parts" },
  { type: "tx", ref: DEMO_TXIDS.payrollSep, label: "Northwind payroll, September" },
  { type: "tx", ref: DEMO_TXIDS.tom, label: "Sold bike to Tom" },
  { type: "tx", ref: DEMO_TXIDS.rent, label: "Rent, October" },
  { type: "tx", ref: DEMO_TXIDS.meridian, label: "Meridian Ltd invoice 118" },
  { type: "output", ref: `${DEMO_TXIDS.hardware}:1`, label: "Kraken withdrawals" },
  { type: "output", ref: `${DEMO_TXIDS.bisq}:0`, label: "Bisq trade #4417" },
  { type: "output", ref: `${DEMO_TXIDS.ocean}:0`, label: "Ocean mining payouts" },
  { type: "output", ref: `${DEMO_TXIDS.payrollSep}:0`, label: "Northwind payroll" },
  { type: "output", ref: `${DEMO_TXIDS.tom}:0`, label: "Sold bike to Tom" },
  { type: "output", ref: `${DEMO_TXIDS.meridian}:0`, label: "Meridian Ltd invoice 118" },
  { type: "output", ref: `${DEMO_TXIDS.dust}:0`, label: "Dust, do not spend", spendable: false },
]
  .map((r) => JSON.stringify(r) + "\n")
  .join("");
