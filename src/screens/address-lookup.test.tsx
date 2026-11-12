import { Address, OutScript, Transaction as Tx } from "@scure/btc-signer";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { RefusedError, scriptHash } from "../backend/backend";
import type { FakeBackend } from "../backend/fake";
import { DEMO_DESCRIPTOR, DEMO_FOREIGN, demoBackend, seedDemoVault } from "../backend/fixture";
import { destroyVault } from "../vault/vault";
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
  await seedDemoVault(PASSPHRASE, CHEAP, SERVER);
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
  await user.type(box, `${text}{Enter}`);
};

const list = (title: string) => within(screen.getByRole("heading", { name: title }).closest("section")!);
const scriptOf = (address: string) => OutScript.encode(Address(NETWORKS.mainnet).decode(address));

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

describe("looking an address up", () => {
  it("shows its balance, history and unspent outputs, and writes none of it to the vault", async () => {
    const user = await unlock(demoBackend);
    await screen.findByText(/Up to date at block 153.500/, undefined, { timeout: 15_000 });
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");
    await search(user, DEMO_FOREIGN.address);

    expect(await screen.findByRole("heading", { name: "Address" })).toBeTruthy();
    expect(location.hash).toBe(`#/address/${DEMO_FOREIGN.address}`);
    expect(list("History").getAllByRole("listitem")).toHaveLength(2);
    expect(list("History").getByText("Waiting for a block")).toBeTruthy();
    expect(
      list("History")
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual([`#/tx/${DEMO_FOREIGN.pending}`, `#/tx/${DEMO_FOREIGN.confirmed}`]);
    expect(list("Unspent outputs").getAllByRole("listitem")).toHaveLength(2);
    expect(list("Address").queryByText("Spending")).toBeNull();
    expect(transaction.mock.calls.filter(([, mode]) => mode === "readwrite")).toEqual([]);
  });

  it("marks an address an open wallet owns with the wallet's name", async () => {
    const user = await unlock(demoBackend);
    await search(user, deriveAddress(parseDescriptor(DEMO_DESCRIPTOR, "mainnet"), "mainnet", 0, 0));
    expect(await screen.findByRole("heading", { name: "Address" })).toBeTruthy();
    expect(list("Address").getByText("Spending")).toBeTruthy();
  });

  it("fills in amounts 25 at a time", async () => {
    const script = scriptOf(DEMO_FOREIGN.address);
    const payments = Array.from({ length: 30 }, (_, i) => {
      const t = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
      t.addInput({ txid: "55".repeat(32), index: i });
      t.addOutput({ script, amount: BigInt(1_000 + i) });
      return t.unsignedTx;
    });
    const demo = demoBackend();
    for (const raw of payments) demo.addToMempool(raw);
    const user = await unlock(() => demo);
    await search(user, DEMO_FOREIGN.address);
    expect(await screen.findByRole("heading", { name: "Address" })).toBeTruthy();
    expect(list("History").getAllByText("Not loaded")).toHaveLength(7);
    await user.click(screen.getByRole("button", { name: "Load 7 more amounts" }));
    await waitFor(() => expect(list("History").queryByText("Not loaded")).toBeNull());
    expect(screen.queryByRole("button", { name: /more amounts/ })).toBeNull();
  });

  it.each([
    ["the refresh", [0, 1]],
    ["the next page", [1, 0]],
  ])(
    "keeps every loaded amount when a new block's refresh and the next page cross, %s landing first",
    async (_, order) => {
      const script = scriptOf(DEMO_FOREIGN.address);
      const payments = Array.from({ length: 30 }, (_, i) => {
        const t = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
        t.addInput({ txid: "55".repeat(32), index: i });
        t.addOutput({ script, amount: BigInt(1_000 + i) });
        return t;
      });
      const paymentIds = new Set(payments.map((t) => t.id));
      const demo = demoBackend();
      for (const t of payments) demo.addToMempool(t.unsignedTx);
      const held: (() => void)[] = [];
      let holding = false;
      const user = await unlock(() => ({
        ...demo,
        transactions: async (txids: string[]) => {
          if (holding && txids.some((id) => paymentIds.has(id)))
            await new Promise<void>((release) => held.push(release));
          return demo.transactions(txids);
        },
      }));
      await search(user, DEMO_FOREIGN.address);
      expect(await screen.findByRole("heading", { name: "Address" })).toBeTruthy();
      expect(list("History").getAllByText("Not loaded")).toHaveLength(7);

      holding = true;
      demo.addBlock([]);
      await waitFor(() => expect(held).toHaveLength(1));
      await user.click(screen.getByRole("button", { name: "Load 7 more amounts" }));
      await waitFor(() => expect(held).toHaveLength(2));
      const [refresh, page] = [held[0]!, held[1]!];
      holding = false;
      for (const i of order) {
        [refresh, page][i]!();
        await new Promise((settle) => setTimeout(settle, 50));
      }
      await waitFor(() => expect(list("History").queryByText("Not loaded")).toBeNull());
      expect(screen.queryByRole("button", { name: /more amounts/ })).toBeNull();
    },
  );

  it("keeps another address's amounts when a page for the last one lands after it", async () => {
    const script = scriptOf(DEMO_FOREIGN.address);
    const payments = Array.from({ length: 30 }, (_, i) => {
      const t = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
      t.addInput({ txid: "55".repeat(32), index: i });
      t.addOutput({ script, amount: BigInt(1_000 + i) });
      return t;
    });
    const paymentIds = new Set(payments.map((t) => t.id));
    const demo = demoBackend();
    for (const t of payments) demo.addToMempool(t.unsignedTx);
    const held: (() => void)[] = [];
    let holding = false;
    const user = await unlock(() => ({
      ...demo,
      transactions: async (txids: string[]) => {
        if (holding && txids.some((id) => paymentIds.has(id))) await new Promise<void>((release) => held.push(release));
        return demo.transactions(txids);
      },
    }));
    await search(user, DEMO_FOREIGN.address);
    expect(await screen.findByRole("heading", { name: "Address" })).toBeTruthy();
    holding = true;
    await user.click(screen.getByRole("button", { name: "Load 7 more amounts" }));
    await waitFor(() => expect(held).toHaveLength(1));

    await search(user, deriveAddress(parseDescriptor(DEMO_DESCRIPTOR, "mainnet"), "mainnet", 0, 0));
    await waitFor(() => expect(list("Address").getByText("Spending")).toBeTruthy());
    expect(list("History").queryByText("Not loaded")).toBeNull();
    held[0]!();
    await new Promise((settle) => setTimeout(settle, 100));
    expect(list("History").queryByText("Not loaded")).toBeNull();
    expect(screen.queryByRole("button", { name: /Loading amounts|more amounts/ })).toBeNull();
  });

  it("shows the server's refusal of a history it holds too large, word for word", async () => {
    const refused = scriptHash(scriptOf(DEMO_FOREIGN.address));
    const user = await unlock(() => {
      const demo = demoBackend();
      return {
        ...demo,
        history: async (hashes: string[]) => {
          if (hashes.includes(refused)) throw new RefusedError("history too large");
          return demo.history(hashes);
        },
      };
    });
    await search(user, DEMO_FOREIGN.address);
    expect(await screen.findByRole("heading", { name: "The server won't list this address" })).toBeTruthy();
    expect(screen.getByText("history too large")).toBeTruthy();
  });
});
