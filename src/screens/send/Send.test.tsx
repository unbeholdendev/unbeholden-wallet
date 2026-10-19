import { Transaction } from "@scure/btc-signer";
import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { address, BIP84, LARGE, MULTISIG, script, signPsbt } from "../../../scripts/regtest/fixture";
import { App } from "../../App";
import { fakeBackend, type FakeBackend, type Fixture } from "../../backend/fake";
import { createWallet, saveSettings } from "../../core/wallets";
import { bbqrParts } from "../../transport/bbqr";
import { psbtUrEncoder } from "../../transport/ur";
import { btcParts, groupSats } from "../../ui/amount";
import { createVault, destroyVault } from "../../vault/vault";

const camera = vi.hoisted(() => ({ frames: [] as string[] }));
vi.mock("../../transport/qr", async (original) => ({ ...(await original<typeof import("../../transport/qr")>()), readQr: () => camera.frames.shift() ?? null }));

/** A camera that is live at once and sees whatever is pushed onto `camera.frames`, one frame per scan. */
function fakeCamera() {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {}, getImageData: () => ({}) } as never);
}

const idle = () => {
  vi.setSystemTime(Date.now() + 16 * 60_000);
  document.dispatchEvent(new Event("visibilitychange"));
};

configure({ asyncUtilTimeout: 5000 });
// Each test unlocks a vault and syncs a wallet, slower than five seconds under the whole parallel suite.
vi.setConfig({ testTimeout: 30_000 });

const CHEAP = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
const PARSE = { allowUnknownInputs: true, allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true };
const PAYEE = address(LARGE, 0, 0);
// A P2WPKH example from BIP173. https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
const MAINNET = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
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

async function start(hash: string, mempool: Uint8Array[] = [foreign, parent, child], descriptor = BIP84.text) {
  const vault = await createVault(PASSPHRASE, CHEAP);
  await saveSettings(vault, { server: "wss://node.example:50004" });
  const wallet = await createWallet(vault, { name: "Spending", descriptor, network: "regtest" });
  await vault.put(`labels/${wallet.id}`, { [`output:${id(payA)}:0`]: "Kraken withdrawal", [`output:${id(payB)}:0`]: "Bisq trade" });
  await vault.put(`frozen/${wallet.id}`, [`${id(payC)}:0`]);
  await vault.put("book", [{ address: MAINNET, name: "Cold storage" }]);
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
  await user.type(screen.getByLabelText("Amount, BTC or sats"), btc);
}

let created: string | null = null;
async function builtPsbt(user: ReturnType<typeof userEvent.setup>): Promise<Uint8Array> {
  await payTo(user, PAYEE, "0.001");
  await user.click(screen.getByRole("button", { name: "Clear" }));
  await user.click(await coin(/Kraken withdrawal/));
  await user.click(screen.getByRole("button", { name: "Review and sign" }));
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
  vi.restoreAllMocks();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  camera.frames = [];
  await destroyVault();
});

describe("the send screen", () => {
  it("updates fee and change as coins are toggled, and names the sources a selection links", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.001");
    const map = within(screen.getByRole("region", { name: "What this links" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(map.getByText("Nothing selected")).toBeTruthy();
    const changeRow = () => summary().getByText("Change back to you").parentElement!.textContent;
    expect(changeRow()).toBe("Change back to youNone");

    // At 10 sat/vB, wpkh throughout: 42 WU overhead, 272 per input, 124 per
    // output. One input with payment and change is 562 WU, 141 vB; two are 834 WU, 209 vB.
    await user.click(await coin(/Kraken withdrawal/));
    expect(summary().getByText("Coins in (1)")).toBeTruthy();
    expect(summary().getByText(sats(1_410))).toBeTruthy();
    expect(map.getByText("No new links")).toBeTruthy();

    await user.click(await coin(/Bisq trade/));
    expect(summary().getByText("Coins in (2)")).toBeTruthy();
    expect(summary().getByText(sats(2_090))).toBeTruthy();
    const change = address(BIP84, 1, 0);
    expect(changeRow()).toContain(`${change.slice(0, 10)}…${change.slice(-6)} · m/84h/1h/0h/1/0`);
    expect(map.getByText(/would most likely take the .* output for your change: it is not a round amount/)).toBeTruthy();
    expect(map.getByText("Links 2 sources")).toBeTruthy();
    expect(map.getByText(/permanently linking them: Kraken withdrawal and Bisq trade/)).toBeTruthy();
    expect(map.queryByText(/an exchange that knows who you are/)).toBeNull();

    await user.click(within((await coin(/Kraken withdrawal/)).parentElement!).getByRole("switch", { name: "Knows who I am" }));
    expect(await map.findByText(/^Kraken withdrawal came from an exchange that knows who you are/)).toBeTruthy();
  });

  it("still warns of an exchange that knows who you are once its coin is spent and only the change is left", async () => {
    const user = await start("#/send", []);
    await user.click(within((await coin(/Bisq trade/)).parentElement!).getByRole("switch", { name: "Knows who I am" }));
    await act(async () => backends.at(-1)!.addToMempool(outgoing));
    const change = await coin(/Change at/);
    const switches = within(change.parentElement!).getByRole("switch", { name: "Knows who I am" });
    expect(switches.getAttribute("aria-checked")).toBe("true");

    await payTo(user, PAYEE, "0.001");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(await coin(/Kraken withdrawal/));
    await user.click(change);
    const map = within(screen.getByRole("region", { name: "What this links" }));
    expect(map.getByText(/^Change at .* came from an exchange that knows who you are/)).toBeTruthy();

    await user.click(switches);
    expect(switches.getAttribute("aria-checked")).toBe("false");
    expect(map.queryByText(/an exchange that knows who you are/)).toBeNull();
  });

  it("never picks a frozen coin or one with an unconfirmed parent, and asks before spending someone else's unconfirmed payment", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.0095");

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

  it("picks coins from one source once an amount is typed, until a tap takes over", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.004");
    const map = within(screen.getByRole("region", { name: "What this links" }));
    expect((await coin(/Kraken withdrawal/)).getAttribute("aria-checked")).toBe("true");
    expect((await coin(/Bisq trade/)).getAttribute("aria-checked")).toBe("false");
    expect(map.getByText("No new links")).toBeTruthy();

    await user.click(await coin(/Bisq trade/));
    expect(map.getByText("Links 2 sources")).toBeTruthy();
    await user.clear(screen.getByLabelText("Amount, BTC or sats"));
    await user.type(screen.getByLabelText("Amount, BTC or sats"), "0.001");
    expect(map.getByText("Links 2 sources")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Pick for me" }));
    expect(map.getByText("No new links")).toBeTruthy();
  });

  it("keeps an unfinished send, built PSBT and all, across other screens until discarded", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.001");
    await user.click(screen.getByRole("button", { name: "Review and sign" }));
    expect(await screen.findByRole("img", { name: /^QR code/ })).toBeTruthy();

    location.hash = "#/coins";
    expect(await screen.findByRole("heading", { name: "Coins" })).toBeTruthy();
    location.hash = "#/send";
    expect(await screen.findByRole("img", { name: /^QR code/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to coins" }));
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe(PAYEE);
    expect((screen.getByLabelText("Amount, BTC or sats") as HTMLInputElement).value).toBe("0.001");

    await user.click(screen.getByRole("button", { name: "Discard this send" }));
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("");
  });

  it("does not lock for idleness while the signing QR is showing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const user = await start("#/send");
      await payTo(user, PAYEE, "0.001");
      await user.click(screen.getByRole("button", { name: "Review and sign" }));
      await screen.findByRole("img", { name: /^QR code/ });
      await act(idle);
      expect(screen.getByRole("img", { name: /^QR code/ })).toBeTruthy();
      location.hash = "#/home";
      await waitFor(() => expect(screen.queryByRole("img", { name: /^QR code/ })).toBeNull());
      await act(idle);
      expect(await screen.findByLabelText("Passphrase")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not lock for idleness while the camera scans the signed PSBT back", async () => {
    fakeCamera();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const user = await start("#/send");
      await builtPsbt(user);
      await screen.findByText("Scanning");
      await act(idle);
      expect(screen.getByText("Scanning")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the coins chosen on the Coins screen", async () => {
    const user = await start("#/coins");
    await user.click(await screen.findByRole("checkbox", { name: /^Send 0\.00 300 000 BTC/ }));
    await user.click(screen.getByRole("button", { name: "Send these" }));
    expect((await coin(/Bisq trade/)).getAttribute("aria-checked")).toBe("true");
    expect((await coin(/Kraken withdrawal/)).getAttribute("aria-checked")).toBe("false");
    await payTo(user, PAYEE, "0.004");
    expect((await coin(/Kraken withdrawal/)).getAttribute("aria-checked")).toBe("false");
  });

  it("refuses a wrong-network address and a malformed one, each in its own words", async () => {
    const user = await start("#/send");
    const field = await screen.findByLabelText("Address");
    await user.type(field, MAINNET);
    expect(screen.getByText("This is a mainnet address, but this wallet is on regtest.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix the address first" })).toHaveProperty("disabled", true);

    await user.clear(field);
    await user.type(field, PAYEE.slice(0, -1) + (PAYEE.endsWith("q") ? "p" : "q"));
    expect(screen.getByText(/its checksum does not match/)).toBeTruthy();
  });

  it("keeps the note behind a link until asked, and forgets it with its recipient", async () => {
    const user = await start("#/send");
    await user.click(await screen.findByRole("button", { name: /Add another recipient/ }));
    await user.type(screen.getByLabelText("Address 2"), PAYEE);
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    expect(screen.getByLabelText("Note")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove recipient 2" }));
    await user.click(screen.getByRole("button", { name: /Add another recipient/ }));
    expect(screen.queryByLabelText("Note")).toBeNull();

    await user.click(screen.getByLabelText("Address 2"));
    await user.paste(`bitcoin:${PAYEE}?label=Rent`);
    await user.clear(screen.getByLabelText("Note"));
    expect(screen.getByLabelText("Note")).toBeTruthy();
  });

  it("sends everything spendable in one tap, and says what it left out", async () => {
    const user = await start("#/send");
    await user.type(await screen.findByLabelText("Address"), PAYEE);
    await user.click(screen.getByRole("button", { name: "Send everything" }));
    expect(screen.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("true");
    expect((await coin(/Kraken withdrawal/)).getAttribute("aria-checked")).toBe("true");
    expect((await coin(/Bisq trade/)).getAttribute("aria-checked")).toBe("true");
    expect(summary().getByText("Coins in (2)")).toBeTruthy();
    expect(summary().getByText("Change back to you").parentElement!.textContent).toBe("Change back to youNone");
    // Frozen 200 000, waiting on a parent 150 000, someone else's unconfirmed 100 000.
    expect(screen.getByText(/^Sending everything spendable/).textContent!.replace(/\s+/g, " ")).toMatch(/^Sending everything spendable\. Left out, 0\.00 450 000 ?BTC: 1 frozen, 1 waiting on an unconfirmed parent, 1 unconfirmed from someone else\.$/);
    expect(screen.getByRole("button", { name: "Review and sign" })).toHaveProperty("disabled", false);
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

  it("keeps scanning after a refusal, even the same refusal twice", async () => {
    fakeCamera();
    const user = await start("#/send");
    const built = await builtPsbt(user);
    const wrong = Transaction.fromPSBT(built);
    wrong.updateOutput(0, { amount: wrong.getOutput(0).amount! - 1_000n });
    const frame = (psbt: Uint8Array) => psbtUrEncoder(psbt, 10_000).nextPart();

    camera.frames.push(frame(wrong.toPSBT()));
    expect(await screen.findByText(/This PSBT was refused/)).toBeTruthy();
    camera.frames.push(frame(wrong.toPSBT()));
    await waitFor(() => expect(camera.frames).toHaveLength(0));
    camera.frames.push(frame(signPsbt(built, BIP84)));
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
  });

  it("shows BBQr for a Coldcard Q and takes back the transaction it finished, part by part", async () => {
    fakeCamera();
    const user = await start("#/send");
    const built = await builtPsbt(user);
    await user.click(screen.getByRole("button", { name: "Back to the code" }));
    await user.click(screen.getByText("Signer can't read it?"));
    await user.click(screen.getByRole("button", { name: "BBQr" }));
    expect(screen.getByRole("img", { name: `QR code, part 1 of ${bbqrParts(built, "P", 160).length}` })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("qr-export")!).format).toBe("bbqr");
    localStorage.removeItem("qr-export");

    await user.click(screen.getByRole("button", { name: "Signed it, scan it back" }));
    const finished = Transaction.fromPSBT(signPsbt(built, BIP84));
    finished.finalize();
    const parts = bbqrParts(finished.extract(), "T", 80);
    camera.frames.push(parts[1]!);
    expect(await screen.findByText((_, el) => el?.tagName === "SPAN" && el.textContent === `1 of ${parts.length} parts captured`)).toBeTruthy();
    camera.frames.push(...parts);
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
  });

  it("keeps a built send, then its signed transaction, through a lock and offers to resume it", async () => {
    const user = await start("#/send");
    const built = await builtPsbt(user);
    const relock = async () => {
      await user.click(screen.getByRole("button", { name: "Lock" }));
      await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
      await user.click(screen.getByRole("button", { name: "Unlock" }));
    };
    location.hash = "#/home";
    await relock();
    expect(await screen.findByText("A transaction you built is waiting to be signed.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resume it" }).getAttribute("href")).toBe("#/send");

    location.hash = "#/send";
    await user.click(await screen.findByRole("button", { name: "Signed it, scan it back" }));
    await upload(user, signPsbt(built, BIP84));
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
    await relock();
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
  });

  it("forgets a saved send once its coins are spent elsewhere", async () => {
    const user = await start("#/send");
    await builtPsbt(user);
    await user.click(screen.getByRole("button", { name: "Lock" }));
    fixture.blocks!.push([tx([[id(payA), 0]], [[theirs, 499_000]])]);
    await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe(""));
    expect(screen.queryByText("Signed it, scan it back")).toBeNull();
  });

  it("broadcasts a PSBT signed elsewhere after showing every output, and refuses one spending coins not this wallet's", async () => {
    const user = await start("#/send");
    const built = await builtPsbt(user);
    await user.click(screen.getByRole("button", { name: "Back to coins" }));
    await user.click(screen.getByRole("button", { name: "Discard this send" }));
    expect(screen.getByRole("link", { name: "Broadcast a PSBT signed elsewhere" }).getAttribute("href")).toBe("#/broadcast");
    location.hash = "#/broadcast";
    await screen.findByRole("heading", { name: "Broadcast a signed transaction" });

    const stranger = new Transaction();
    stranger.addInput({ txid: id(faucet), index: 5, witnessUtxo: { script: theirs, amount: 100_000_000n } });
    stranger.addOutput({ script: theirs, amount: 99_999_000n });
    await upload(user, stranger.toPSBT());
    expect(await screen.findByText("This PSBT was refused: Input 1 is not one of this wallet's unspent coins.")).toBeTruthy();

    const bare = Transaction.fromPSBT(signPsbt(built, BIP84));
    for (let i = 0; i < bare.outputsLength; i++) bare.updateOutput(i, { bip32Derivation: undefined }, true);
    const signed = bare.toPSBT();
    await upload(user, signed);
    expect(await screen.findByRole("heading", { name: "Check before you broadcast" })).toBeTruthy();
    expect(screen.getByText(PAYEE)).toBeTruthy();
    expect(screen.getByText("Change back to you")).toBeTruthy();
    const { lead, rest } = btcParts(100_000 + Number(bare.fee));
    expect(screen.getByText("Total leaving the wallet").parentElement!.textContent).toBe(`Total leaving the wallet${lead}${rest}BTC`);
    await user.click(screen.getByRole("button", { name: "Broadcast through your server" }));
    expect(await screen.findByText(Transaction.fromPSBT(signed).id)).toBeTruthy();
  });

  it("shows the node's rejection word for word", async () => {
    const reason = "insufficient fee, rejecting replacement 3f2a; new feerate 0.00001000 BTC/kvB <= old feerate 0.00002000 BTC/kvB";
    fixture.broadcastRejection = reason;
    const user = await start("#/send");
    await upload(user, signPsbt(await builtPsbt(user), BIP84));
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    expect((await screen.findByText(reason)).textContent).toBe(reason);
  });

  it("keeps the signed transaction across other screens, broadcasts, and its change is spendable", async () => {
    const user = await start("#/send");
    const signed = signPsbt(await builtPsbt(user), BIP84);
    await upload(user, signed);
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
    location.hash = "#/coins";
    expect(await screen.findByRole("heading", { name: "Coins" })).toBeTruthy();
    location.hash = "#/send";
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Broadcast through your server" }));
    const txid = Transaction.fromPSBT(signed).id;
    expect(await screen.findByText(txid)).toBeTruthy();
    location.hash = "#/send";
    expect(await coin(/Your change, unconfirmed/)).toBeTruthy();
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("");
  });
});

describe("address book", () => {
  it("saves a recipient, offers it on its own network only, and names the payment with it", async () => {
    const user = await start("#/send");
    const field = (await screen.findByLabelText("Address")) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Choose a saved address" })).toBeNull();
    // Uppercase, as bech32 is often written in QR codes; saved and labelled by its lowercase spelling.
    await user.type(field, PAYEE.toUpperCase());
    await user.click(screen.getByRole("button", { name: "Save to address book" }));
    await user.type(screen.getByLabelText("Name"), "Landlord");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Valid regtest address, saved as Landlord")).toBeTruthy();

    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Choose a saved address" }));
    expect(screen.queryByText("Cold storage")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Landlord/ }));
    expect(field.value).toBe(PAYEE);
    await user.type(screen.getByLabelText("Amount, BTC or sats"), "0.001");
    await user.click(screen.getByRole("button", { name: "Review and sign" }));
    expect(await screen.findByText("Payment 1 to Landlord")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to coins" }));
    await user.clear(field);
    await user.clear(screen.getByLabelText("Amount, BTC or sats"));

    const psbt = await builtPsbt(user);
    await upload(user, signPsbt(psbt, BIP84));
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    const signed = Transaction.fromPSBT(psbt);
    expect(await screen.findByText(signed.id, {}, { timeout: 15_000 })).toBeTruthy();
    const vout = Array.from({ length: signed.outputsLength }, (_, i) => signed.getOutput(i).script!).findIndex((s) => s.join() === script(LARGE, 0, 0).join());

    location.hash = "#/home";
    expect(await screen.findByText("Landlord")).toBeTruthy();
    location.hash = "#/settings";
    let exported: Blob | undefined;
    URL.createObjectURL = (b: Blob) => ((exported = b), "blob:labels");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(await screen.findByRole("button", { name: "Export labels" }));
    expect((await exported!.text()).trim().split("\n").map((l) => JSON.parse(l))).toContainEqual(expect.objectContaining({ type: "output", ref: `${signed.id}:${vout}`, label: "Landlord" }));

    await user.click(screen.getByRole("button", { name: "Rename Landlord" }));
    await user.clear(screen.getByLabelText("New name for Landlord"));
    await user.type(screen.getByLabelText("New name for Landlord"), "Rent{Enter}");
    await user.click(await screen.findByRole("button", { name: "Delete Cold storage" }));
    expect(await screen.findByText("1 saved")).toBeTruthy();
    location.hash = "#/send";
    await user.type(await screen.findByLabelText("Address"), PAYEE);
    expect(screen.getByText("Valid regtest address, saved as Rent")).toBeTruthy();
  }, 60_000);
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

  it("cancels a payment by sending its coins back, and says it can still lose the race", async () => {
    const user = await start(`#/tx/${id(outgoing)}`, [outgoing]);
    await user.click(await screen.findByRole("button", { name: "Cancel transaction" }));
    expect(await screen.findByRole("heading", { name: "Cancel this transaction" })).toBeTruthy();
    expect(screen.getByText(/if the original confirms before it, the payment stands/)).toBeTruthy();
    expect(screen.getByText("Payments, cancelled").nextElementSibling!.textContent).toMatch(/^0\.00 200 000/);
    await user.click(screen.getByRole("button", { name: "Build the cancellation" }));
    expect(await screen.findByRole("heading", { name: "Sign the cancellation" })).toBeTruthy();
  });

  it("pays for an unconfirmed incoming payment with a child", async () => {
    const user = await start(`#/tx/${id(foreign)}`);
    await user.click(await screen.findByRole("button", { name: "Speed up with a child" }));
    expect(await screen.findByRole("heading", { name: "Speed up with a child transaction" })).toBeTruthy();
    expect(screen.getByText(/supports package relay/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Build the child" }));
    expect(await screen.findByRole("heading", { name: "Sign the child transaction" })).toBeTruthy();
  });
});

describe("coin economics", () => {
  // Two small coins paid in one transaction, so one source.
  const dribble = tx([[id(faucet), 5]], [[script(BIP84, 0, 5), 600], [script(BIP84, 0, 6), 9_000], [theirs, 99_990_000]]);
  beforeEach(() => fixture.blocks![1]!.push(dribble));

  it("says what each coin costs to spend and flags one worth less than that", async () => {
    const user = await start("#/send");
    await payTo(user, PAYEE, "0.001");
    // A wpkh input is 68 vB, so 680 sats at the 10 sat/vB the send starts on.
    expect(await coin(/0\.00 000 600 BTC.*Uneconomic at 10 sat\/vB/)).toBeTruthy();
    expect(screen.getAllByText(/^Uneconomic at/)).toHaveLength(1);
    expect(screen.getAllByText("680 sats to spend").length).toBeGreaterThan(1);

    location.hash = "#/coins";
    expect(await screen.findByText("Uneconomic at 10 sat/vB")).toBeTruthy();
    expect(screen.queryByText(/Fees are low/)).toBeNull();
  });

  it("offers to join one source's small coins while fees are low, through the normal send", async () => {
    fixture.feeHistogram = [{ feeRate: 1, vsize: 50_000 }];
    const user = await start("#/coins");
    // At 50 sat/vB each coin costs 3 400 sats to spend, 6 800 for both. Joined
    // at 1 sat/vB: 42 + 2 × 272 + 124 WU is 178 vB, 178 sats, then 3 400 once.
    expect(await screen.findByText(/Saves 3.222 sats/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Join these 2 coins" }));

    expect(((await screen.findByLabelText("Address")) as HTMLInputElement).value).toBe(address(BIP84, 1, 0));
    expect((await coin(/^0\.00 000 600 BTC/)).getAttribute("aria-checked")).toBe("true");
    expect((await coin(/^0\.00 009 000 BTC/)).getAttribute("aria-checked")).toBe("true");
    expect(summary().getByText(sats(178))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review and sign" })).toHaveProperty("disabled", false);
  });
});

describe("a 2-of-3 multisig wallet", () => {
  const c = MULTISIG.descriptor.keys[2]!.origin!.fingerprint;
  beforeEach(() => {
    fixture.blocks = [[faucet], [tx([[id(faucet), 5]], [[script(MULTISIG, 0, 0), 400_000], [theirs, 99_599_000]])]];
  });

  it("asks to check a receive address on a cosigner device, giving each cosigner's path", async () => {
    await start("#/receive", [], MULTISIG.text);
    expect(await screen.findByText(/A 2-of-3 multisig address\. Check it on a cosigner device/)).toBeTruthy();
    const [a, b] = MULTISIG.descriptor.keys.map((k) => k.origin!.fingerprint);
    expect(screen.getByText("Each cosigner's path").nextElementSibling!.textContent).toBe(`m/48h/1h/0h/2h/0/1 on ${a}, ${b}, ${c}`);
  });

  it("collects cosigners' signatures on a PSBT made elsewhere, saying whose, then broadcasts at two", async () => {
    const user = await start("#/send", [], MULTISIG.text);
    await payTo(user, PAYEE, "0.001");
    await user.click(screen.getByRole("button", { name: "Review and sign" }));
    let blob: Blob | null = null;
    URL.createObjectURL = (x: Blob) => ((blob = x), "blob:psbt");
    URL.revokeObjectURL = () => {};
    await user.click(await screen.findByRole("button", { name: "Save PSBT file" }));
    const built = new Uint8Array(await blob!.arrayBuffer());
    await user.click(screen.getByRole("button", { name: "Back to coins" }));
    await user.click(screen.getByRole("button", { name: "Discard this send" }));
    location.hash = "#/broadcast";
    expect(await screen.findByText(/This needs 2 of 3 signatures/)).toBeTruthy();

    // Another wallet's PSBT need not say which keys or script its inputs use.
    const bare = Transaction.fromPSBT(signPsbt(built, MULTISIG.cosigners[2]!));
    bare.updateInput(0, { bip32Derivation: undefined, witnessScript: undefined }, true);
    await upload(user, bare.toPSBT());
    expect(await screen.findByText(`1 of 2 signatures so far, from ${c}. Scan or load a PSBT another cosigner has signed.`)).toBeTruthy();
    await upload(user, signPsbt(built, MULTISIG.cosigners[0]!));
    expect(await screen.findByRole("heading", { name: "Check before you broadcast" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Broadcast through your server" }));
    expect(await screen.findByText(Transaction.fromPSBT(built).id)).toBeTruthy();
  });

  it("collects one cosigner's signatures at a time, saying whose, then broadcasts at two", async () => {
    const user = await start("#/send", [], MULTISIG.text);
    await payTo(user, PAYEE, "0.001");
    await user.click(screen.getByRole("button", { name: "Review and sign" }));
    expect(await screen.findByText(/This needs 2 of 3 signatures/)).toBeTruthy();
    let blob: Blob | null = null;
    URL.createObjectURL = (x: Blob) => ((blob = x), "blob:psbt");
    URL.revokeObjectURL = () => {};
    await user.click(screen.getByRole("button", { name: "Save PSBT file" }));
    const built = new Uint8Array(await blob!.arrayBuffer());
    await user.click(screen.getByRole("button", { name: "Signed it, scan it back" }));
    await upload(user, signPsbt(built, MULTISIG.cosigners[2]!));
    expect(await screen.findByText(`1 of 2 signatures so far, from ${c}. Show this code to another cosigner, or scan a PSBT another cosigner has signed.`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Lock" }));
    await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText(/^1 of 2 signatures so far, from /)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save PSBT file" }));
    const partly = new Uint8Array(await blob!.arrayBuffer());
    expect(Transaction.fromPSBT(partly).getInput(0).partialSig).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Signed it, scan it back" }));
    await upload(user, signPsbt(partly, MULTISIG.cosigners[0]!));
    expect(await screen.findByText("Signed and checked")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Broadcast through your server" }));
    expect(await screen.findByText(Transaction.fromPSBT(built).id)).toBeTruthy();
  });
});
