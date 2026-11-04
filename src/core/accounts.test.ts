import { expect, it } from "vitest";
import { memoryStore } from "../vault/vault";
import { formatDescriptor } from "../wallet/descriptor";
import { asVersion, VERSION, BIP84_ZPUB, BIP86_XPUB } from "../wallet/vectors";
import { walletDescriptor, backupRecords, mergeBackup, createWallet, listWallets, renameWalletGroup, renameWallet, deleteWallet } from "./wallets";

it("adds an explicitly imported account without changing the original account boundary", async () => {
  const vault = memoryStore();
  const first = await createWallet(vault, { name: "Savings", descriptor: BIP84_ZPUB, network: "mainnet" });
  const second = await createWallet(vault, { name: "Daily", descriptor: BIP86_XPUB, scriptType: "tr", network: "mainnet", accountOf: first.id });
  const accounts = await listWallets(vault);
  expect(accounts.map((w) => w.id)).toEqual([first.id, second.id]);
  expect(accounts[0]!.group).toEqual(accounts[1]!.group);
  expect(accounts[0]!.group?.name).toBe("Savings");
  await renameWalletGroup(vault, first.id, "Signer");
  expect((await listWallets(vault)).map((w) => w.group?.name)).toEqual(["Signer", "Signer"]);
  await deleteWallet(vault, first.id);
  expect((await listWallets(vault))[0]).toMatchObject({ id: second.id, name: "Daily", group: { name: "Signer" } });
});

it("restores a new sibling beside a deduplicated account and preserves local names and membership", async () => {
  const source = memoryStore();
  const parent = await createWallet(source, { name: "Old", descriptor: BIP84_ZPUB, network: "mainnet" });
  await createWallet(source, { name: "Sibling", descriptor: BIP86_XPUB, scriptType: "tr", network: "mainnet", accountOf: parent.id });
  const target = memoryStore();
  const existing = await createWallet(target, { name: "Local", descriptor: BIP84_ZPUB, network: "mainnet" });
  await createWallet(target, { name: "Local sibling", descriptor: BIP86_XPUB, scriptType: "wpkh", network: "mainnet", accountOf: existing.id });
  const before = await listWallets(target);
  const backup = await backupRecords(source);
  await mergeBackup(target, backup);
  const after = await listWallets(target);
  expect(after.filter((w) => before.some((b) => b.id === w.id))).toEqual(before);
  expect(after.find((w) => w.name === "Sibling")).toMatchObject({ name: "Sibling", group: before[0]!.group });
  expect(after.find((w) => w.name === "Sibling")!.group!.id).not.toBe((await listWallets(source))[0]!.group!.id);
  await mergeBackup(target, backup);
  expect(await listWallets(target)).toEqual(after);
});

it("remaps colliding group IDs without joining unrelated local accounts", async () => {
  const vault = memoryStore();
  const local = await createWallet(vault, { name: "Local", descriptor: BIP84_ZPUB, network: "mainnet" });
  await createWallet(vault, { name: "Local sibling", descriptor: BIP86_XPUB, scriptType: "wpkh", network: "mainnet", accountOf: local.id });
  const group = (await listWallets(vault))[0]!.group!;
  const incoming = { ...local, id: "backup-account", name: "Imported", descriptor: BIP86_XPUB, scriptType: "tr" as const, group };
  await mergeBackup(vault, { "wallet/backup-account": incoming });
  const imported = (await listWallets(vault)).find((w) => w.name === "Imported")!;
  expect(imported.group!.id).not.toBe(group.id);
  expect((await listWallets(vault)).find((w) => w.id === local.id)!.group).toEqual(group);
});

it("keeps an ungrouped duplicate unchanged and restores its sibling once", async () => {
  const source = memoryStore();
  const parent = await createWallet(source, { name: "Signer", descriptor: BIP84_ZPUB, network: "mainnet" });
  await createWallet(source, { name: "Daily", descriptor: BIP86_XPUB, scriptType: "tr", network: "mainnet", accountOf: parent.id });
  const target = memoryStore();
  const local = await createWallet(target, { name: "Existing", descriptor: BIP84_ZPUB, network: "mainnet" });
  const backup = await backupRecords(source);
  await mergeBackup(target, backup);
  await mergeBackup(target, backup);
  const restored = await listWallets(target);
  expect(restored).toHaveLength(2);
  expect(restored.find((w) => w.id === local.id)).toEqual(local);
  expect(restored.find((w) => w.name === "Daily")!.group?.name).toBe("Signer");
});

it("keeps account names independent from wallet names", async () => {
  const vault = memoryStore();
  const first = await createWallet(vault, { name: "Signer", descriptor: BIP84_ZPUB, network: "mainnet" });
  const second = await createWallet(vault, { name: "Daily", descriptor: BIP86_XPUB, scriptType: "tr", network: "mainnet", accountOf: first.id });
  await renameWallet(vault, second.id, "Spending");
  expect((await listWallets(vault)).map((w) => [w.name, w.group?.name])).toEqual([["Signer", "Signer"], ["Spending", "Signer"]]);
});

it("deduplicates canonical descriptors within a network and keeps other networks separate", async () => {
  const source = memoryStore();
  const account = await createWallet(source, { name: "Original", descriptor: asVersion(BIP84_ZPUB, VERSION.vpub), network: "signet" });
  const backup = await backupRecords(source);
  const canonical = formatDescriptor(walletDescriptor(account));
  const merged = await mergeBackup(source, {
    ...backup,
    "wallet/canonical": { ...account, id: "canonical", descriptor: canonical },
    "wallet/other-network": { ...account, id: "other-network", network: "regtest" },
  });
  expect(merged.added).toHaveLength(1);
  expect(await listWallets(source)).toHaveLength(2);
});

it("keeps restored wallet groups separate across networks", async () => {
  const vault = memoryStore();
  const source = memoryStore();
  const account = await createWallet(source, { name: "Signet", descriptor: asVersion(BIP84_ZPUB, VERSION.vpub), network: "signet" });
  const group = { id: "shared", name: "Signer" };
  await mergeBackup(vault, {
    "wallet/signet": { ...account, group },
    "wallet/regtest": { ...account, id: "regtest", name: "Regtest", network: "regtest", group },
  });
  const accounts = await listWallets(vault);
  expect(accounts).toHaveLength(2);
  expect(accounts[0]!.group!.id).not.toBe(accounts[1]!.group!.id);
  await createWallet(vault, { name: "Sibling", descriptor: asVersion(BIP86_XPUB, VERSION.tpub), scriptType: "tr", network: "regtest", accountOf: accounts[1]!.id });
  expect((await listWallets(vault))[2]!.group).toEqual(accounts[1]!.group);
});
