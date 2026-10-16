import { Transaction } from "@scure/btc-signer";
import { cleanup, configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { address, BIP84, LARGE, script, signPsbt } from "../../../scripts/regtest/fixture";
import { App } from "../../App";
import { fakeBackend, type FakeBackend, type Fixture } from "../../backend/fake";
import { createWallet, saveSettings } from "../../core/wallets";
import { groupSats } from "../../ui/amount";
import { createVault, destroyVault } from "../../vault/vault";
import { spend } from "../../wallet/select";

configure({ asyncUtilTimeout: 5000 });
// Each test unlocks a vault and syncs a wallet, slower than five seconds under the whole parallel suite.
vi.setConfig({ testTimeout: 30_000 });

const CHEAP = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
const PARSE = { allowUnknownInputs: true, allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true };
const PAYEE = address(LARGE, 0, 0);
const theirs = script(LARGE, 0, 50);

function tx(inputs: [string, number][], outputs: [Uint8Array, number][]): Uint8Array {
  const t = new Transaction(PARSE);
  for (const [txid, index] of inputs) t.addInput({ txid, index, sequence: 0xfffffffd });
  for (const [s, amount] of outputs) t.addOutput({ script: s, amount: BigInt(amount) });
  return t.unsignedTx;
}
const id = (raw: Uint8Array) => Transaction.fromRaw(raw, PARSE).id;

const faucet = tx([["00".repeat(32), 0xffffffff]], Array.from({ length: 6 }, (): [Uint8Array, number] => [theirs, 100_000_000]));
const payA = tx([[id(faucet), 0]], [[script(BIP84, 0, 0), 500_000], [theirs, 99_499_000]]);
const payB = tx([[id(faucet), 1]], [[script(BIP84, 0, 1), 300_000], [theirs, 99_699_000]]);
const payC = tx([[id(faucet), 2]], [[script(BIP84, 0, 2), 200_000], [theirs, 99_799_000]]);
const foreign = tx([[id(faucet), 3]], [[script(BIP84, 0, 3), 100_000], [theirs, 99_899_000]]);
const parent = tx([[id(faucet), 4]], [[theirs, 99_999_000]]);
const child = tx([[id(parent), 0]], [[script(BIP84, 0, 4), 150_000], [theirs, 99_848_000]]);
// 1 000 sats; unsigned, so 113 vB and 8.8 sat/vB to the wallet.
const outgoing = tx([[id(payB), 0]], [[theirs, 200_000], [script(BIP84, 1, 0), 99_000]]);

let fixture: Partial<Fixture>;
let backends: FakeBackend[];

async function start(hash: string, mempool: Uint8Array[] = [foreign, parent, child]) {
  const vault = await createVault(PASSPHRASE, CHEAP);
  await saveSettings(vault, { server: "wss://node.example:50004" });
  const wallet = await createWallet(vault, { name: "Spending", descriptor: BIP84.text, network: "regtest" });
  await vault.put(`labels/${wallet.id}`, { [`output:${id(payA)}:0`]: "Kraken withdrawal", [`output:${id(payB)}:0`]: "Bisq trade" });
  await vault.put(`frozen/${wallet.id}`, [`${id(payC)}:0`]);
  vault.lock();
  location.hash = hash;
  render(
    <App
      kdf={CHEAP}
      factory={() => {
        const backend = fakeBackend(fixture);
        for (const raw of mempool) backend.addToMempool(raw);
        backends.push(backend);
        return backend;
      }}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  return user;
}

// The default text normaliser turns the narrow spaces between digit groups into plain ones.
const sats = (n: number) => new RegExp(`^${groupSats(n).replace(/\u202f/g, " ")} sats$`);
const coin = (name: RegExp) => screen.findByRole("checkbox", { name });
const summary = () => within(screen.getByRole("region", { name: "Summary" }));

async function payTo(user: ReturnType<typeof userEvent.setup>, to: string, btc: string) {
  await user.type(await screen.findByLabelText("Address"), to);
  await user.type(screen.getByLabelText("Amount, BTC"), btc);
}

let created: string | null = null;
async function builtPsbt(user: ReturnType<typeof userEvent.setup>): Promise<Uint8Array> {
  await payTo(user, PAYEE, "0.001");
  await user.click(await coin(/Kraken withdrawal/));
  await user.click(screen.getByRole("button", { name: "Review and sign" }));
  await user.click(screen.getByRole("button", { name: "Looks right, show to signer" }));
  let blob: Blob | null = null;
  URL.createObjectURL = (b: Blob) => ((blob = b), (created = "blob:psbt"));
  URL.revokeObjectURL = () => {};
  await user.click(screen.getByRole("button", { name: "Save PSBT file" }));
  await user.click(screen.getByRole("button", { name: "Signed it, scan it back" }));
  return new Uint8Array(await blob!.arrayBuffer());
}

const upload = (user: ReturnType<typeof userEvent.setup>, psbt: Uint8Array) =>
  user.upload(screen.getByLabelText("Load signed file"), new File([psbt as Uint8Array<ArrayBuffer>], "signed.psbt"));

beforeEach(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
  backends = [];
  created = null;
  fixture = {
    startHeight: 100,
    blocks: [[faucet], [payA, payB, payC]],
    feeHistogram: [
      { feeRate: 30, vsize: 400_000 },
      { feeRate: 20, vsize: 800_000 },
      { feeRate: 10, vsize: 1_500_000 },
      { feeRate: 5, vsize: 2_000_000 },
      { feeRate: 2, vsize: 3_000_000 },
    ],
  };
});

afterEach(async () => {
  cleanup();
  await destroyVault();
});

describe("the send screen", () => {
  it("updates fee and change as coins are toggled, and names the sources a selection links", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.001");
    const map = within(screen.getByRole("region", { name: "What this links" }));
    expect(map.getByText("Nothing selected")).toBeTruthy();

    const payment = { recipients: [{ script: Buffer.from(script(LARGE, 0, 0)).toString("hex"), value: 100_000 }], feeRate: 10, scriptType: "wpkh" as const };
    await user.click(await coin(/Kraken withdrawal/));
    const one = spend([{ value: 500_000, script: Buffer.from(script(BIP84, 0, 0)).toString("hex") } as never], payment);
    expect(summary().getByText("Coins in (1)")).toBeTruthy();
    expect(summary().getByText(sats(one.fee))).toBeTruthy();
    expect(map.getByText("No new links")).toBeTruthy();

    await user.click(await coin(/Bisq trade/));
    const two = spend(
      [500_000, 300_000].map((value, i) => ({ value, script: Buffer.from(script(BIP84, 0, i)).toString("hex") }) as never),
      payment,
    );
    expect(two.fee).toBeGreaterThan(one.fee);
    expect(summary().getByText("Coins in (2)")).toBeTruthy();
    expect(summary().getByText(sats(two.fee))).toBeTruthy();
    expect(summary().getByText("Change back to you").parentElement!.textContent).toContain("m/84h/1h/0h/1/0");
    expect(map.getByText("Links 2 sources")).toBeTruthy();
    expect(map.getByText(/permanently linking them: Kraken withdrawal and Bisq trade/)).toBeTruthy();
  });

  it("never picks a frozen coin or one with an unconfirmed parent, and asks before spending someone else's unconfirmed payment", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.0095");
    await user.click(screen.getByRole("button", { name: "Pick for me" }));

    expect((await coin(/Kraken withdrawal/)).getAttribute("aria-checked")).toBe("true");
    expect((await coin(/Bisq trade/)).getAttribute("aria-checked")).toBe("true");
    const frozen = await coin(/Frozen/);
    const waiting = await coin(/Waits on an unconfirmed parent/);
    const foreignCoin = await coin(/Unconfirmed, from someone else/);
    for (const c of [frozen, waiting, foreignCoin]) expect(c.getAttribute("aria-checked")).toBe("false");
    expect(frozen.getAttribute("aria-disabled")).toBe("true");
    expect(waiting.getAttribute("aria-disabled")).toBe("true");

    await user.click(frozen);
    await user.click(waiting);
    expect(frozen.getAttribute("aria-checked")).toBe("false");
    expect(waiting.getAttribute("aria-checked")).toBe("false");

    await user.click(foreignCoin);
    expect(foreignCoin.getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Spend it anyway" }));
    expect(foreignCoin.getAttribute("aria-checked")).toBe("true");
  });

  it("refuses a wrong-network address and a malformed one, each in its own words", async () => {
    const user = await start("#/send");
    const field = await screen.findByLabelText("Address");
    // A P2WPKH example from BIP173. https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
    await user.type(field, "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(screen.getByText("This is a mainnet address, but this wallet is on regtest.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix the address first" })).toHaveProperty("disabled", true);

    await user.clear(field);
    await user.type(field, PAYEE.slice(0, -1) + (PAYEE.endsWith("q") ? "p" : "q"));
    expect(screen.getByText(/its checksum does not match/)).toBeTruthy();
  });

  it("keeps a manual fee rate when the mempool changes", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.001");
    await user.click(await coin(/Kraken withdrawal/));
    const rate = screen.getByLabelText("Custom rate");
    await user.clear(rate);
    await user.type(rate, "7");
    expect(summary().getByText(/^7 sat\/vB/)).toBeTruthy();

    fixture.feeHistogram!.splice(0, Infinity, { feeRate: 80, vsize: 2_000_000 }, { feeRate: 40, vsize: 4_000_000 });
    for (const backend of backends) backend.addBlock([]);
    expect(await screen.findByRole("button", { name: /Next block\s*80 sat\/vB/ })).toBeTruthy();
    expect((rate as HTMLInputElement).value).toBe("7");
    expect(summary().getByText(/^7 sat\/vB/)).toBeTruthy();
  });
});

describe("signing and broadcasting", () => {
  it("refuses a signed PSBT that differs from the one built, and says how", async () => {
    const user = await start("#/send");
    const psbt = Transaction.fromPSBT(await builtPsbt(user));
    expect(created).toBe("blob:psbt");
    psbt.updateOutput(0, { amount: psbt.getOutput(0).amount! - 1_000n });
    await upload(user, psbt.toPSBT());
    expect(await screen.findByText(/This PSBT was refused: Output 1 pays \d+ sats, but the one built pays \d+ sats/)).toBeTruthy();
  });

  it("shows the node's rejection word for word", async () => {
    const reason = "insufficient fee, rejecting replacement 3f2a; new feerate 0.00001000 BTC/kvB <= old feerate 0.00002000 BTC/kvB";
    fixture.broadcastRejection = reason;
    const user = await start("#/send");
    await upload(user, signPsbt(await builtPsbt(user), BIP84));
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    expect((await screen.findByText(reason)).textContent).toBe(reason);
  });

  it("broadcasts, shows the transaction at once, and its change is spendable", async () => {
    const user = await start("#/send");
    const signed = signPsbt(await builtPsbt(user), BIP84);
    await upload(user, signed);
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Broadcast through your server" }));
    const txid = Transaction.fromPSBT(signed).id;
    expect(await screen.findByText(txid)).toBeTruthy();
    location.hash = "#/send";
    expect(await coin(/Your change, unconfirmed/)).toBeTruthy();
  });
});

describe("fee bump", () => {
  it("shows the old and new rate side by side and what the replacement costs", async () => {
    const user = await start(`#/bump/${id(outgoing)}`, [outgoing]);
    expect(await screen.findByRole("heading", { name: "Speed up this transaction" })).toBeTruthy();
    const now = screen.getByText("Now").parentElement!;
    const next = screen.getByText("Replacement").parentElement!;
    expect(now.textContent).toMatch(/^Now8\.8 sat\/vB1 000 sats fee$/);
    expect(next.textContent).toMatch(/^Replacement30(\.\d)? sat\/vB/);
    expect(screen.getByText("Extra cost").nextElementSibling!.textContent).toMatch(/^\d[\d ]* sats$/);

    await user.click(screen.getByRole("button", { name: /No rush/ }));
    expect(screen.getByRole("button", { name: /No rush\s*8\.9 sat\/vB/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build the replacement" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Build the replacement" }));
    expect(await screen.findByRole("heading", { name: "Sign the replacement" })).toBeTruthy();
  });
});
