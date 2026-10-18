import type { Clock, Store } from "../vault/vault";
import {
  descriptorFromExtendedKey,
  parseDescriptor,
  type Descriptor,
  type ScriptType,
} from "../wallet/descriptor";
import type { Network } from "../wallet/network";

export type WalletRecord = {
  id: string;
  name: string;
  /** A descriptor or a bare extended key, as the user entered it. */
  descriptor: string;
  network: Network;
  /** Only needed for a bare `xpub` or `tpub`, whose prefix does not say. */
  scriptType: ScriptType | null;
  createdAt: number;
};

export type NewWallet = Pick<WalletRecord, "name" | "descriptor" | "network"> & {
  scriptType?: ScriptType;
};

export type Settings = { server: string | null };

/** @throws when the text is neither a supported descriptor nor an extended key. */
export function walletDescriptor(
  wallet: Pick<WalletRecord, "descriptor" | "network" | "scriptType">,
): Descriptor {
  const text = wallet.descriptor.trim();
  return text.includes("(")
    ? parseDescriptor(text, wallet.network)
    : descriptorFromExtendedKey(text, wallet.network, wallet.scriptType ?? undefined);
}

export async function createWallet(
  vault: Store,
  wallet: NewWallet,
  now: Clock = Date.now,
): Promise<WalletRecord> {
  const record: WalletRecord = {
    id: crypto.randomUUID(),
    name: wallet.name,
    descriptor: wallet.descriptor,
    network: wallet.network,
    scriptType: wallet.scriptType ?? null,
    createdAt: now(),
  };
  walletDescriptor(record);
  await vault.put(`wallet/${record.id}`, record);
  return record;
}

/** Oldest first. */
export async function listWallets(vault: Store): Promise<WalletRecord[]> {
  const keys = await vault.keys("wallet/");
  const wallets = await Promise.all(keys.map((key) => vault.get<WalletRecord>(key)));
  return wallets.map((w) => w!).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getWallet(vault: Store, id: string): Promise<WalletRecord> {
  const wallet = await vault.get<WalletRecord>(`wallet/${id}`);
  if (!wallet) throw new Error(`No wallet ${id}`);
  return wallet;
}

export async function renameWallet(vault: Store, id: string, name: string): Promise<void> {
  await vault.put(`wallet/${id}`, { ...(await getWallet(vault, id)), name });
}

/** Removes the wallet with its cached chain data, labels, frozen and KYC marks, and unfinished send. */
export async function deleteWallet(vault: Store, id: string): Promise<void> {
  const cache = await vault.keys(`cache/${id}/`);
  await vault.delete(`wallet/${id}`, `labels/${id}`, `frozen/${id}`, `kyc/${id}`, `send/${id}`, ...cache);
}

export async function getSettings(vault: Store): Promise<Settings> {
  return (await vault.get<Settings>("settings")) ?? { server: null };
}

export async function saveSettings(vault: Store, settings: Settings): Promise<void> {
  await vault.put("settings", settings);
}
