import { Address, OutScript, Transaction as Tx } from "@scure/btc-signer";
import { cleanup, configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { scriptHash } from "../backend/backend";
import type { FakeBackend } from "../backend/fake";
import { demoBackend, DEMO_DESCRIPTOR, DEMO_FOREIGN, seedDemoVault } from "../backend/fixture";
import { createVault, destroyVault } from "../vault/vault";
import { saveSettings } from "../core/wallets";
import { deriveAddress } from "../wallet/derive";
import { parseDescriptor } from "../wallet/descriptor";
import { NETWORKS } from "../wallet/network";

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const CHEAP = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
const SERVER = "wss://node.example.ts.net:50004";
// The fake chain's header time at the demo tip, 153,500.
const DEMO_TIP_TIME = 1_792_100_000_000;

async function unlock(factory: () => FakeBackend) {
  location.hash = "#/home";
  render(<App kdf={CHEAP} factory={factory} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  return user;
}

const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const box = screen.getByRole("searchbox", { name: "Search the chain" });
  await user.clear(box);
  await user.type(box, `${text}{Enter}`);
};

const list = (title: string) => within(screen.getByRole("heading", { name: title }).closest("section")!);

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

describe("searching", () => {
  it("opens a transaction no wallet holds, marks what an open wallet owns, and writes none of it to the vault", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const paid = deriveAddress(parseDescriptor(DEMO_DESCRIPTOR, "mainnet"), "mainnet", 0, 7);
    const pay = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    pay.addInput({ txid: DEMO_FOREIGN.confirmed, index: 1, sequence: 0xfffffffd });
    pay.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(paid)), amount: 30_000_000n });
    pay.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(DEMO_FOREIGN.address)), amount: 7_997_000n });
    const hidden = scriptHash(OutScript.encode(Address(NETWORKS.mainnet).decode(paid)));
    // A server that has the payment but has not yet listed it in the wallet's history.
    const user = await unlock(() => {
      const demo = demoBackend();
      demo.addToMempool(pay.unsignedTx);
      return { ...demo, history: async (hashes: string[]) => (await demo.history(hashes)).map((h, i) => (hashes[i] === hidden ? [] : h)) };
    });
    await screen.findByText(/Up to date at block 153.500/, undefined, { timeout: 15_000 });

    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");
    await search(user, pay.id.toUpperCase());

    expect(await screen.findByRole("heading", { name: "Transaction" })).toBeTruthy();
    expect(location.hash).toBe(`#/tx/${pay.id}`);
    expect(list("Outputs").getByText("Spending")).toBeTruthy();
    expect(list("Outputs").getAllByRole("listitem")).toHaveLength(2);
    expect(list("Inputs").queryByText("Spending")).toBeNull();
    expect(screen.getByText("1 600 sats")).toBeTruthy();
    expect(screen.getByText("Waiting for a block")).toBeTruthy();
    expect(screen.getByText("Signals RBF")).toBeTruthy();
    expect(transaction.mock.calls.filter(([, mode]) => mode === "readwrite")).toEqual([]);
  });

  it("says plainly what an input is not, and when a transaction is not found", async () => {
    await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
    const user = await unlock(demoBackend);
    await screen.findByText(/Up to date at block 153.500/, undefined, { timeout: 15_000 });

    await search(user, "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    expect(screen.getByRole("alert").textContent).toBe("This is a testnet or signet address, but this wallet is on mainnet.");
    await search(user, "153500");
    expect(screen.getByRole("alert").textContent).toBe("Looking up a block isn't here yet.");
    await search(user, "not a thing");
    expect(screen.getByRole("alert").textContent).toMatch(/^Search takes a transaction ID/);

    await search(user, "cd".repeat(32));
    expect(await screen.findByRole("heading", { name: "No transaction with this ID" })).toBeTruthy();
    expect(screen.getByText(/search by height instead/)).toBeTruthy();
  });

  it("looks a transaction up with no wallet imported", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await saveSettings(vault, { server: SERVER });
    vault.lock();
    const user = await unlock(demoBackend);
    await screen.findByText(/block 153.500/, undefined, { timeout: 15_000 });

    await search(user, DEMO_FOREIGN.pending);
    expect(await screen.findByRole("heading", { name: "Transaction" })).toBeTruthy();
    expect(screen.getByText("1 500 sats")).toBeTruthy();
    expect(list("Outputs").getAllByRole("listitem")).toHaveLength(2);
  });
});
