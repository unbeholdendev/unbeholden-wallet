import { Address, OutScript, Transaction as Tx } from "@scure/btc-signer";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { FakeBackend } from "../backend/fake";
import { demoBackend, DEMO_DESCRIPTOR, DEMO_TXIDS, seedDemoVault } from "../backend/fixture";
import { createWallet, saveSettings } from "../core/wallets";
import { createVault, destroyVault } from "../vault/vault";
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
    expect(balance).toContain("Spendable now0.30 626 773");
    expect(balance).toContain("+0.00 300 000 waiting to confirm");
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
  });

  it("details a transaction and offers to speed up an unconfirmed payment", async () => {
    await openApp(`#/tx/${DEMO_TXIDS.rent}`);
    expect(await screen.findByText("1 440 sats")).toBeTruthy();
    expect(screen.getByText("Your change")).toBeTruthy();
    expect(screen.getByText("m/84h/0h/0h/1/1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Speed up" }));
    expect(location.hash).toBe(`#/bump/${DEMO_TXIDS.rent}`);
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

  it("takes a frozen coin out of the spendable balance", async () => {
    const user = await openApp("#/coins");
    expect(spendable()).toBe("0.30 626 773");
    await user.click(screen.getByRole("button", { name: "Freeze 0.06 000 000 BTC" }));
    await waitFor(() => expect(spendable()).toBe("0.24 626 773"));
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
