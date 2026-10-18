import { argon2id } from "@noble/hashes/argon2.js";
import { hex } from "@scure/base";
import { afterEach, describe, expect, it } from "vitest";
import {
  BadBackup,
  createVault,
  openBackup,
  sealBackup,
  destroyVault,
  idleLock,
  requestPersistence,
  unlockVault,
  vaultExists,
  VaultBusy,
  VaultChanged,
  VaultLocked,
  WrongPassphrase,
  type KdfParams,
} from "./vault";

const CHEAP: KdfParams = { m: 8, t: 1, p: 1 };
const PASSPHRASE = "correct horse battery staple";

afterEach(destroyVault);

const wallets = {
  "wallet/a": {
    name: "Savings",
    descriptor: "wpkh([d34db33f/84h/0h/0h]xpub…/<0;1>/*)",
  },
  "wallet/b": {
    name: "Spending",
    descriptor: "tr([d34db33f/86h/0h/0h]xpub…/<0;1>/*)",
  },
};

async function rawRecords(change: (store: IDBObjectStore) => void) {
  const request = indexedDB.open("vault");
  const db = await new Promise<IDBDatabase>((resolve) => {
    request.onsuccess = () => resolve(request.result);
  });
  const tx = db.transaction("records", "readwrite");
  change(tx.objectStore("records"));
  await new Promise((resolve) => (tx.oncomplete = resolve));
  db.close();
}

describe("vault", () => {
  it("round-trips several wallets through lock and unlock", async () => {
    expect(await vaultExists()).toBe(false);
    const vault = await createVault(PASSPHRASE, CHEAP);
    for (const [key, value] of Object.entries(wallets))
      await vault.put(key, value);
    await vault.put("settings", { server: "ssl://electrum.local:50002" });
    vault.lock();

    await expect(vault.get("wallet/a")).rejects.toThrow(VaultLocked);
    expect(await vaultExists()).toBe(true);

    const reopened = await unlockVault(PASSPHRASE);
    expect(await reopened.keys("wallet/")).toEqual(["wallet/a", "wallet/b"]);
    expect(await reopened.get("wallet/a")).toEqual(wallets["wallet/a"]);
    expect(await reopened.get("wallet/b")).toEqual(wallets["wallet/b"]);
    expect(await reopened.get("settings")).toEqual({
      server: "ssl://electrum.local:50002",
    });
    expect(await reopened.get("wallet/missing")).toBeUndefined();
    reopened.lock();
  });

  it("fails a wrong passphrase the same way whether or not a vault exists", async () => {
    const missing = await unlockVault(PASSPHRASE).catch((e) => e);

    (await createVault(PASSPHRASE, CHEAP)).lock();
    const wrong = await unlockVault("incorrect horse").catch((e) => e);

    expect(missing).toBeInstanceOf(WrongPassphrase);
    expect(wrong).toBeInstanceOf(WrongPassphrase);
    expect(wrong.message).toBe(missing.message);
  });

  it("refuses to create a second vault over the first", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("wallet/a", wallets["wallet/a"]);
    vault.lock();

    await expect(createVault("another", CHEAP)).rejects.toThrow();
    const reopened = await unlockVault(PASSPHRASE);
    expect(await reopened.get("wallet/a")).toEqual(wallets["wallet/a"]);
    reopened.lock();
  });

  it("discards a wallet's cache without touching its descriptor", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("wallet/a", wallets["wallet/a"]);
    await vault.put("cache/a/tip", { height: 900000 });
    await vault.put("cache/a/tx/00ff", { raw: "0200" });

    await vault.delete(...(await vault.keys("cache/a/")));

    expect(await vault.keys()).toEqual(["wallet/a"]);
    expect(await vault.get("wallet/a")).toEqual(wallets["wallet/a"]);
    vault.lock();
  });

  it("keeps the data when the passphrase changes", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("wallet/a", wallets["wallet/a"]);

    await expect(
      vault.changePassphrase("not it", "new passphrase", CHEAP),
    ).rejects.toThrow(WrongPassphrase);
    await vault.changePassphrase(PASSPHRASE, "new passphrase", CHEAP);
    await vault.put("wallet/b", wallets["wallet/b"]);
    vault.lock();

    await expect(unlockVault(PASSPHRASE)).rejects.toThrow(WrongPassphrase);
    const reopened = await unlockVault("new passphrase");
    expect(await reopened.get("wallet/a")).toEqual(wallets["wallet/a"]);
    expect(await reopened.get("wallet/b")).toEqual(wallets["wallet/b"]);
    reopened.lock();
  });

  it("says so when another connection keeps the vault from being deleted", async () => {
    (await createVault(PASSPHRASE, CHEAP)).lock();
    const open = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("vault");
      request.onsuccess = () => resolve(request.result);
    });
    await expect(destroyVault()).rejects.toThrow(VaultBusy);
    open.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await vaultExists()).toBe(false);
  });

  it("stops a stale tab writing after another changed the passphrase", async () => {
    (await createVault(PASSPHRASE, CHEAP)).lock();
    const stale = await unlockVault(PASSPHRASE);
    const current = await unlockVault(PASSPHRASE);
    await current.changePassphrase(PASSPHRASE, "new passphrase", CHEAP);

    await expect(stale.put("wallet/a", wallets["wallet/a"])).rejects.toThrow(
      VaultLocked,
    );
    expect(stale.locked).toBe(true);
    expect(await current.keys()).toEqual([]);
    current.lock();
  });

  it("keeps writes made while the passphrase is changing", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("wallet/a", wallets["wallet/a"]);

    let changing = true;
    const change = vault
      .changePassphrase(PASSPHRASE, "new passphrase", CHEAP)
      .finally(() => (changing = false));
    for (let i = 0; changing; i++) await vault.put(`cache/a/${i}`, i);
    await change;
    vault.lock();

    const reopened = await unlockVault("new passphrase");
    for (const key of await reopened.keys()) await reopened.get(key);
    reopened.lock();
  });

  it("strands no write another tab makes while the passphrase is changing", async () => {
    (await createVault(PASSPHRASE, CHEAP)).lock();
    const other = await unlockVault(PASSPHRASE);
    const vault = await unlockVault(PASSPHRASE);

    let changing = true;
    const changed = vault
      .changePassphrase(PASSPHRASE, "new passphrase", CHEAP)
      .then(
        () => true,
        (error) => {
          expect(error).toBeInstanceOf(VaultChanged);
          return false;
        },
      )
      .finally(() => (changing = false));
    for (let i = 0; changing; i++) {
      await other.put(`cache/a/${i}`, i).catch(() => {});
    }
    other.lock();
    vault.lock();

    const reopened = await unlockVault(
      (await changed) ? "new passphrase" : PASSPHRASE,
    );
    for (const key of await reopened.keys()) await reopened.get(key);
    reopened.lock();
  });

  it("detects a tampered ciphertext", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("wallet/a", wallets["wallet/a"]);
    vault.lock();

    await rawRecords((store) => {
      const request = store.get("wallet/a");
      request.onsuccess = () => {
        const { iv, data } = request.result;
        data[0] ^= 1;
        store.put({ iv, data }, "wallet/a");
      };
    });

    const reopened = await unlockVault(PASSPHRASE);
    await expect(reopened.get("wallet/a")).rejects.toThrow();
    reopened.lock();
  });

  it("detects a ciphertext moved to another name", async () => {
    const vault = await createVault(PASSPHRASE, CHEAP);
    await vault.put("wallet/a", wallets["wallet/a"]);
    vault.lock();

    await rawRecords((store) => {
      const request = store.get("wallet/a");
      request.onsuccess = () => store.put(request.result, "wallet/b");
    });

    const reopened = await unlockVault(PASSPHRASE);
    await expect(reopened.get("wallet/b")).rejects.toThrow();
    reopened.lock();
  });

  it("records when it was last written, by the injected clock", async () => {
    let now = 1_700_000_000_000;
    const vault = await createVault(PASSPHRASE, CHEAP, () => now);
    expect(await vault.writtenAt()).toBeUndefined();

    await vault.put("wallet/a", wallets["wallet/a"]);
    expect(await vault.writtenAt()).toBe(1_700_000_000_000);

    now += 60_000;
    await vault.delete("wallet/a");
    expect(await vault.writtenAt()).toBe(1_700_000_060_000);
    vault.lock();
  });

  it("locks after the idle timeout and not before", async () => {
    let now = 0;
    const vault = await createVault(PASSPHRASE, CHEAP);
    const idle = idleLock(
      5 * 60_000,
      () => now,
      () => vault.lock(),
    );

    now = 4 * 60_000;
    idle.touch();
    now = 8 * 60_000;
    idle.check();
    expect(vault.locked).toBe(false);

    now = 9 * 60_000;
    idle.check();
    expect(vault.locked).toBe(true);
  });

  it("reports when the browser cannot persist storage", async () => {
    expect(await requestPersistence()).toBe("unsupported");
  });
});

describe("backup file", () => {
  it("opens with its passphrase and refuses what it cannot trust", async () => {
    const file = await sealBackup(PASSPHRASE, wallets, CHEAP);
    expect(await openBackup(file, PASSPHRASE)).toEqual(wallets);

    await expect(openBackup(file, "incorrect horse")).rejects.toThrow(WrongPassphrase);
    await expect(openBackup("{}", PASSPHRASE)).rejects.toThrow("This is not a backup file from this app.");
    await expect(openBackup("not json", PASSPHRASE)).rejects.toThrow(BadBackup);

    const parsed = JSON.parse(file);
    await expect(openBackup(JSON.stringify({ ...parsed, salt: "zz" }), PASSPHRASE)).rejects.toThrow(BadBackup);
    await expect(openBackup(JSON.stringify({ ...parsed, kdf: undefined }), PASSPHRASE)).rejects.toThrow(BadBackup);
    const newer = JSON.stringify({ ...parsed, version: 2 });
    await expect(openBackup(newer, PASSPHRASE)).rejects.toThrow(/newer version/);

    const flipped = parsed.data.data.replace(/^./, (c: string) => (c === "0" ? "1" : "0"));
    const tampered = JSON.stringify({ ...parsed, data: { ...parsed.data, data: flipped } });
    await expect(openBackup(tampered, PASSPHRASE)).rejects.toThrow(/changed or damaged/);
  });
});

describe("argon2id", () => {
  it("produces RFC 9106's Argon2id test vector", () => {
    // https://www.rfc-editor.org/rfc/rfc9106.html#section-5.3
    const params: KdfParams = { m: 32, t: 3, p: 4 };
    const tag = argon2id(
      new Uint8Array(32).fill(1),
      new Uint8Array(16).fill(2),
      {
        ...params,
        key: new Uint8Array(8).fill(3),
        personalization: new Uint8Array(12).fill(4),
        dkLen: 32,
      },
    );
    expect(hex.encode(tag)).toBe(
      "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
    );
  });
});
