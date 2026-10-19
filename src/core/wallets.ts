import type { Clock, Store } from "../vault/vault";
import {
  descriptorFromExtendedKey,
  formatDescriptor,
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

/** Removes the wallet with its cached chain data, labels, frozen and KYC marks, unfinished send and payment requests. */
export async function deleteWallet(vault: Store, id: string): Promise<void> {
  const cache = await vault.keys(`cache/${id}/`);
  await vault.delete(`wallet/${id}`, `labels/${id}`, `frozen/${id}`, `kyc/${id}`, `send/${id}`, `requests/${id}`, ...cache);
}

/** What `mergeBackup` reads: no cached chain data, no unfinished send. */
export async function backupRecords(vault: Store): Promise<Record<string, unknown>> {
  const keys = (await vault.keys()).filter((key) => key === "settings" || /^(wallet|labels|frozen|kyc|requests)\//.test(key));
  return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await vault.get(key)])));
}

export type Merged = { added: string[]; skipped: string[]; labels: number; kept: number };

/**
 * Adds the backup's wallets not already here, by descriptor and network. Of
 * labels, adds those for things with none here and keeps the rest; frozen and
 * KYC marks and payment requests add up; a setting is taken only where none is set.
 */
export async function mergeBackup(vault: Store, records: Record<string, unknown>): Promise<Merged> {
  const same = (w: WalletRecord) => `${w.network} ${formatDescriptor(walletDescriptor(w))}`;
  const here = new Map((await listWallets(vault)).map((w) => [same(w), w.id]));
  const merged: Merged = { added: [], skipped: [], labels: 0, kept: 0 };
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith("wallet/")) continue;
    const wallet = value as WalletRecord;
    const from = key.slice("wallet/".length);
    let to = here.get(same(wallet));
    if (to) merged.skipped.push(wallet.name);
    else {
      to = crypto.randomUUID();
      await vault.put(`wallet/${to}`, { ...wallet, id: to });
      here.set(same(wallet), to);
      merged.added.push(wallet.name);
    }
    const labels = (await vault.get<Record<string, string>>(`labels/${to}`)) ?? {};
    for (const [ref, label] of Object.entries((records[`labels/${from}`] ?? {}) as Record<string, string>)) {
      if (labels[ref] === undefined) {
        labels[ref] = label;
        merged.labels++;
      } else if (labels[ref] !== label) merged.kept++;
    }
    await vault.put(`labels/${to}`, labels);
    for (const marks of ["frozen", "kyc"]) {
      const union = new Set([...((await vault.get<string[]>(`${marks}/${to}`)) ?? []), ...((records[`${marks}/${from}`] ?? []) as string[])]);
      await vault.put(`${marks}/${to}`, [...union]);
    }
    const requests = (await vault.get<{ address: string }[]>(`requests/${to}`)) ?? [];
    const have = new Set(requests.map((r) => r.address));
    const theirs = ((records[`requests/${from}`] ?? []) as { address: string }[]).filter((r) => !have.has(r.address));
    await vault.put(`requests/${to}`, [...requests, ...theirs]);
  }
  const settings: Record<string, unknown> = { ...(await getSettings(vault)) };
  for (const [key, value] of Object.entries((records.settings ?? {}) as Record<string, unknown>))
    if (settings[key] == null && key !== "walletId") settings[key] = value;
  await vault.put("settings", settings);
  return merged;
}

export async function getSettings(vault: Store): Promise<Settings> {
  return (await vault.get<Settings>("settings")) ?? { server: null };
}

export async function saveSettings(vault: Store, settings: Settings): Promise<void> {
  await vault.put("settings", settings);
}
