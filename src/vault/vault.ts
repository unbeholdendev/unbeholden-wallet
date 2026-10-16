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

/** Another tab wrote while the passphrase was changing. Nothing changed; try again. */
export class VaultChanged extends Error {
  constructor() {
    super("The vault changed while the passphrase was being changed");
    this.name = "VaultChanged";
  }
}

type Sealed = { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> };
type Header = { salt: string; kdf: KdfParams; check: Sealed };

const DB = "vault";
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

async function newHeader(passphrase: string, kdf: KdfParams) {
  const salt = hex.encode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(passphrase, salt, kdf);
  const header: Header = { salt, kdf, check: await seal(key, CHECK, null) };
  return { header, key };
}

async function checkPassphrase(passphrase: string, header: Header | undefined) {
  if (!header) throw new WrongPassphrase();
  const key = await deriveKey(passphrase, header.salt, header.kdf);
  try {
    await unseal(key, CHECK, header.check);
  } catch {
    throw new WrongPassphrase();
  }
  return key;
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
  passphrase: string,
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
  return new Vault(db, key, header.salt, now);
}

/** @throws {WrongPassphrase} whether the passphrase is wrong or there is no vault. */
export async function unlockVault(
  passphrase: string,
  now: Clock = Date.now,
): Promise<Vault> {
  const db = await openDb();
  try {
    const header = await readHeader(db);
    const key = await checkPassphrase(passphrase, header);
    return new Vault(db, key, header!.salt, now);
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Deletes every wallet in this browser. Lock open vaults first. */
export async function destroyVault(): Promise<void> {
  await done(indexedDB.deleteDatabase(DB));
}

/** An unlocked vault: JSON documents by name, each encrypted on its own. */
export class Vault {
  #db: IDBDatabase | null;
  #key: CryptoKey;
  #salt: string;
  #now: Clock;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(db: IDBDatabase, key: CryptoKey, salt: string, now: Clock) {
    this.#db = db;
    this.#key = key;
    this.#salt = salt;
    this.#now = now;
  }

  get locked(): boolean {
    return this.#db === null;
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

  /** When anything in the vault was last written, by the injected clock. */
  async writtenAt(): Promise<number | undefined> {
    const db = this.#open();
    return done(
      db.transaction("header").objectStore("header").get("writtenAt"),
    );
  }

  /**
   * Re-encrypts everything under a new salt; `kdf` is how to raise the costs.
   * @throws {VaultChanged} when another tab wrote meanwhile.
   */
  async changePassphrase(
    oldPassphrase: string,
    newPassphrase: string,
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
      this.#salt = header.salt;
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
      if (current.result?.salt !== this.#salt) {
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
