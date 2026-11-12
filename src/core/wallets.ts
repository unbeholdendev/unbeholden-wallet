import type { Clock, Store } from "../vault/vault";
import {
  type Descriptor,
  descriptorFromExtendedKey,
  formatDescriptor,
  parseDescriptor,
  type ScriptType,
} from "../wallet/descriptor";
import type { Network } from "../wallet/network";
import type { FiatSettings, History } from "./prices";
import type { SavedSend } from "./send";
import type { Cache } from "./view";

export type WalletRecord = {
  id: string;
  name: string;
  /** A descriptor or a bare extended key, as the user entered it. */
  descriptor: string;
  network: Network;
  /** Only needed for a bare `xpub` or `tpub`, whose prefix does not say. */
  scriptType: ScriptType | null;
  createdAt: number;
  group?: { id: string; name: string };
};

export type NewWallet = Pick<WalletRecord, "name" | "descriptor" | "network"> & {
  scriptType?: ScriptType;
  accountOf?: string;
};

export type Unit = "btc" | "sats";

export type Settings = {
  server: string | null;
  idleMinutes?: number;
  walletId?: string;
  notify?: boolean;
  skipForeignUnconfirmed?: boolean;
  fiat?: FiatSettings | null;
  unit?: Unit;
  hide?: boolean;
  explorers?: Partial<Record<Network, string>>;
};

/** A saved recipient. The vault keeps one address book for all its wallets. */
export type Contact = { address: string; name: string };

/** Its label is the address's label. */
export type PaymentRequest = { address: string; sats: number | null };

declare const stored: unique symbol;
/** A vault record's name, carrying the type of what is kept under it. */
export type Key<T> = string & { readonly [stored]: T };

const key = <T>(name: string) => name as Key<T>;
const perWallet = <T>(prefix: string) => Object.assign((id: string) => key<T>(prefix + id), { prefix });

/** Every record the app keeps in the vault. Existing vaults and backups depend on these names. */
export const vaultKey = {
  settings: key<Settings>("settings"),
  book: key<Contact[]>("book"),
  wallet: perWallet<WalletRecord>("wallet/"),
  labels: perWallet<Record<string, string>>("labels/"),
  frozen: perWallet<string[]>("frozen/"),
  kyc: perWallet<string[]>("kyc/"),
  requests: perWallet<PaymentRequest[]>("requests/"),
  send: perWallet<SavedSend>("send/"),
  cache: (id: string) => ({
    prefix: `cache/${id}/`,
    state: key<Cache>(`cache/${id}/state`),
    txs: key<Record<string, string>>(`cache/${id}/txs`),
  }),
  prices: Object.assign((source: string, currency: string) => key<History>(`prices/${source}/${currency}`), {
    prefix: "prices/",
  }),
};

export const readRecord = <T>(vault: Store, name: Key<T>) => vault.get<T>(name);
export const writeRecord = <T>(vault: Store, name: Key<T>, value: T) => vault.put(name, value);

/** @throws when the text is neither a supported descriptor nor an extended key. */
export function walletDescriptor(wallet: Pick<WalletRecord, "descriptor" | "network" | "scriptType">): Descriptor {
  const text = wallet.descriptor.trim();
  return text.includes("(")
    ? parseDescriptor(text, wallet.network)
    : descriptorFromExtendedKey(text, wallet.network, wallet.scriptType ?? undefined);
}

export async function createWallet(vault: Store, wallet: NewWallet, now: Clock = Date.now): Promise<WalletRecord> {
  const newest = (await listWallets(vault)).at(-1)?.createdAt ?? -Infinity;
  const record: WalletRecord = {
    id: crypto.randomUUID(),
    name: wallet.name,
    descriptor: wallet.descriptor,
    network: wallet.network,
    scriptType: wallet.scriptType ?? null,
    // Two wallets made in the same millisecond would otherwise list in random id order.
    createdAt: Math.max(now(), newest + 1),
  };
  walletDescriptor(record);
  if (wallet.accountOf) {
    const parent = await getWallet(vault, wallet.accountOf);
    if (parent.network !== record.network) throw new Error("Accounts in a wallet must use the same network");
    const group = parent.group ?? { id: crypto.randomUUID(), name: parent.name };
    record.group = group;
    await writeRecord(vault, vaultKey.wallet(parent.id), { ...parent, group });
  }
  await writeRecord(vault, vaultKey.wallet(record.id), record);
  return record;
}

/** Oldest first. */
export async function listWallets(vault: Store): Promise<WalletRecord[]> {
  const keys = await vault.keys(vaultKey.wallet.prefix);
  const wallets = await Promise.all(keys.map((key) => vault.get<WalletRecord>(key)));
  return wallets.map((w) => w!).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getWallet(vault: Store, id: string): Promise<WalletRecord> {
  const wallet = await readRecord(vault, vaultKey.wallet(id));
  if (!wallet) throw new Error(`No wallet ${id}`);
  return wallet;
}

export async function renameWallet(vault: Store, id: string, name: string): Promise<void> {
  await writeRecord(vault, vaultKey.wallet(id), { ...(await getWallet(vault, id)), name });
}

export async function renameWalletGroup(vault: Store, accountId: string, name: string): Promise<void> {
  const account = await getWallet(vault, accountId);
  if (!account.group) return renameWallet(vault, accountId, name);
  for (const wallet of await listWallets(vault))
    if (wallet.group?.id === account.group.id)
      await writeRecord(vault, vaultKey.wallet(wallet.id), { ...wallet, group: { ...wallet.group, name } });
}

/** Removes the wallet with its cached chain data, labels, frozen and KYC marks, unfinished send and payment requests. */
export async function deleteWallet(vault: Store, id: string): Promise<void> {
  const cache = await vault.keys(vaultKey.cache(id).prefix);
  await vault.delete(
    vaultKey.wallet(id),
    vaultKey.labels(id),
    vaultKey.frozen(id),
    vaultKey.kyc(id),
    vaultKey.send(id),
    vaultKey.requests(id),
    ...cache,
  );
}

/** What `mergeBackup` reads: no cached chain data, no unfinished send. */
export async function backupRecords(vault: Store): Promise<Record<string, unknown>> {
  const kinds = [vaultKey.wallet, vaultKey.labels, vaultKey.frozen, vaultKey.kyc, vaultKey.requests];
  const keys = (await vault.keys()).filter(
    (key) => key === vaultKey.settings || key === vaultKey.book || kinds.some((kind) => key.startsWith(kind.prefix)),
  );
  return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await vault.get(key)])));
}

export type Merged = { added: string[]; skipped: string[]; labels: number; kept: number };

/**
 * Adds the backup's wallets not already here, by descriptor and network. Of
 * labels, adds those for things with none here and keeps the rest; frozen and
 * KYC marks and payment requests add up; saved recipients are added by
 * address, never renamed; a setting is taken only where none is set.
 */
export async function mergeBackup(vault: Store, records: Record<string, unknown>): Promise<Merged> {
  const same = (w: WalletRecord) => `${w.network} ${formatDescriptor(walletDescriptor(w))}`;
  const existing = await listWallets(vault);
  const here = new Map(existing.map((w) => [same(w), w.id]));
  const merged: Merged = { added: [], skipped: [], labels: 0, kept: 0 };
  const groups = new Map<string, { id: string; name: string }>();
  const backedUp = <T>(name: Key<T>) => records[name] as T | undefined;
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith(vaultKey.wallet.prefix)) continue;
    const incoming = value as WalletRecord;
    const local = existing.find((w) => same(w) === same(incoming));
    if (incoming.group && local?.group && !groups.has(`${incoming.network} ${incoming.group.id}`))
      groups.set(`${incoming.network} ${incoming.group.id}`, local.group);
  }
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith(vaultKey.wallet.prefix)) continue;
    const wallet = value as WalletRecord;
    const from = key.slice(vaultKey.wallet.prefix.length);
    let to = here.get(same(wallet));
    if (to) merged.skipped.push(wallet.name);
    else {
      to = crypto.randomUUID();
      let group = wallet.group && groups.get(`${wallet.network} ${wallet.group.id}`);
      if (wallet.group && !group) {
        group = { id: crypto.randomUUID(), name: wallet.group.name };
        groups.set(`${wallet.network} ${wallet.group.id}`, group);
      }
      await writeRecord(vault, vaultKey.wallet(to), { ...wallet, id: to, group });
      here.set(same(wallet), to);
      merged.added.push(wallet.name);
    }
    const labels = (await readRecord(vault, vaultKey.labels(to))) ?? {};
    for (const [ref, label] of Object.entries(backedUp(vaultKey.labels(from)) ?? {})) {
      if (labels[ref] === undefined) {
        labels[ref] = label;
        merged.labels++;
      } else if (labels[ref] !== label) merged.kept++;
    }
    await writeRecord(vault, vaultKey.labels(to), labels);
    for (const marks of [vaultKey.frozen, vaultKey.kyc]) {
      const union = new Set([...((await readRecord(vault, marks(to))) ?? []), ...(backedUp(marks(from)) ?? [])]);
      await writeRecord(vault, marks(to), [...union]);
    }
    const requests = (await readRecord(vault, vaultKey.requests(to))) ?? [];
    const have = new Set(requests.map((r) => r.address));
    const theirs = (backedUp(vaultKey.requests(from)) ?? []).filter((r) => !have.has(r.address));
    await writeRecord(vault, vaultKey.requests(to), [...requests, ...theirs]);
  }
  const book = (await readRecord(vault, vaultKey.book)) ?? [];
  for (const c of backedUp(vaultKey.book) ?? []) if (!book.some((b) => b.address === c.address)) book.push(c);
  await writeRecord(vault, vaultKey.book, book);
  const settings: Record<string, unknown> = { ...(await getSettings(vault)) };
  for (const [key, value] of Object.entries(backedUp(vaultKey.settings) ?? {}))
    if (settings[key] == null && key !== "walletId" && key !== "fiat") settings[key] = value;
  await writeRecord(vault, vaultKey.settings, settings as Settings);
  return merged;
}

export async function getSettings(vault: Store): Promise<Settings> {
  return (await readRecord(vault, vaultKey.settings)) ?? { server: null };
}

export async function saveSettings(vault: Store, settings: Settings): Promise<void> {
  await writeRecord(vault, vaultKey.settings, settings);
}
