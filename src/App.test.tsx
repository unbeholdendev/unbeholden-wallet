import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import type { ConnectionFailure } from "./backend/backend";
import { fakeBackend } from "./backend/fake";
import { listWallets, walletDescriptor } from "./core/wallets";
import { createVault, destroyVault, unlockVault, type KdfParams } from "./vault/vault";
import { formatDescriptor } from "./wallet/descriptor";
import { BIP84_ZPUB, BIP86_XPUB } from "./wallet/vectors";

// The whole suite runs in parallel, and an unlock can take more than the default second.
configure({ asyncUtilTimeout: 5000 });

const CHEAP: KdfParams = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";
const SERVER = "wss://node.example.ts.net:50004";

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
  location.hash = "";
});

afterEach(async () => {
  cleanup();
  await destroyVault();
});

describe("onboarding", () => {
  it("creates a vault on first run and moves on to the server", async () => {
    const user = renderApp();
    const create = await screen.findByRole("button", { name: "Create vault" });
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
    expect(await screen.findByRole("heading", { name: "Connect to your Electrum server" })).toBeTruthy();
    (await unlockVault(PASSPHRASE)).lock();
  });

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

  it("shows the descriptor a zpub implies and will not finish before the backup", async () => {
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
    const finish = screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement;
    const saved = screen.getByRole("checkbox") as HTMLInputElement;
    expect(finish.disabled).toBe(true);
    expect(saved.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(descriptor);
    expect(finish.disabled).toBe(true);
    await user.click(saved);
    await user.click(finish);

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
