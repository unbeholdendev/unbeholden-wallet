import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { BroadcastError, txidOf } from "../../backend/backend";
import type { FakeBackend } from "../../backend/fake";
import { demoBackend, DEMO_UNSENT, seedDemoVault } from "../../backend/fixture";
import { saveSettings } from "../../core/wallets";
import { createVault, destroyVault } from "../../vault/vault";

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const CHEAP = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
const SERVER = "wss://node.example.ts.net:50004";
// The fake chain's header time at the demo tip, 153,500.
const DEMO_TIP_TIME = 1_792_100_000_000;
const TXID = txidOf(hex.decode(DEMO_UNSENT));

function otherRaw() {
  const tx = new Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
  tx.addInput({ txid: "ab".repeat(32), index: 0 });
  tx.addOutput({ script: hex.decode("0014" + "22".repeat(20)), amount: 10_000n });
  return hex.encode(tx.unsignedTx);
}

async function unlock(factory: () => FakeBackend) {
  location.hash = "#/home";
  render(<App kdf={CHEAP} factory={factory} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText(/block 153.500/, undefined, { timeout: 15_000 });
  return user;
}

const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const box = screen.getByRole("searchbox", { name: "Search the chain" });
  await user.clear(box);
  await user.click(box);
  await user.paste(text);
  await user.keyboard("{Enter}");
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DEMO_TIP_TIME + 10 * 60_000);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await destroyVault();
});

describe("broadcasting a raw transaction", () => {
  it("shows a stranger's transaction and fee from a search, broadcasts it, and writes none of it to the vault", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const user = await unlock(demoBackend);
    await screen.findByText(/Up to date at block 153.500/, undefined, { timeout: 15_000 });
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");

    await search(user, DEMO_UNSENT.toUpperCase());
    expect(await screen.findByRole("heading", { name: "Broadcast a transaction" })).toBeTruthy();
    expect(location.hash).toBe(`#/broadcast/${DEMO_UNSENT}`);
    expect(screen.getByText("2 500 sats")).toBeTruthy();
    expect(screen.getByText("Not broadcast")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Broadcast through your server" }));
    expect(await screen.findByText("Waiting for a block")).toBeTruthy();
    expect(location.hash).toBe(`#/tx/${TXID}`);
    expect(transaction.mock.calls.filter(([, mode]) => mode === "readwrite")).toEqual([]);
  });

  it("shows the node's reason for refusing it, word for word", async () => {
    const reason = "bad-txns-inputs-missingorspent";
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const user = await unlock(() => ({ ...demoBackend(), broadcast: async () => Promise.reject(new BroadcastError(reason)) }));
    await search(user, DEMO_UNSENT);
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    expect((await screen.findByRole("alert")).textContent).toBe(`Your node refused this transaction. Its reason:${reason}`);
    expect(location.hash).toBe(`#/broadcast/${DEMO_UNSENT}`);
  });

  it("forgets a refusal when another transaction is opened", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const user = await unlock(() => ({ ...demoBackend(), broadcast: async () => Promise.reject(new BroadcastError("bad-txns-inputs-missingorspent")) }));
    await search(user, DEMO_UNSENT);
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    await screen.findByRole("alert");
    await search(user, otherRaw());
    expect(await screen.findByRole("button", { name: "Broadcast through your server" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays on another transaction opened while the last one was broadcasting", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const demo = demoBackend();
    let release = () => {};
    const user = await unlock(() => ({
      ...demo,
      broadcast: async (raw: Uint8Array) => {
        await new Promise<void>((resolve) => (release = resolve));
        return demo.broadcast(raw);
      },
    }));
    await search(user, DEMO_UNSENT);
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    await screen.findByRole("button", { name: "Broadcasting" });
    const other = otherRaw();
    await search(user, other);
    const button = await screen.findByRole("button", { name: "Broadcast through your server" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    release();
    await new Promise((settle) => setTimeout(settle, 100));
    expect(location.hash).toBe(`#/broadcast/${other}`);
  });

  it("takes raw hex pasted where a signed PSBT goes", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const user = await unlock(demoBackend);
    location.hash = "#/broadcast";
    await screen.findByRole("heading", { name: "Broadcast a signed transaction" });
    await user.click(screen.getByLabelText("Or paste it, base64 or hex"));
    await user.paste(DEMO_UNSENT);
    await user.click(screen.getByRole("button", { name: "Check pasted PSBT" }));
    expect(await screen.findByRole("heading", { name: "Broadcast a transaction" })).toBeTruthy();
    expect(screen.getByText("2 500 sats")).toBeTruthy();
  });

  it.each([
    ["binary", hex.decode(DEMO_UNSENT)],
    ["hex", new TextEncoder().encode(`${DEMO_UNSENT}\n`)],
  ])("takes a %s raw transaction loaded from a file where a signed PSBT goes", async (_, bytes) => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const user = await unlock(demoBackend);
    location.hash = "#/broadcast";
    await screen.findByRole("heading", { name: "Broadcast a signed transaction" });
    await user.upload(screen.getByLabelText("Load signed file"), new File([bytes as Uint8Array<ArrayBuffer>], "signed.txn"));
    expect(await screen.findByRole("heading", { name: "Broadcast a transaction" })).toBeTruthy();
    expect(screen.getByText("2 500 sats")).toBeTruthy();
  });

  it("broadcasts with no wallet imported", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await saveSettings(vault, { server: SERVER });
    vault.lock();
    const user = await unlock(demoBackend);
    location.hash = `#/broadcast/${DEMO_UNSENT}`;
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    expect(await screen.findByText("Waiting for a block")).toBeTruthy();
  });

  it("says so when the hex is not a transaction", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    await unlock(demoBackend);
    location.hash = "#/broadcast/abcd";
    expect(await screen.findByRole("heading", { name: "That isn't a raw transaction" })).toBeTruthy();
  });
});
