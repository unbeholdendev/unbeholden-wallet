import { Address, OutScript, Transaction as Tx } from "@scure/btc-signer";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { ConnectionStatus } from "../backend/electrum";
import { fakeBackend, type FakeBackend } from "../backend/fake";
import { demoBackend, DEMO_DESCRIPTOR, DEMO_TXIDS, seedDemoVault } from "../backend/fixture";
import { createWallet, saveSettings } from "../core/wallets";
import { createVault, destroyVault, unlockVault } from "../vault/vault";
import { deriveAddress } from "../wallet/derive";
import { parseDescriptor } from "../wallet/descriptor";
import { NETWORKS } from "../wallet/network";
import { bip21 } from "./Receive";
import { parseUri } from "./send/Recipients";

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const CHEAP = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
let backends: FakeBackend[] = [];

async function openApp(hash = "#/home") {
  location.hash = "#/home";
  render(
    <App
      kdf={CHEAP}
      factory={() => {
        backends.push(demoBackend());
        return backends.at(-1)!;
      }}
    />,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText(/Up to date at block 153.500/, undefined, { timeout: 15_000 });
  go(hash);
  return user;
}

const go = (hash: string) => {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

const row = (label: string) => screen.getByRole("link", { name: label }).closest("li")!.textContent;
const shownLabels = () =>
  screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("#/tx/")).map((a) => a.textContent);
const spendable = () => screen.getByText("Spendable now").nextElementSibling!.textContent;

beforeEach(async () => {
  backends = [];
  await seedDemoVault(PASSPHRASE, CHEAP, "wss://node.example.ts.net:50004");
});

afterEach(async () => {
  cleanup();
  await destroyVault();
});

describe("wallet views on the demo history", () => {
  it("shows the balances and each payment's amount and direction, newest first", async () => {
    const user = await openApp();
    const balance = screen.getByRole("region", { name: "Balance" }).textContent;
    expect(balance).toContain("Spendable now0.30 926 773");
    expect(balance).not.toContain("waiting to confirm");
    expect(balance).toContain("0.00 021 400 frozen");

    expect(row("Rent, October")).toContain("−0.01 451 440");
    expect(row("Meridian Ltd invoice 118")).toContain("+0.00 300 000");
    expect(row("Sold bike to Tom")).toContain("+0.00 650 000");
    expect(row("Sold bike to Tom")).toContain("3 conf");
    expect(row("Hardware shop, SeedSigner parts")).toContain("−0.00 832 120");
    expect(row("Hardware shop, SeedSigner parts")).toContain("Confirmed");
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.indexOf(`#/tx/${DEMO_TXIDS.tom}`)).toBeLessThan(links.indexOf(`#/tx/${DEMO_TXIDS.kraken}`));

    await user.type(screen.getByRole("searchbox"), "payroll");
    expect(screen.getAllByRole("link", { name: /Northwind payroll/ })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Rent, October" })).toBeNull();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "0.0083");
    expect(screen.getByRole("link", { name: "Hardware shop, SeedSigner parts" })).toBeTruthy();

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "withdrawals");
    expect(shownLabels()).toEqual(["Hardware shop, SeedSigner parts"]);
  });

  it("filters the history by direction, confirmation, date and amount", async () => {
    const user = await openApp();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Sent" }));
    expect(shownLabels()).toEqual(["Rent, October", "Hardware shop, SeedSigner parts"]);
    await user.click(screen.getByRole("checkbox", { name: "Unconfirmed only" }));
    expect(shownLabels()).toEqual(["Rent, October"]);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    // The demo's blocks put the hardware shop payment on 3 September 2026, its neighbours days either side.
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-15" } });
    expect(shownLabels()).toEqual(["Hardware shop, SeedSigner parts"]);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await user.type(screen.getByLabelText("At least"), "0.06");
    expect(shownLabels()).toEqual(["Ocean payout, August", "Kraken withdrawal, July"]);
    await user.type(screen.getByLabelText("At most"), "6000000 sats");
    expect(shownLabels()).toEqual(["Ocean payout, August"]);
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeTruthy();
  });

  it("exports the history as CSV and lets the download go", async () => {
    let exported: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => ((exported = blob as Blob), "blob:history"));
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = await openApp("#/settings");
    await user.click(screen.getByRole("button", { name: "Export history as CSV" }));
    const lines = (await exported!.text()).trim().split("\r\n");
    expect(lines[0]).toBe("date,txid,direction,net_btc,net_sats,fee_btc,fee_sats,confirmations,height,label");
    expect(lines).toHaveLength(11);
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`^[^,]*,${DEMO_TXIDS.rent},sent,-0.01451440,-1451440,0.00001440,1440,0,,"Rent, October"$`)));
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`,${DEMO_TXIDS.tom},received,0.00650000,650000,,,3,153498,Sold bike to Tom$`)));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:history"));
    vi.restoreAllMocks();
  });

  it("details a transaction and offers to speed up an unconfirmed payment", async () => {
    await openApp(`#/tx/${DEMO_TXIDS.rent}`);
    expect(await screen.findByText("1 440 sats")).toBeTruthy();
    expect(screen.getByText("Your change")).toBeTruthy();
    expect(screen.getByText("m/84h/0h/0h/1/1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Speed up" }));
    expect(location.hash).toBe(`#/bump/${DEMO_TXIDS.rent}`);
  });

  it("labels an output that pays someone else", async () => {
    const user = await openApp(`#/tx/${DEMO_TXIDS.rent}`);
    await user.click(await screen.findByRole("button", { name: "Label this payment" }));
    await user.type(screen.getByLabelText("Label"), "Landlord{Enter}");
    expect(await screen.findByRole("button", { name: /^Landlord, edit label/ })).toBeTruthy();
  });

  it("keeps a built replacement after locking and unlocking", async () => {
    const user = await openApp(`#/bump/${DEMO_TXIDS.rent}`);
    await user.click(await screen.findByRole("button", { name: "Build the replacement" }));
    expect(location.hash).toBe("#/send");

    cleanup();
    await openApp("#/home");
    expect(await screen.findByText("A transaction you built is waiting to be signed.")).toBeTruthy();
  });

  it("traces a coin back to where its value came in, and names the coins it is already linked with", async () => {
    const user = await openApp("#/coins");
    await user.click(await screen.findByRole("link", { name: /0\.01 048 560/ }));
    expect(location.hash).toBe(`#/coin/${DEMO_TXIDS.rent}:1`);
    const trail = within(await screen.findByRole("region", { name: "How it got here" }));
    expect(trail.getAllByRole("link").map((a) => a.textContent)).toEqual(["Rent, October", "Northwind payroll, August"]);
    expect(trail.getByText("Paid in from outside")).toBeTruthy();
    const source = within(screen.getByRole("region", { name: "Source" }));
    expect(source.getByText(/Already linked on-chain with another coin/)).toBeTruthy();
    expect(source.getByRole("link", { name: /0\.02 500 000/ })).toBeTruthy();

    await user.click(source.getByRole("switch", { name: "Knows who I am" }));
    expect(await trail.findByText("Knows who you are")).toBeTruthy();
  });

  it("never offers an address that has been paid, and moves on once it is", async () => {
    await openApp("#/receive");
    const shown = () => screen.getByTestId("receive-address").textContent!;
    const first = shown();
    // The demo history pays receive addresses 0 to 6.
    expect(screen.getByText("m/84h/0h/0h/0/7")).toBeTruthy();

    const pay = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    pay.addInput({ txid: DEMO_TXIDS.kraken, index: 1 });
    pay.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(first)), amount: 10_000n });
    for (const b of backends) b.addToMempool(pay.unsignedTx);
    await waitFor(() => expect(screen.getByText("m/84h/0h/0h/0/8")).toBeTruthy());
    expect(shown()).not.toBe(first);
  });

  it("hands out a fresh address on request, still inside the watched window, and remembers it", async () => {
    const user = await openApp("#/receive");
    expect(screen.getByText("m/84h/0h/0h/0/7")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use a new address" }));
    expect(screen.getByText("m/84h/0h/0h/0/8")).toBeTruthy();
    expect(screen.getByText("Unused address")).toBeTruthy();
    location.hash = "#/coins";
    await screen.findByRole("heading", { name: "Coins" });
    location.hash = "#/receive";
    expect(await screen.findByText("m/84h/0h/0h/0/8")).toBeTruthy();
  });

  it("keeps a payment request on its own address and says how much of it is paid", async () => {
    const user = await openApp("#/receive");
    const asked = screen.getByTestId("receive-address").textContent!.replace(/\s/g, "");
    await user.click(screen.getByRole("button", { name: "Label it before you share it" }));
    await user.type(screen.getByLabelText("Label"), "Invoice 7{Enter}");
    await user.type(screen.getByLabelText("Amount to ask for, BTC (optional)"), "0.001");
    await user.click(screen.getByRole("button", { name: "Save as a request" }));
    const request = () => screen.getByRole("button", { name: "Remove request Invoice 7" }).closest("li")!.textContent;
    await screen.findByRole("button", { name: "Remove request Invoice 7" });
    expect(request()).toContain("Waiting");
    expect(screen.getByText("Requested address")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New request" }));
    expect(screen.getByText("m/84h/0h/0h/0/8")).toBeTruthy();

    const pay = (sats: bigint) => {
      const tx = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
      tx.addInput({ txid: DEMO_TXIDS.kraken, index: 1 });
      tx.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(asked)), amount: sats });
      return tx.unsignedTx;
    };
    const first = pay(40_000n);
    for (const b of backends) b.addToMempool(first);
    await waitFor(() => expect(request()).toContain("Partly paid"));
    expect(request()).toContain("not yet confirmed");
    const second = pay(60_000n);
    for (const b of backends) b.addBlock([first, second]);
    await waitFor(() => expect(request()).toContain("Paid"));
    expect(request()).not.toContain("not yet confirmed");
    expect(request()).not.toContain("Partly");

    cleanup();
    await openApp("#/receive");
    expect(await screen.findByRole("button", { name: "Remove request Invoice 7" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove request Invoice 7" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Requests" })).toBeNull());
  });

  it("notifies of a payment in and its first confirmation, once switched on, without amounts", async () => {
    const shown: unknown[][] = [];
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "granted";
        static requestPermission = async () => "granted";
        constructor(...args: unknown[]) {
          shown.push(args);
        }
      },
    );
    const user = await openApp("#/settings");
    await user.click(screen.getByRole("checkbox", { name: "Tell me when a payment arrives and when it confirms" }));
    go("#/receive");
    const to = (await screen.findByTestId("receive-address")).textContent!.replace(/\s/g, "");
    const pay = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    pay.addInput({ txid: DEMO_TXIDS.kraken, index: 1 });
    pay.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(to)), amount: 25_000n });
    for (const b of backends) b.addToMempool(pay.unsignedTx);
    await waitFor(() => expect(shown).toHaveLength(1));
    for (const b of backends) b.addBlock([pay.unsignedTx]);
    await waitFor(() => expect(shown).toHaveLength(2));
    expect(shown).toEqual([
      ["A payment arrived", { tag: pay.id }],
      ["A payment confirmed", { tag: pay.id }],
    ]);
    vi.unstubAllGlobals();
  });

  it("takes a frozen coin out of the spendable balance", async () => {
    const user = await openApp("#/coins");
    expect(spendable()).toContain("0.30 926 773");
    await user.click(screen.getByRole("button", { name: "Freeze 0.06 000 000 BTC" }));
    await waitFor(() => expect(spendable()).toBe("0.24 926 773"));
    expect(screen.getByRole("button", { name: "Unfreeze 0.06 000 000 BTC" })).toBeTruthy();
  });

  it("keeps an edited label after locking and unlocking", async () => {
    const user = await openApp(`#/tx/${DEMO_TXIDS.tom}`);
    await user.click(within(await screen.findByRole("heading", { level: 1, name: /Sold bike to Tom/ })).getByRole("button"));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Bike sale{Enter}");
    expect(await screen.findByRole("button", { name: /^Bike sale, edit label/ })).toBeTruthy();

    cleanup();
    await openApp(`#/tx/${DEMO_TXIDS.tom}`);
    expect(await screen.findByRole("button", { name: /^Bike sale, edit label/ })).toBeTruthy();
  });

  it("exports labels as BIP329 and imports them back", async () => {
    let exported: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => ((exported = blob as Blob), "blob:labels"));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = await openApp("#/settings");
    await user.click(screen.getByRole("button", { name: "Export labels" }));
    const text = await exported!.text();
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toContainEqual({ type: "tx", ref: DEMO_TXIDS.tom, label: "Sold bike to Tom", origin: "wpkh([d34db33f/84'/0'/0'])" });
    expect(lines).toContainEqual(expect.objectContaining({ ref: `${DEMO_TXIDS.dust}:0`, spendable: false }));

    go(`#/tx/${DEMO_TXIDS.tom}`);
    await user.click(within(await screen.findByRole("heading", { level: 1, name: /Sold bike to Tom/ })).getByRole("button"));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Changed{Enter}");
    await screen.findByRole("button", { name: /^Changed, edit label/ });

    go("#/settings");
    await user.upload(await screen.findByLabelText("Import labels"), new File([text], "labels.jsonl"));
    expect(await screen.findByText(`Imported ${lines.length} labels.`)).toBeTruthy();
    go(`#/tx/${DEMO_TXIDS.tom}`);
    expect(await screen.findByRole("heading", { level: 1, name: /^Sold bike to Tom/ })).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe("a wallet with no history", () => {
  it("points a new wallet at Receive", async () => {
    backends = [];
    await destroyVault();
    const vault = await createVault(PASSPHRASE, CHEAP);
    await saveSettings(vault, { server: "wss://node.example.ts.net:50004" });
    await createWallet(vault, { name: "Fresh", descriptor: DEMO_DESCRIPTOR.replace("<0;1>", "<2;3>"), network: "mainnet" });
    vault.lock();
    await openApp();
    expect(await screen.findByRole("heading", { name: "No transactions yet" })).toBeTruthy();
    expect(within(screen.getByRole("heading", { name: "No transactions yet" }).parentElement!).getByRole("link", { name: "Receive" })).toBeTruthy();
  });
});

describe("the connection", () => {
  async function unlockWith(factory: () => FakeBackend) {
    location.hash = "#/home";
    render(<App kdf={CHEAP} factory={factory} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    return user;
  }

  it("is one socket for the header and the wallet, and syncs again by itself when the server comes back", async () => {
    const demo = demoBackend();
    let report: (status: ConnectionStatus) => void = () => {};
    let down = false;
    const factory = vi.fn(() => ({
      ...demo,
      history: (hashes: string[]) => (down ? Promise.reject(new Error("The connection to the server was lost")) : demo.history(hashes)),
      onStatus: (listener: typeof report) => ((report = listener), () => {}),
    }));
    await unlockWith(factory);
    await screen.findByText(/Up to date at block 153.500/, undefined, { timeout: 15_000 });
    expect(factory).toHaveBeenCalledTimes(1);

    down = true;
    act(() => report("retrying"));
    const pay = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    pay.addInput({ txid: DEMO_TXIDS.kraken, index: 1 });
    const address = deriveAddress(parseDescriptor(DEMO_DESCRIPTOR, "mainnet"), "mainnet", 0, 7);
    pay.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(address)), amount: 10_000n });
    demo.addToMempool(pay.unsignedTx);
    await new Promise((resolve) => setTimeout(resolve, 50));
    down = false;
    act(() => report("connected"));

    await waitFor(() => expect(screen.getByRole("region", { name: "Balance" }).textContent).toContain("Spendable now0.30 936 773"));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says why it could not connect and leads to what to do about it", async () => {
    const user = await unlockWith(() => fakeBackend({ failure: "refused" }));
    expect(await screen.findByText(/Not connected to node.example.ts.net:50004. Nothing there accepted the connection/)).toBeTruthy();
    expect(spendable()).toContain("0.30 926 773");
    await user.click(screen.getByRole("link", { name: "What to do" }));
    expect(await screen.findByRole("heading", { name: "Nothing at node.example.ts.net:50004 accepted the connection" })).toBeTruthy();
  });

  it("says when the wallet cannot be opened, and offers a way on", async () => {
    const vault = await unlockVault(PASSPHRASE);
    const [key] = await vault.keys("wallet/");
    await vault.put(key!, { ...(await vault.get<object>(key!)), descriptor: "wpkh(nonsense)" });
    vault.lock();
    await unlockWith(demoBackend);
    expect(await screen.findByText(/This wallet could not be opened/)).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the receive request", () => {
  // https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki (test vectors)
  const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

  it("is the bare address unless an amount or label is asked for", () => {
    expect(bip21(address, null, null)).toBe("BITCOIN:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4");
  });

  it("carries an amount and label that read back the same", () => {
    const uri = bip21(address, 2_030_000_000, "Luke-Jr: bike & lock");
    expect(parseUri(uri)).toEqual({ address: address.toUpperCase(), amount: "20.3", label: "Luke-Jr: bike & lock" });
  });

  it("still gives SeedSigner the address to verify", () => {
    const uri = bip21(address, 300_000, "Invoice: 118");
    // https://github.com/SeedSigner/seedsigner/blob/dev/src/seedsigner/models/decode_qr.py (BitcoinAddressQrDecoder)
    const found = /^((bc1q|tb1q|bcrt1q|bc1p|tb1p|bcrt1p|[123]|[mn])[a-zA-HJ-NP-Z0-9]{25,64})/i.exec(uri.split(":").at(-1)!);
    expect(found?.[1]?.toLowerCase()).toBe(address);
  });
});
