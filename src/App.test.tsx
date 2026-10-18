import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import type { ConnectionFailure } from "./backend/backend";
import { fakeBackend } from "./backend/fake";
import { hex } from "@scure/base";
import { createWallet, listWallets, walletDescriptor } from "./core/wallets";
import { createVault, destroyVault, unlockVault, vaultExists, type KdfParams } from "./vault/vault";
import { formatDescriptor } from "./wallet/descriptor";
import { asVersion, BIP84_ZPUB, BIP86_XPUB, VERSION } from "./wallet/vectors";

// The whole suite runs in parallel, and an unlock can take more than the default second.
configure({ asyncUtilTimeout: 5000 });

const CHEAP: KdfParams = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
const SERVER = "wss://node.example.ts.net:50004";

// Regtest's CreateGenesisBlock(1296688602, 2, 0x207fffff, 1, ...) and its merkle root:
// https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp
const REGTEST_GENESIS = (() => {
  const bytes = new Uint8Array(80);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  bytes.set(hex.decode("4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b").reverse(), 36);
  view.setUint32(68, 1296688602, true);
  view.setUint32(72, 0x207fffff, true);
  view.setUint32(76, 2, true);
  return bytes;
})();

function renderApp(failure: ConnectionFailure | null = null) {
  render(<App kdf={CHEAP} factory={() => fakeBackend({ failure })} />);
  return userEvent.setup();
}

async function existingVault(settings: object) {
  const vault = await createVault(PASSPHRASE, CHEAP);
  await vault.put("settings", settings);
  vault.lock();
}

async function unlock(user: ReturnType<typeof userEvent.setup>, passphrase = PASSPHRASE) {
  await user.type(await screen.findByLabelText("Passphrase"), passphrase);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
}

beforeEach(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
  location.hash = "";
});

afterEach(async () => {
  cleanup();
  await destroyVault();
});

describe("onboarding", () => {
  it("holds server and wallet in memory, shows the balance, and writes nothing until the passphrase", async () => {
    const user = renderApp();
    await user.type(await screen.findByLabelText("Electrum server address"), SERVER);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(await screen.findByLabelText("Descriptor or extended public key"));
    await user.paste(BIP84_ZPUB);
    expect(screen.queryByRole("group", { name: "Network" })).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).placeholder).toBe("Wallet 1");
    await user.click(screen.getByRole("button", { name: /Continue to backup/ }));
    await user.click(screen.getByRole("button", { name: "Finish without a backup" }));

    expect(await screen.findByRole("heading", { name: "Protect this wallet" })).toBeTruthy();
    expect(await screen.findByText(/transactions? found/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Balance" }).textContent).toMatch(/Wallet 1/);
    expect(await vaultExists()).toBe(false);

    const create = screen.getByRole("button", { name: "Protect this wallet" });
    await user.type(screen.getByLabelText("Passphrase"), "short");
    await user.click(create);
    expect(screen.getByText("Use at least 10 characters.")).toBeTruthy();

    await user.clear(screen.getByLabelText("Passphrase"));
    await user.type(screen.getByLabelText("Passphrase"), PASSPHRASE);
    await user.type(screen.getByLabelText("Type it again"), "correct horse battery stable");
    await user.click(create);
    expect(screen.getByText("The two passphrases are different.")).toBeTruthy();

    await user.clear(screen.getByLabelText("Type it again"));
    await user.type(screen.getByLabelText("Type it again"), PASSPHRASE);
    await user.click(create);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy();

    const vault = await unlockVault(PASSPHRASE);
    const [wallet] = await listWallets(vault);
    const settings = await vault.get("settings");
    vault.lock();
    expect(wallet).toMatchObject({ name: "Wallet 1", network: "mainnet" });
    expect(settings).toEqual({ server: SERVER });
  }, 30_000);

  it("takes the network from the key and the server's genesis block, and warns when they disagree", async () => {
    render(<App kdf={CHEAP} factory={() => ({ ...fakeBackend(), blockHeaders: async () => [REGTEST_GENESIS] })} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Electrum server address"), SERVER);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(await screen.findByLabelText("Descriptor or extended public key"));
    await user.paste(BIP84_ZPUB);
    expect(await screen.findByText(/This is a mainnet key, but your server is on regtest/)).toBeTruthy();

    await user.clear(screen.getByLabelText("Descriptor or extended public key"));
    await user.paste(asVersion(BIP84_ZPUB, VERSION.vpub));
    expect(screen.queryByText(/your server is on/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Continue to backup/ }));
    await user.click(screen.getByRole("button", { name: "Finish without a backup" }));
    await user.type(await screen.findByLabelText("Passphrase"), PASSPHRASE);
    await user.type(screen.getByLabelText("Type it again"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Protect this wallet" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy();

    const vault = await unlockVault(PASSPHRASE);
    const [wallet] = await listWallets(vault);
    vault.lock();
    expect(wallet!.network).toBe("regtest");
  }, 30_000);

  it("unlocks with the right passphrase and refuses a wrong one", async () => {
    await existingVault({ server: null });
    const user = renderApp();
    await unlock(user, "incorrect horse battery staple");
    expect(await screen.findByText(/That passphrase does not open this vault/)).toBeTruthy();

    await user.clear(screen.getByLabelText("Passphrase"));
    await unlock(user);
    expect(await screen.findByRole("heading", { name: "Connect to your Electrum server" })).toBeTruthy();
  });

  const guidance: [ConnectionFailure, RegExp][] = [
    ["certificate-rejected", /The browser rejected this server's certificate/],
    ["refused", /Nothing at node\.example\.ts\.net:50004 accepted the connection/],
    ["timeout", /node\.example\.ts\.net:50004 did not answer within 10 seconds/],
    ["not-electrum", /Something answered, but it is not an Electrum server/],
    ["mixed-content", /This page cannot open a plain ws:\/\/ connection/],
  ];

  it.each(guidance)("explains a %s failure in its own words", async (failure, title) => {
    await existingVault({ server: SERVER });
    const user = renderApp(failure);
    await unlock(user);
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    for (const [other, otherTitle] of guidance)
      if (other !== failure) expect(screen.queryByRole("heading", { name: otherTitle })).toBeNull();
    if (failure === "certificate-rejected" || failure === "refused")
      expect(screen.getByRole("link", { name: /Open it/ }).getAttribute("href")).toBe("https://node.example.ts.net:50004/");
  });

  it("shows the descriptor a zpub implies and presses for the backup", async () => {
    await existingVault({ server: SERVER });
    const user = renderApp();
    await unlock(user);

    await user.click(await screen.findByLabelText("Descriptor or extended public key"));
    await user.paste(BIP84_ZPUB);
    const descriptor = screen.getByText(/^wpkh\(xpub/).textContent!;
    expect(descriptor).toMatch(/^wpkh\(xpub\w+\/<0;1>\/\*\)#[a-z0-9]{8}$/);
    expect(screen.queryByRole("group", { name: "Script type" })).toBeNull();

    await user.type(screen.getByLabelText("Name"), "Spending");
    await user.click(screen.getByRole("button", { name: /Continue to backup/ }));
    expect(screen.getByText(descriptor)).toBeTruthy();
    expect(screen.getByText(/You have not copied or downloaded it yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(descriptor);
    expect(screen.queryByText(/You have not copied or downloaded it yet/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy();
    const vault = await unlockVault(PASSPHRASE);
    const [wallet] = await listWallets(vault);
    vault.lock();
    expect(wallet).toMatchObject({ name: "Spending", network: "mainnet" });
    expect(formatDescriptor(walletDescriptor(wallet!))).toBe(descriptor);
  });

  it("asks a bare xpub for its script type", async () => {
    await existingVault({ server: SERVER });
    const user = renderApp();
    await unlock(user);
    await user.click(await screen.findByLabelText("Descriptor or extended public key"));
    await user.paste(BIP86_XPUB);
    expect(screen.queryByText(/^tr\(xpub/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Taproot, tr" }));
    expect(screen.getByText(/^tr\(xpub/)).toBeTruthy();
  });
});

describe("settings", () => {
  it("renames a wallet, and removes one only once confirmed", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("settings", { server: SERVER });
    await createWallet(vault, { name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" });
    await createWallet(vault, { name: "Savings", descriptor: BIP86_XPUB, network: "mainnet", scriptType: "tr" });
    vault.lock();
    location.hash = "#/settings";
    const user = renderApp();
    await unlock(user);

    await user.click(await screen.findByRole("button", { name: "Rename Spending" }));
    await user.clear(screen.getByLabelText("New name for Spending"));
    await user.type(screen.getByLabelText("New name for Spending"), "Daily");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Rename Daily" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove Savings" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    await user.click(screen.getByRole("button", { name: "Remove Savings" }));
    await user.click(screen.getByRole("button", { name: "Remove the wallet" }));
    expect(await screen.findByText("1 in this vault")).toBeTruthy();

    const reopened = await unlockVault(PASSPHRASE);
    const wallets = await listWallets(reopened);
    reopened.lock();
    expect(wallets.map((w) => w.name)).toEqual(["Daily"]);
  }, 30_000);
});
