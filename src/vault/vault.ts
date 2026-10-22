import { argon2idAsync } from "@noble/hashes/argon2.js";
import { hex } from "@scure/base";

/** Argon2id costs: memory in KiB, passes, lanes. */
export type KdfParams = { m: number; t: number; p: number };

// First of OWASP's equivalent Argon2id minimums:
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id
export const DEFAULT_KDF: KdfParams = { m: 47104, t: 1, p: 1 };

export type Clock = () => number;

/** Thrown alike for a wrong passphrase and for no vault, so it reveals neither. */
export class WrongPassphrase extends Error {
  constructor() {
    super("Wrong passphrase");
    this.name = "WrongPassphrase";
  }
}

export class VaultLocked extends Error {
  constructor() {
    super("The vault is locked");
    this.name = "VaultLocked";
  }
}

export class VaultBusy extends Error {
  constructor() {
    super("Another tab has the vault open");
    this.name = "VaultBusy";
  }
}

/** Another tab wrote while the passphrase was changing. Nothing changed; try again. */
export class VaultChanged extends Error {
  constructor() {
    super("The vault changed while the passphrase was being changed");
    this.name = "VaultChanged";
  }
}

/** A backup file that is not one, is from a newer version, or was changed. */
export class BadBackup extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadBackup";
  }
}

type Sealed = { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> };
// Without a passphrase, `key` is a random non-extractable key kept in place of `kdf`.
type Header = { salt: string; kdf?: KdfParams; key?: CryptoKey; check: Sealed };

let DB = "vault";

/** For the demo page, which shares the app's origin on the dev server. */
export function setVaultDatabase(name: string): void {
  DB = name;
}

const CHECK = "";

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

async function openDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("header");
    request.result.createObjectStore("records");
  };
  const db = await done(request);
  db.onversionchange = () => db.close();
  return db;
}

async function readHeader(db: IDBDatabase): Promise<Header | undefined> {
  return done(db.transaction("header").objectStore("header").get("kdf"));
}

async function deriveKey(passphrase: string, salt: string, kdf: KdfParams) {
  const bytes = await argon2idAsync(passphrase, hex.decode(salt), {
    ...kdf,
    dkLen: 32,
  });
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// The record's name is the additional data, so a ciphertext moved to another name fails.
async function seal(key: CryptoKey, name: string, plain: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
    key,
    new TextEncoder().encode(JSON.stringify(plain)),
  );
  return { iv, data: new Uint8Array(data) };
}

async function unseal(key: CryptoKey, name: string, sealed: Sealed) {
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: sealed.iv,
      additionalData: new TextEncoder().encode(name),
    },
    key,
    sealed.data,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function newHeader(passphrase: string | null, kdf: KdfParams) {
  const salt = hex.encode(crypto.getRandomValues(new Uint8Array(16)));
  const key =
    passphrase === null
      ? await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
      : await deriveKey(passphrase, salt, kdf);
  const header: Header = { salt, ...(passphrase === null ? { key } : { kdf }), check: await seal(key, CHECK, null) };
  return { header, key };
}

/** `null` is the passphrase of a vault without one. */
async function checkPassphrase(passphrase: string | null, header: Header | undefined) {
  if (!header || (passphrase === null) !== !!header.key) throw new WrongPassphrase();
  const key = header.key ?? (await deriveKey(passphrase!, header.salt, header.kdf!));
  try {
    await unseal(key, CHECK, header.check);
  } catch {
    throw new WrongPassphrase();
  }
  return key;
}

/**
 * Backup file, the one place its format is written down. UTF-8 JSON:
 *
 *     { "format": "unbeholden-wallet backup", "version": 1,
 *       "salt": hex, "kdf": { m, t, p }, "check": box, "data": box }
 *
 * A box is `{ "iv": hex, "data": hex }`: AES-GCM under the Argon2id key of the
 * passphrase, as in the vault header. `check` seals `null` with additional
 * data "", so a wrong passphrase is told apart from a changed file. `data`
 * seals `{ "records": { name: value } }` with additional data "backup/1", as
 * the vault stores them: `settings`, `wallet/<id>`, `labels/<id>`,
 * `frozen/<id>` and `kyc/<id>`. A reader refuses a version above its own.
 */
const BACKUP = { format: "unbeholden-wallet backup", version: 1 } as const;
const BACKUP_DATA = `backup/${BACKUP.version}`;

const boxText = (box: Sealed) => ({ iv: hex.encode(box.iv), data: hex.encode(box.data) });
const boxBytes = (box: { iv: string; data: string }) =>
  ({ iv: hex.decode(box.iv), data: hex.decode(box.data) }) as Sealed;

export async function sealBackup(
  passphrase: string,
  records: Record<string, unknown>,
  kdf = DEFAULT_KDF,
): Promise<string> {
  const { header, key } = await newHeader(passphrase, kdf);
  const data = await seal(key, BACKUP_DATA, { records });
  return JSON.stringify({ ...BACKUP, salt: header.salt, kdf, check: boxText(header.check), data: boxText(data) });
}

/** @throws {WrongPassphrase} or {BadBackup} */
export async function openBackup(text: string, passphrase: string): Promise<Record<string, unknown>> {
  const notOne = new BadBackup("This isn't a backup file from this app.");
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw notOne;
  }
  if (file?.format !== BACKUP.format) throw notOne;
  if (file.version > BACKUP.version)
    throw new BadBackup("This backup is from a newer version of the app. Update the app and try again.");
  let header: Header;
  let data: Sealed;
  try {
    hex.decode(file.salt);
    const { m, t, p } = file.kdf;
    if (![m, t, p].every((n) => Number.isInteger(n) && n > 0)) throw new Error();
    header = { salt: file.salt, kdf: { m, t, p }, check: boxBytes(file.check) };
    data = boxBytes(file.data);
  } catch {
    throw notOne;
  }
  const key = await checkPassphrase(passphrase, header);
  try {
    return (await unseal(key, BACKUP_DATA, data)).records;
  } catch {
    throw new BadBackup("This backup has been changed or damaged since it was made, so it can't be read.");
  }
}

export async function vaultExists(): Promise<boolean> {
  const db = await openDb();
  try {
    return (await readHeader(db)) !== undefined;
  } finally {
    db.close();
  }
}

export async function createVault(
  passphrase: string | null,
  kdf = DEFAULT_KDF,
  now: Clock = Date.now,
): Promise<Vault> {
  const { header, key } = await newHeader(passphrase, kdf);
  const db = await openDb();
  const tx = db.transaction("header", "readwrite");
  tx.objectStore("header").add(header, "kdf");
  try {
    await committed(tx);
  } catch (error) {
    db.close();
    if ((error as DOMException).name !== "ConstraintError") throw error;
    throw new Error("A vault already exists in this browser");
  }
  return new Vault(db, key, header, now);
}

/** @throws {WrongPassphrase} whether the passphrase is wrong or there is no vault. */
export async function unlockVault(
  passphrase: string | null,
  now: Clock = Date.now,
): Promise<Vault> {
  const db = await openDb();
  try {
    const header = await readHeader(db);
    const key = await checkPassphrase(passphrase, header);
    return new Vault(db, key, header!, now);
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Deletes every wallet in this browser. Lock open vaults first. Rejects with
 * `VaultBusy` while another tab holds the vault open; the deletion then
 * finishes by itself once that tab closes.
 */
export async function destroyVault(): Promise<void> {
  const request = indexedDB.deleteDatabase(DB);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new VaultBusy());
  });
}

/** An unlocked vault: JSON documents by name, each encrypted on its own. */
export class Vault {
  #db: IDBDatabase | null;
  #key: CryptoKey;
  #header: Header;
  #now: Clock;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(db: IDBDatabase, key: CryptoKey, header: Header, now: Clock) {
    this.#db = db;
    this.#key = key;
    this.#header = header;
    this.#now = now;
  }

  get locked(): boolean {
    return this.#db === null;
  }

  /** False when a stored key seals it instead. */
  get hasPassphrase(): boolean {
    return !this.#header.key;
  }

  lock(): void {
    this.#db?.close();
    this.#db = null;
  }

  #open(): IDBDatabase {
    if (!this.#db) throw new VaultLocked();
    return this.#db;
  }

  async get<T>(name: string): Promise<T | undefined> {
    const db = this.#open();
    const sealed: Sealed | undefined = await done(
      db.transaction("records").objectStore("records").get(name),
    );
    return sealed && unseal(this.#key, name, sealed);
  }

  async put(name: string, value: unknown): Promise<void> {
    this.#open();
    await this.#serial(async () =>
      this.#write([[name, await seal(this.#key, name, value)]]),
    );
  }

  async delete(...names: string[]): Promise<void> {
    await this.#serial(() => this.#write(names.map((name) => [name, null])));
  }

  async keys(prefix = ""): Promise<string[]> {
    const db = this.#open();
    const keys = await done(
      db.transaction("records").objectStore("records").getAllKeys(),
    );
    return (keys as string[]).filter((key) => key.startsWith(prefix));
  }

  /** @throws {WrongPassphrase} */
  async verify(passphrase: string): Promise<void> {
    await checkPassphrase(passphrase, await readHeader(this.#open()));
  }

  /** When anything in the vault was last written, by the injected clock. */
  async writtenAt(): Promise<number | undefined> {
    const db = this.#open();
    return done(
      db.transaction("header").objectStore("header").get("writtenAt"),
    );
  }

  /**
   * Re-encrypts everything under a new salt, in one transaction; `null` means
   * no passphrase, and `kdf` is how to raise the costs.
   * @throws {VaultChanged} when another tab wrote meanwhile.
   */
  async changePassphrase(
    oldPassphrase: string | null,
    newPassphrase: string | null,
    kdf = DEFAULT_KDF,
  ): Promise<void> {
    await checkPassphrase(oldPassphrase, await readHeader(this.#open()));
    const { header, key } = await newHeader(newPassphrase, kdf);
    await this.#serial(async () => {
      const tx = this.#open().transaction(["header", "records"]);
      const [writes, names, sealed] = await Promise.all([
        done(tx.objectStore("header").get("writes")),
        done(tx.objectStore("records").getAllKeys()),
        done(tx.objectStore("records").getAll()),
      ]);
      const resealed = await Promise.all(
        sealed.map(async (s, i): Promise<[string, Sealed]> => {
          const name = names[i] as string;
          return [
            name,
            await seal(key, name, await unseal(this.#key, name, s)),
          ];
        }),
      );
      await this.#write(resealed, { header, writes });
      this.#key = key;
      this.#header = header;
    });
  }

  // Writes from this tab queue here, so none can land between the snapshot
  // and the header swap of a passphrase change.
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => {});
    return run;
  }

  // Refuses on a moved salt (another tab changed the passphrase) and, for a
  // rekey, on any write since its snapshot: both would strand records.
  async #write(
    records: [string, Sealed | null][],
    rekey?: { header: Header; writes: number | undefined },
  ) {
    const tx = this.#open().transaction(["header", "records"], "readwrite");
    const headers = tx.objectStore("header");
    const store = tx.objectStore("records");
    const current = headers.get("kdf");
    const writes = headers.get("writes");
    let refusal: Error | undefined;
    writes.onsuccess = () => {
      if (current.result?.salt !== this.#header.salt) {
        this.lock();
        refusal = new VaultLocked();
        return tx.abort();
      }
      if (rekey && writes.result !== rekey.writes) {
        refusal = new VaultChanged();
        return tx.abort();
      }
      for (const [name, sealed] of records) {
        if (sealed) store.put(sealed, name);
        else store.delete(name);
      }
      if (rekey) headers.put(rekey.header, "kdf");
      headers.put((writes.result ?? 0) + 1, "writes");
      headers.put(this.#now(), "writtenAt");
    };
    await committed(tx).catch((error) => {
      throw refusal ?? error;
    });
  }
}

/** What the wallet code reads and writes: the vault, or a draft held in memory. */
export type Store = Pick<Vault, "get" | "put" | "delete" | "keys">;

/** Records kept only in this tab, for a wallet set up before the vault exists. */
export function memoryStore(): Store {
  const records = new Map<string, string>();
  return {
    get: async (name) => {
      const json = records.get(name);
      return json === undefined ? undefined : JSON.parse(json);
    },
    put: async (name, value) => void records.set(name, JSON.stringify(value)),
    delete: async (...names) => names.forEach((name) => records.delete(name)),
    keys: async (prefix = "") => [...records.keys()].filter((key) => key.startsWith(prefix)),
  };
}

/**
 * Locks after `timeoutMs` without `touch()`. The caller calls `check()` on a
 * timer; measuring by the clock keeps it right after the tab sleeps.
 */
export function idleLock(timeoutMs: number, now: Clock, lock: () => void) {
  let last = now();
  return {
    touch: () => {
      last = now();
    },
    check: () => {
      if (now() - last >= timeoutMs) lock();
    },
  };
}

export async function requestPersistence(): Promise<
  "persisted" | "denied" | "unsupported"
> {
  if (!navigator.storage?.persist) return "unsupported";
  return (await navigator.storage.persist()) ? "persisted" : "denied";
}
