import { act, cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { ConnectionFailure } from "./backend/backend";
import { fakeBackend } from "./backend/fake";
import { hex } from "@scure/base";
import { backupRecords, createWallet, listWallets, walletDescriptor } from "./core/wallets";
import { createVault, destroyVault, memoryStore, openBackup, sealBackup, unlockVault, Vault, vaultExists, type KdfParams } from "./vault/vault";
import { formatDescriptor } from "./wallet/descriptor";
import { asVersion, BIP84_ZPUB, BIP86_XPUB, VERSION } from "./wallet/vectors";
import { UrDecoder, UrEncoder } from "./transport/ur";

const camera = vi.hoisted(() => ({ scan: null as ((text: string) => void) | null }));
vi.mock("./ui/QrScanner", () => ({
  QrScanner: ({ onResult }: { onResult: (text: string) => void }) => {
    camera.scan = onResult;
    return null;
  },
}));

// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-010-output-desc.md
const PKH_OUTPUT = "ur:crypto-output/taadmutaadeyoyaxhdclaoswaalbmwfpwekijndyfefzjtmdrtketphhktmngrlkwsfnospypsasrhhhjonnvwtsqzwljy";
// https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-015-account.md
const CRYPTO_ACCOUNT = "ur:crypto-account/oeadcyemrewytyaolttaadeetaadmutaaddloxaxhdclaxwmfmdeiamecsdsemgtvsjzcncygrkowtrontzschgezokstswkkscfmklrtauteyaahdcxiehfonurdppfyntapejpproypegrdawkgmaewejlsfdtsrfybdehcaflmtrlbdhpamtaaddyoeadlncsdwykaeykaeykaocyemrewytyaycynlytsnyltaadeetaadmhtaadmwtaaddloxaxhdclaostvelfemdyynwydwyaievosrgmambklovabdgypdglldvespsthysadamhpmjeinaahdcxntdllnaaeykoytdacygegwhgjsiyonpywmcmrpwphsvodsrerozsbyaxluzcoxdpamtaaddyoeadlncsehykaeykaeykaocyemrewytyaycypdbskeuytaadeetaadmwtaaddloxaxhdclaxzcfxeegdrpmogrgwkbzctlttweadkiengrwlhtprremouoluutqdpfbncedkynfhaahdcxjpwevdeogthttkmeswzcolcpsaahcfnshkhtehytclmnteatmoteadtlwynnftloamtaaddyoeadlncsghykaeykaeykaocyemrewytyaycybthlvytstaadeetaadmhtaadnytaaddloxaxhdclaxhhsnhdrpftdwuocntilydibehnecmovdfekpjkclcslasbhkpawsaddmcmmnahnyaahdcxlotedtndfymyltclhlmtpfsadscnhtztaolbnnkistaedegwfmmedreetnwmcycnamtaaddyoeadlfcsdpykaocyemrewytyaycyemrewytytaadeetaadmhtaadmetaadnytaaddloxaxhdclaxdwkswmztpytnswtsecnblfbayajkdldeclqzzolrsnhljedsgminetytbnahatbyaahdcxkkguwsvyimjkvwteytwztyswvendtpmncpasfrrylprnhtkblndrgrmkoyjtbkrpamtaaddyoeadlocsdyykaeykaeykadykaocyemrewytyaycyhkrpnddrtaadeetaadmetaadnytaaddloxaxhdclaohnhffmvsbndslrfgclpfjejyatbdpebacnzokotofxntaoemvskpaowmryfnotfgaahdcxdlnbvecentssfsssgylnhkrstoytecrdlyadrekirfaybglahltalsrfcaeerobwamtaaddyoeadlocsdyykaeykaeykaoykaocyemrewytyaycyhkrpnddrtaadeetaadnltaaddloxaxhdclaorkrhkeytwsoykorletwstbwycagtbsotmeptjkesgwrfcmveskvdmngujzttgtdpaahdcxgrfgmuvyylmwcxjtttechplslgoegagaptdniatidmhdmebdwfryfsnsdkcplyvaamtaaddyoeadlncshfykaeykaeykaocyemrewytyaycytostatbngmdavolk";

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
    await user.type(await screen.findByLabelText("Server address"), SERVER);
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
    const put = vi.spyOn(Vault.prototype, "put").mockRejectedValueOnce(new Error("The disk is full"));
    await user.click(create);
    expect(await screen.findByText("The disk is full")).toBeTruthy();
    expect(await vaultExists()).toBe(false);
    put.mockRestore();
    await user.click(create);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy();

    const vault = await unlockVault(PASSPHRASE);
    const [wallet] = await listWallets(vault);
    const settings = await vault.get("settings");
    vault.lock();
    expect(wallet).toMatchObject({ name: "Wallet 1", network: "mainnet" });
    expect(settings).toEqual({ server: SERVER, walletId: wallet!.id });
  }, 30_000);

  it("takes the network from the key and the server's genesis block, and warns when they disagree", async () => {
    render(<App kdf={CHEAP} factory={() => ({ ...fakeBackend(), blockHeaders: async () => [REGTEST_GENESIS] })} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Server address"), SERVER);
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
    expect(await screen.findByRole("heading", { name: "Connect to your server" })).toBeTruthy();
  });

  const guidance: [ConnectionFailure, RegExp][] = [
    ["certificate-rejected", /The browser rejected this server's certificate/],
    ["refused", /Nothing at node\.example\.ts\.net:50004 accepted the connection/],
    ["timeout", /node\.example\.ts\.net:50004 did not answer within 10 seconds/],
    ["not-electrum", /Something answered, but it is not an Electrum server/],
    ["mixed-content", /This page cannot open a plain ws:\/\/ or http:\/\/ connection/],
    ["not-esplora", /Something answered, but it is not an Esplora API/],
    ["cors", /Your server answered, but did not let this app read it/],
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

  it("shows a multisig's k of n and each key's fingerprint", async () => {
    await existingVault({ server: SERVER });
    const user = renderApp();
    await unlock(user);
    await user.click(await screen.findByLabelText("Descriptor or extended public key"));
    await user.paste(`wsh(sortedmulti(2,[d34db33f/48h/0h/0h/2h]${asVersion(BIP84_ZPUB, VERSION.xpub)},${BIP86_XPUB},[0badc0de/48h/0h/0h/2h]${BIP86_XPUB}/<2;3>/*))`);
    expect(screen.getByText("2 of 3 multisig: spending needs 2 of these keys to sign.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["d34db33f", "no fingerprint", "0badc0de"]);
    expect(screen.getByLabelText("Name").getAttribute("placeholder")).toBe("2-of-3 multisig");
  });
});

describe("scanning a descriptor", () => {
  it("collects an account in animated parts and asks which script type", async () => {
    await existingVault({ server: SERVER });
    const user = renderApp();
    await unlock(user);
    await user.click(await screen.findByRole("button", { name: "Scan a QR code" }));

    const decoder = new UrDecoder();
    decoder.receive(CRYPTO_ACCOUNT);
    const encoder = new UrEncoder(decoder.result!, 200);
    const parts = Array.from({ length: encoder.seqLen }, () => encoder.nextPart().toUpperCase());
    act(() => camera.scan!(parts[1]!));
    expect(screen.getByText(`1 of ${parts.length} parts captured. Keep the code in view while it loops.`)).toBeTruthy();
    act(() => parts.forEach((part) => camera.scan!(part)));

    await user.click(screen.getByRole("button", { name: "Taproot, tr" }));
    expect(screen.getByText(/^tr\(\[37b5eed4\/86h\/0h\/0h\]xpub\w+\/<0;1>\/\*\)#/)).toBeTruthy();
    expect(screen.getByLabelText("Name").getAttribute("placeholder")).toBe("37b5eed4");
  });

  it("refuses a script type the wallet does not support", async () => {
    await existingVault({ server: SERVER });
    const user = renderApp();
    await unlock(user);
    await user.click(await screen.findByRole("button", { name: "Scan a QR code" }));
    act(() => camera.scan!(PKH_OUTPUT));
    expect(await screen.findByText("This wallet supports only wpkh, tr and wsh multisig descriptors.")).toBeTruthy();
  });
});

describe("settings", () => {
  it("opens the wallet last used", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("settings", { server: SERVER });
    await createWallet(vault, { name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" });
    const savings = await createWallet(vault, { name: "Savings", descriptor: BIP86_XPUB, network: "mainnet", scriptType: "tr" });
    vault.lock();
    location.hash = "#/settings";
    let user = renderApp();
    await unlock(user);
    const summary = () => waitFor(() => document.querySelector("header summary") ?? Promise.reject(new Error("No wallet switcher")));
    expect((await summary()).textContent).toMatch(/^Spending/);

    await user.click(await summary());
    await user.click(screen.getByRole("button", { name: /^Savings/ }));
    await waitFor(async () => {
      const reopened = await unlockVault(PASSPHRASE);
      const settings = await reopened.get<{ walletId?: string }>("settings");
      reopened.lock();
      expect(settings?.walletId).toBe(savings.id);
    });

    cleanup();
    user = renderApp();
    await unlock(user);
    expect((await summary()).textContent).toMatch(/^Savings/);
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export labels" }).disabled).toBe(false));
  }, 30_000);

  it("shows a wallet's descriptor to copy, download or scan", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("settings", { server: SERVER });
    const wallet = await createWallet(vault, { name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" });
    vault.lock();
    location.hash = "#/settings";
    const user = renderApp();
    await unlock(user);

    await user.click(await screen.findByRole("button", { name: "Descriptor of Spending" }));
    const descriptor = formatDescriptor(walletDescriptor(wallet));
    expect(screen.getByText(descriptor)).toBeTruthy();
    expect(screen.getByRole("img", { name: "QR code of the descriptor of Spending" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download as a text file" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(descriptor);
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export labels", hidden: true }).disabled).toBe(false));
  }, 30_000);

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

describe("backup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("carries wallets, labels and settings to a new browser, without the cached history", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("settings", { server: SERVER, idleMinutes: 5 });
    const wallet = await createWallet(vault, { name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" });
    await vault.put(`labels/${wallet.id}`, { "tx:aa": "Rent" });
    await vault.put(`frozen/${wallet.id}`, ["aa:0"]);
    await vault.put(`requests/${wallet.id}`, [{ address: "bc1qaddress", sats: 1000 }]);
    await vault.put(`cache/${wallet.id}/old`, { tip: 1 });
    await vault.put("book", [{ address: "address A", name: "Landlord" }]);
    vault.lock();
    let file: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => ((file = blob as Blob), "blob:backup"));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    location.hash = "#/settings";
    let user = renderApp();
    await unlock(user);

    await user.type(await screen.findByLabelText("Vault passphrase, to confirm"), "incorrect horse");
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(await screen.findByText("That is not the vault passphrase.")).toBeTruthy();
    expect(file).toBeUndefined();
    await user.clear(screen.getByLabelText("Vault passphrase, to confirm"));
    await user.type(screen.getByLabelText("Vault passphrase, to confirm"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    await waitFor(() => expect(file).toBeDefined());
    const text = await file!.text();
    expect(text).not.toContain("Rent");
    const kept = ["book", `frozen/${wallet.id}`, `labels/${wallet.id}`, `requests/${wallet.id}`, "settings", `wallet/${wallet.id}`];
    expect(Object.keys(await openBackup(text, PASSPHRASE)).sort()).toEqual(kept.sort());

    cleanup();
    await destroyVault();
    location.hash = "";
    user = renderApp();
    await user.upload(await screen.findByLabelText("Choose backup file"), new File([text], "wallet-backup.json"));
    await user.type(screen.getByLabelText("Passphrase of the backup"), "incorrect horse");
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("The passphrase is not right for this backup.")).toBeTruthy();
    await user.clear(screen.getByLabelText("Passphrase of the backup"));
    await user.type(screen.getByLabelText("Passphrase of the backup"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(document.querySelector("header summary")?.textContent).toMatch(/^Spending/));

    const restored = await unlockVault(PASSPHRASE);
    const [copy] = await listWallets(restored);
    expect(copy).toMatchObject({ name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" });
    expect(await restored.get(`labels/${copy!.id}`)).toEqual({ "tx:aa": "Rent" });
    expect(await restored.get(`frozen/${copy!.id}`)).toEqual(["aa:0"]);
    expect(await restored.get(`requests/${copy!.id}`)).toEqual([{ address: "bc1qaddress", sats: 1000 }]);
    expect(await restored.get("book")).toEqual([{ address: "address A", name: "Landlord" }]);
    expect(await restored.get("settings")).toMatchObject({ server: SERVER, idleMinutes: 5 });
    restored.lock();
  }, 30_000);

  it("adds to the vault in Settings, replaces nothing, and refuses a changed file", async () => {
    const other = memoryStore();
    const spending = await createWallet(other, { name: "Spending", descriptor: BIP84_ZPUB, network: "mainnet" });
    await other.put(`labels/${spending.id}`, { "tx:aa": "From the backup", "tx:bb": "Coffee" });
    await createWallet(other, { name: "Savings", descriptor: BIP86_XPUB, network: "mainnet", scriptType: "tr" });
    await other.put("settings", { server: "wss://other.example:50004" });
    await other.put("book", [{ address: "address A", name: "From the backup" }, { address: "address B", name: "Plumber" }]);
    const backup = await sealBackup("another passphrase", await backupRecords(other), CHEAP);

    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("settings", { server: SERVER });
    const daily = await createWallet(vault, { name: "Daily", descriptor: BIP84_ZPUB, network: "mainnet" });
    await vault.put(`labels/${daily.id}`, { "tx:aa": "Rent" });
    await vault.put("book", [{ address: "address A", name: "Landlord" }]);
    vault.lock();
    location.hash = "#/settings";
    const user = renderApp();
    await unlock(user);

    const parsed = JSON.parse(backup);
    const flipped = parsed.data.data.replace(/.$/, (c: string) => (c === "0" ? "1" : "0"));
    const tampered = JSON.stringify({ ...parsed, data: { ...parsed.data, data: flipped } });
    await user.upload(await screen.findByLabelText("Choose backup file"), new File([tampered], "wallet-backup.json"));
    await user.type(screen.getByLabelText("Passphrase of the backup"), "another passphrase");
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText(/This backup has been changed or damaged since it was made/)).toBeTruthy();

    await user.upload(screen.getByLabelText("wallet-backup.json"), new File([backup], "wallet-backup.json"));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(
      await screen.findByText(
        "Added Savings. Already here, so skipped: Spending. 1 label added. 1 label differed from the backup; kept the ones here.",
        {},
        { timeout: 15_000 },
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 in this vault")).toBeTruthy();
    expect(await screen.findByText("2 saved")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Export labels" }).disabled).toBe(false));

    const reopened = await unlockVault(PASSPHRASE);
    expect((await listWallets(reopened)).map((w) => w.name).sort()).toEqual(["Daily", "Savings"]);
    expect(await reopened.get(`labels/${daily.id}`)).toEqual({ "tx:aa": "Rent", "tx:bb": "Coffee" });
    expect(await reopened.get("settings")).toMatchObject({ server: SERVER });
    expect(await reopened.get("book")).toEqual([{ address: "address A", name: "Landlord" }, { address: "address B", name: "Plumber" }]);
    reopened.lock();
  }, 30_000);
});
