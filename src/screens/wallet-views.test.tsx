import { hex } from "@scure/base";
import { Address, OutScript, Transaction as Tx } from "@scure/btc-signer";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { scriptHash, txidOf } from "../backend/backend";
import type { ConnectionStatus } from "../backend/electrum";
import { fakeBackend, type FakeBackend } from "../backend/fake";
import { demoBackend, DEMO_DESCRIPTOR, DEMO_FOREIGN, DEMO_TXIDS, seedDemoVault } from "../backend/fixture";
import { createWallet, saveSettings } from "../core/wallets";
import { createVault, destroyVault, unlockVault } from "../vault/vault";
import { deriveAddress } from "../wallet/derive";
import { parseDescriptor } from "../wallet/descriptor";
import { NETWORKS } from "../wallet/network";
import { BIP86_XPUB } from "../wallet/vectors";
import { bip21 } from "./Receive";
import { parseUri } from "./send/Recipients";

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const CHEAP = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
let backends: FakeBackend[] = [];
// The fake chain's header time at the demo tip, 153,500.
const DEMO_TIP_TIME = 1_792_100_000_000;

async function openApp(hash = "#/home", backend = demoBackend) {
  location.hash = "#/home";
  render(
    <App
      kdf={CHEAP}
      factory={() => {
        backends.push(backend());
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
const spendable = () => {
  const label = screen.getByText("Spendable now");
  return (label.tagName === "DT" ? label : label.parentElement!).nextElementSibling!.textContent;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DEMO_TIP_TIME + 10 * 60_000);
  backends = [];
  await seedDemoVault(PASSPHRASE, CHEAP, "wss://node.example.ts.net:50004");
});

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await destroyVault();
});

describe("wallet views on the demo history", () => {
  it("saves network-specific explorer links, keeps them after unlocking and turns them off when cleared", async () => {
    const user = await openApp(`#/tx/${DEMO_TXIDS.tom}`);
    expect(screen.queryByRole("link", { name: "View in explorer" })).toBeNull();
    go("#/settings");
    const url = await screen.findByLabelText("Explorer URL");
    const network = screen.getByLabelText("Explorer network");
    const current = (network as HTMLSelectElement).value;
    await user.type(url, "https://explorer.example/bitcoin/");
    await user.click(screen.getByRole("button", { name: "Save explorer" }));
    await screen.findByText("Explorer saved");
    await user.selectOptions(network, current === "mainnet" ? "signet" : "mainnet");
    expect((url as HTMLInputElement).value).toBe("");
    await user.selectOptions(network, current);
    expect((url as HTMLInputElement).value).toBe("https://explorer.example/bitcoin");
    go(`#/tx/${DEMO_TXIDS.tom}`);
    const link = await screen.findByRole("link", { name: "View in explorer" });
    expect(link.getAttribute("href")).toBe(`https://explorer.example/bitcoin/tx/${DEMO_TXIDS.tom}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href")?.startsWith("https://explorer.example/bitcoin/address/"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Lock" }));
    await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    go(`#/tx/${DEMO_TXIDS.tom}`);
    expect((await screen.findByRole("link", { name: "View in explorer" })).getAttribute("href")).toContain(DEMO_TXIDS.tom);
    go("#/settings");
    await user.clear(await screen.findByLabelText("Explorer URL"));
    await user.click(screen.getByRole("button", { name: "Save explorer" }));
    await screen.findByText("Explorer links turned off");
    go(`#/tx/${DEMO_TXIDS.tom}`);
    expect(screen.queryByRole("link", { name: "View in explorer" })).toBeNull();
  });

  it("rejects unsafe explorer URLs without saving them", async () => {
    const user = await openApp("#/settings");
    await user.type(await screen.findByLabelText("Explorer URL"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Save explorer" }));
    expect(await screen.findByText("Enter an http:// or https:// base URL without a login, query or fragment.")).toBeTruthy();
    go(`#/tx/${DEMO_TXIDS.tom}`);
    expect(screen.queryByRole("link", { name: "View in explorer" })).toBeNull();
  });

  it("switches amounts to sats from the balance and back from the send form", async () => {
    const user = await openApp();
    await user.click(within(screen.getByRole("region", { name: "Balance" })).getByRole("button", { name: "sats" }));
    await waitFor(() => expect(spendable()).toBe("30\u202f926\u202f773sats"));
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.type(screen.getByLabelText("At least"), "6000000");
    expect(shownLabels()).toEqual(["Ocean payout, August", "Kraken withdrawal, July"]);
    go("#/send");
    await user.type(await screen.findByLabelText("Amount, sats"), "5000");
    await user.click(screen.getByRole("button", { name: "BTC" }));
    expect(((await screen.findByLabelText("Amount, BTC")) as HTMLInputElement).value).toBe("0.00005");
  });

  it("hides amounts behind the eye button and shows them again", async () => {
    const user = await openApp();
    await user.click(screen.getByRole("button", { name: "Hide amounts" }));
    await waitFor(() => expect(spendable()).toBe("••••••"));
    await user.click(screen.getByRole("button", { name: "Hide amounts" }));
    await waitFor(() => expect(spendable()).toContain("BTC"));
  });

  it("shows what is pending, where the coins came from, the mempool and statistics, beside the history", async () => {
    await openApp();
    expect(screen.getByText("2 payments not yet confirmed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where it came from" })).toBeTruthy();
    expect(screen.getByText("Kraken withdrawals").closest("li")!.textContent).toContain("47%");
    expect(screen.getByRole("link", { name: "All 7 sources" }).getAttribute("href")).toBe("#/coins");
    expect(await screen.findByText(/The mempool is empty/)).toBeTruthy();
    const stats = screen.getByRole("heading", { name: "Statistics" }).closest("section")!.textContent;
    expect(stats).toContain("Fees paid, 2 sends0.00 003 560");
    expect(stats).toContain("Coins held8");
    expect(stats).toMatch(/Oldest coin[5-7] Aug 2026/);
    expect(stats).toContain("To spend every coin at 50 sat/vB0.00 029 300");
    const chart = screen.getByRole("img", { name: /^Balance over time, from / }).querySelector("path")!.getAttribute("d")!;
    for (const x of chart.matchAll(/H([\d.]+)/g)) expect(Number(x[1])).toBeLessThanOrEqual(320);
  });

  it("splits the coins by age, adding up to what they hold", async () => {
    await openApp();
    const age = screen.getByRole("heading", { name: "Coin age" }).closest("section")!;
    const rows = within(age).getAllByRole("listitem").map((li) => li.textContent!);
    const sats = rows.map((r) => Number(r.match(/([\d.\u202f ]+) ·/)![1]!.replace(/[^\d]/g, "")));
    expect(sats.reduce((a, b) => a + b, 0)).toBe(30_948_173);
    expect(rows.map((r) => Number(r.match(/(\d+)%/)![1])).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(98);
  });

  it("reads out the balance at each payment as the chart is stepped through", async () => {
    const user = await openApp();
    const chart = screen.getByRole("img", { name: /^Balance over time, from / });
    const caption = chart.closest("figure")!.querySelector("figcaption")!;
    chart.focus();
    await user.keyboard("{End}");
    expect(caption.textContent).toMatch(/^\d+ \w{3} 2026: 0\.30 948 173/);
    await user.keyboard("{ArrowLeft}");
    expect(caption.textContent).not.toMatch(/: 0\.30 948 173/);
    await user.keyboard("{Home}");
    expect(caption.textContent).toMatch(/^\d+ \w{3} 2026: 0\.15 418 220$/);
    act(() => chart.blur());
    expect(caption.textContent).toMatch(/Now$/);
  });

  it("closes the wallet menu on a click elsewhere or Escape", async () => {
    const user = await openApp();
    const menu = screen.getByText("Add a wallet").closest("details")!;
    await user.click(menu.querySelector("summary")!);
    expect(menu.open).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(menu.open).toBe(false);
    await user.click(menu.querySelector("summary")!);
    await user.keyboard("{Escape}");
    expect(menu.open).toBe(false);
  });

  it("shows the balances and each payment's amount and direction, newest first", async () => {
    const user = await openApp();
    const balance = screen.getByRole("region", { name: "Balance" }).textContent;
    expect(balance).toContain("Spendable nowBTCsats0.30 926 773");
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

    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "payroll");
    expect(screen.getAllByRole("link", { name: /Northwind payroll/ })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Rent, October" })).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Search transactions" }));
    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "0.0083");
    expect(screen.getByRole("link", { name: "Hardware shop, SeedSigner parts" })).toBeTruthy();

    await user.clear(screen.getByRole("searchbox", { name: "Search transactions" }));
    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "withdrawals");
    expect(shownLabels()).toEqual(["Hardware shop, SeedSigner parts"]);
  });

  it("reveals history in batches of 25 after searching and filtering", async () => {
    const backend = demoBackend();
    const address = deriveAddress(parseDescriptor(DEMO_DESCRIPTOR, "mainnet"), "mainnet", 0, 7);
    const script = OutScript.encode(Address(NETWORKS.mainnet).decode(address));
    const changeAddress = deriveAddress(parseDescriptor(DEMO_DESCRIPTOR.replace("<0;1>", "<2;3>"), "mainnet"), "mainnet", 0, 0);
    const changeScript = OutScript.encode(Address(NETWORKS.mainnet).decode(changeAddress));
    let previous = DEMO_TXIDS.kraken;
    for (let i = 0; i < 51; i++) {
      const tx = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
      tx.addInput({ txid: previous, index: 1 });
      tx.addOutput({ script, amount: 10_000n });
      tx.addOutput({ script: changeScript, amount: BigInt(1_000_000 - i * 10_000) });
      previous = tx.id;
      backend.addToMempool(tx.unsignedTx);
    }
    const user = await openApp("#/home", () => backend);
    expect(shownLabels()).toHaveLength(25);
    expect(screen.queryByRole("link", { name: "Kraken withdrawal, July" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(shownLabels()).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(shownLabels()).toHaveLength(61);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "Kraken withdrawal, July");
    expect(shownLabels()).toEqual(["Kraken withdrawal, July"]);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Search transactions" }));
    expect(shownLabels()).toHaveLength(25);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Sent" }));
    expect(shownLabels()).toEqual(["Rent, October", "Hardware shop, SeedSigner parts"]);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shownLabels()).toHaveLength(25);
    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "no matching transaction");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
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

  it("places an unconfirmed transaction in the mempool, and a confirmed one not at all", async () => {
    await openApp(`#/tx/${DEMO_TXIDS.rent}`);
    const facts = () => screen.getByText("Fee rate").closest("dl")!;
    await waitFor(() => expect(within(facts()).getByText("Ahead in the mempool").nextElementSibling!.textContent).toBe("0 MvB"));
    expect(within(facts()).getByText("Expected in").nextElementSibling!.textContent).toBe("about 10 min");
    go(`#/tx/${DEMO_TXIDS.tom}`);
    await waitFor(() => expect(within(facts()).getByText("Status").nextElementSibling!.textContent).not.toBe("Waiting for a block"));
    expect(within(facts()).queryByText("Expected in")).toBeNull();
  });

  it("holds a high-fee child of an unconfirmed payment back to the rate of the two together", async () => {
    await openApp(`#/tx/${DEMO_TXIDS.rent}`);
    const to = deriveAddress(parseDescriptor(DEMO_DESCRIPTOR, "mainnet"), "mainnet", 0, 7);
    const child = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    child.addInput({ txid: DEMO_TXIDS.rent, index: 1 });
    child.addOutput({ script: OutScript.encode(Address(NETWORKS.mainnet).decode(to)), amount: 998_560n });
    for (const b of backends) b.addToMempool(child.unsignedTx);
    const facts = () => screen.getByText("Fee rate").closest("dl")!;
    await screen.findByText("Ahead in the mempool");
    expect(within(facts()).queryByText("Rate with its parents")).toBeNull();
    go(`#/tx/${child.id}`);
    await screen.findByText("Rate with its parents");
    expect(within(facts()).getByText("Rate with its parents").nextElementSibling!.textContent).toMatch(/^\d+(\.\d)? sat\/vB$/);
    expect(within(facts()).getByText("Expected in").nextElementSibling!.textContent).toBe("about 10 min");
  });

  it("labels an output that pays someone else", async () => {
    const user = await openApp(`#/tx/${DEMO_TXIDS.rent}`);
    await user.click(await screen.findByRole("button", { name: "Label this payment" }));
    await user.type(screen.getByLabelText("Label"), "Landlord{Enter}");
    expect(await screen.findByRole("button", { name: /^Landlord, edit label/ })).toBeTruthy();
  });

  it("names an unlabelled transaction in the list after the coin it paid in", async () => {
    const user = await openApp(`#/tx/${DEMO_TXIDS.ocean}`);
    await user.click(await screen.findByRole("button", { name: /^Ocean payout, August, edit label/ }));
    await user.clear(screen.getByLabelText("Label"));
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "Label this transaction" })).toBeTruthy();
    go("#/home");
    expect(await screen.findByRole("link", { name: "Ocean mining payouts" })).toBeTruthy();
  });

  it("labels a transaction from the list", async () => {
    const user = await openApp("#/home");
    await user.click(await screen.findByRole("button", { name: /^Rent, October, edit label/ }));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Rent, November{Enter}");
    expect(await screen.findByRole("link", { name: "Rent, November" })).toBeTruthy();
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

describe("every wallet in the vault", () => {
  // The demo's stranger, who paid and was paid by the demo wallet.
  const SAVINGS = `wpkh(${BIP86_XPUB}/0/*)`;
  const savings = parseDescriptor(SAVINGS, "mainnet");
  const spending = parseDescriptor(DEMO_DESCRIPTOR, "mainnet");
  const script = (address: string) => OutScript.encode(Address(NETWORKS.mainnet).decode(address));
  const hashOf = (descriptor: typeof savings, index: number) => scriptHash(script(deriveAddress(descriptor, "mainnet", 0, index)));
  let asked: string[][];
  let watched: string[];

  const recording = () => {
    const backend = demoBackend();
    const history = backend.history;
    const subscribe = backend.subscribeScriptHashes;
    backend.history = (hashes) => (asked.push(hashes), history(hashes));
    backend.subscribeScriptHashes = (hashes, listener) => (watched.push(...hashes), subscribe(hashes, listener));
    return backend;
  };

  /** Spends the demo wallet's Bisq coin to a Savings address it has not used. */
  const transfer = () => {
    const tx = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    tx.addInput({ txid: DEMO_TXIDS.bisq, index: 0 });
    tx.addOutput({ script: script(deriveAddress(savings, "mainnet", 0, 45)), amount: 5_840_000n });
    for (const b of backends) b.addToMempool(tx.unsignedTx);
    return tx.id;
  };

  const switchTo = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(document.querySelector("header summary")!);
    await user.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  };

  const rowText = (txid: string) => document.querySelector(`a[href="#/tx/${txid}"]`)?.textContent;

  beforeEach(async () => {
    asked = [];
    watched = [];
    const vault = await unlockVault(PASSPHRASE);
    await createWallet(vault, { name: "Savings", descriptor: SAVINGS, network: "mainnet" });
    vault.lock();
  });

  it("syncs the selected wallet first", async () => {
    await openApp("#/home", recording);
    await waitFor(() => expect(asked.flat()).toContain(hashOf(savings, 0)));
    expect(asked[0]).toContain(hashOf(spending, 0));
    expect(asked[0]).not.toContain(hashOf(savings, 0));
  });

  it("keeps a wallet that isn't selected up to date with the mempool", async () => {
    const user = await openApp("#/home", recording);
    await waitFor(() => expect(watched).toContain(hashOf(savings, 45)));
    const before = asked.length;
    const txid = transfer();
    await waitFor(() => expect(asked.slice(before).flat()).toContain(hashOf(savings, 45)));
    await switchTo(user, "Savings");
    await waitFor(() => expect(rowText(txid)).toBe("From Spending"));
  });

  it("doesn't sync again on a switch", async () => {
    const user = await openApp("#/home", recording);
    await waitFor(() => expect(asked.flat()).toContain(hashOf(savings, 0)));
    const before = asked.length;
    await switchTo(user, "Savings");
    await screen.findByText(/Up to date at block 153.500/);
    await switchTo(user, "Spending");
    await screen.findByText(/Up to date at block 153.500/);
    const since = asked.slice(before).flat();
    expect(since).not.toContain(hashOf(savings, 0));
    expect(since).not.toContain(hashOf(spending, 0));
  });

  it("labels a transfer between two wallets on both sides", async () => {
    const user = await openApp("#/home", recording);
    await waitFor(() => expect(watched).toContain(hashOf(savings, 45)));
    const txid = transfer();
    await waitFor(() => expect(rowText(txid)).toBe("To Savings"));
    go(`#/tx/${txid}`);
    expect(await screen.findByRole("heading", { level: 1, name: "To Savings" })).toBeTruthy();
    go("#/home");
    await switchTo(user, "Savings");
    await waitFor(() => expect(rowText(txid)).toBe("From Spending"));
  });

  it("adds a broadcast raw transaction to the wallet it pays, not the selected one", async () => {
    const tx = new Tx({ allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    tx.addInput({ txid: DEMO_FOREIGN.confirmed, index: 1 });
    tx.addOutput({ script: script(deriveAddress(savings, "mainnet", 0, 45)), amount: 37_990_000n });
    const user = await openApp("#/home", () => {
      const backend = recording();
      backend.broadcast = async (raw) => txidOf(raw);
      return backend;
    });
    await waitFor(() => expect(watched).toContain(hashOf(savings, 45)));
    go(`#/broadcast/${hex.encode(tx.unsignedTx)}`);
    await user.click(await screen.findByRole("button", { name: "Broadcast through your server" }));
    await waitFor(() => expect(location.hash).toBe(`#/tx/${tx.id}`));
    go("#/home");
    expect(rowText(tx.id)).toBeUndefined();
    await switchTo(user, "Savings");
    await waitFor(() => expect(rowText(tx.id)).toBeTruthy());
  });

  it("notifies of a payment to a wallet that isn't selected, naming it", async () => {
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
    const user = await openApp("#/settings", recording);
    await user.click(screen.getByRole("checkbox", { name: "Tell me when a payment arrives and when it confirms" }));
    await waitFor(() => expect(watched).toContain(hashOf(savings, 45)));
    const txid = transfer();
    await waitFor(() => expect(shown).toEqual([["A payment arrived in Savings", { tag: txid }]]));
    vi.unstubAllGlobals();
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

  it("warns when the server's newest block is hours old, as when its node has lost its peers", async () => {
    vi.setSystemTime(DEMO_TIP_TIME + 3 * 3_600_000);
    await unlockWith(demoBackend);
    expect(await screen.findByText(/newest block, 153.500, is 3 hours old/, undefined, { timeout: 15_000 })).toBeTruthy();
    expect(screen.queryByText(/Up to date/)).toBeNull();
  });

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

    await waitFor(() => expect(screen.getByRole("region", { name: "Balance" }).textContent).toContain("Spendable nowBTCsats0.30 936 773"));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says why it could not connect and leads to what to do about it", async () => {
    const user = await unlockWith(() => fakeBackend({ failure: "refused" }));
    expect(await screen.findByText(/Not connected to node.example.ts.net:50004. Nothing there accepted the connection/)).toBeTruthy();
    expect(screen.getByText(/Balances are as of the last sync, \d{1,2} \w{3,4} \d{4} at \d\d:\d\d\./)).toBeTruthy();
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
    expect(await screen.findByText(/This wallet couldn't be opened/)).toBeTruthy();
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

describe("optional fiat prices", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  });
  it("waits for consent, shows the chosen currency and stops when disabled", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ USD: { last: 100000 }, EUR: { last: 90000 } })));
    try {
      const user = await openApp();
      expect(fetcher).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Show fiat value" }));
      expect(fetcher).not.toHaveBeenCalled();
      await user.selectOptions(screen.getByLabelText("Price source"), "blockchain");
      await user.click(screen.getByRole("button", { name: "Enable fiat prices" }));
      await within(screen.getByRole("region", { name: "Balance" })).findByText(/USD.*at current rate/);
      expect(fetcher.mock.calls[0]?.[0]).toBe("https://blockchain.info/ticker");
      go("#/settings");
      await screen.findByRole("heading", { name: "Settings", level: 1 });
      await user.click(await screen.findByRole("button", { name: "Fiat price settings" }));
      await user.click(screen.getByRole("button", { name: "Turn off fiat prices" }));
      await waitFor(() => expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true));
      go("#/home");
      await screen.findByRole("button", { name: "Show fiat value" });
    } finally {
      fetcher.mockRestore();
    }
  });
});

describe("fiat price lifecycle", () => {
  it.each(["blockchain", "mempool"] as const)("shows a current-rate fallback in confirmed history rows with %s", async (source) => {
    const vault = await unlockVault(PASSPHRASE);
    await vault.put("settings", { server: "wss://node.example", fiat: { source, currency: "EUR" } });
    vault.lock();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("historical-price")) throw new TypeError("offline");
      return new Response(JSON.stringify(source === "blockchain" ? { EUR: { last: 90000 } } : { EUR: 90000 }));
    });
    try {
      await openApp();
      await within(screen.getByRole("region", { name: "Balance" })).findByText(/EUR.*at current rate/);
      const confirmed = screen.getAllByRole("link").filter(a => a.getAttribute("href")?.startsWith("#/tx/"))
        .map(a => a.closest("li")!).find(li => !li.textContent!.toLowerCase().includes("unconfirmed"))!;
      expect(confirmed).toBeTruthy();
      await waitFor(() => expect(confirmed.textContent).toMatch(/≈ EUR.*at current rate/));
    } finally { fetcher.mockRestore(); }
  });

  it("reads mempool prices, keeps currency local and aborts on lock", async () => {
    const vault = await unlockVault(PASSPHRASE);
    await vault.put("settings", { server: "wss://node.example", fiat: { source: "mempool", currency: "EUR" } });
    vault.lock();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ EUR: 90000, USD: 100000 })));
    try {
      const user = await openApp();
      await within(screen.getByRole("region", { name: "Balance" })).findByText(/EUR.*at current rate/);
      expect(screen.getByRole("heading", { name: "Statistics" }).closest("section")!.textContent).toMatch(/0\.00 003 560≈ EUR\s?3\.20/);
      expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
        "https://mempool.space/api/v1/historical-price?currency=EUR",
        "https://mempool.space/api/v1/prices",
      ]);
      for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      await user.click(screen.getByRole("button", { name: "Lock" }));
      for (const [, init] of fetcher.mock.calls) expect(init?.signal?.aborted).toBe(true);
    } finally { fetcher.mockRestore(); }
  });

  it("keeps the wallet usable when prices are invalid without contacting another provider", async () => {
    const vault = await unlockVault(PASSPHRASE);
    await vault.put("settings", { server: "wss://node.example", fiat: { source: "blockchain", currency: "USD" } });
    vault.lock();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ USD: { last: -1 }, EUR: { last: 90000 } })));
    try {
      await openApp();
      await screen.findByText("Price unavailable. Check the price source in Settings.");
      expect(spendable()).toContain("0.30 926 773");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { fetcher.mockRestore(); }
  });
});
