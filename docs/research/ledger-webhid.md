# Ledger signing over WebHID (issue #90)

Research, 2026-11-06. Nothing here is built. Sizes and greps are from scratch installs in
`/tmp/ledger-research`, outside the repo. "Unverified" marks what I could not check.

Abbreviations used below:

- **ABN** is app-bitcoin-new, the Ledger Bitcoin app, at commit
  [`f8f790a`](https://github.com/LedgerHQ/app-bitcoin-new/tree/f8f790a325ba772dcce8eb8f9441ebf5289020d0)
  (master, app version 2.5.1 per its
  [Makefile](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/Makefile#L29-L31)).
  The GitHub API now redirects this repo to `LedgerHQ/app-bitcoin`.
- **DMK** is the Device Management Kit.

## Summary

- Both Ledger libraries work, but each pulls in `bitcoinjs-lib` plus a `buffer` polyfill. A
  minimal connect/xpub/sign bundle is 174–210 KiB gzipped. The app's whole
  `@scure/btc-signer` is 45 KiB.
- The DMK bundle carries `https://manager.api.live.ledger.com/api` and a Ledger
  scriptrunner `wss://` URL. Our `connect-src … http: https: ws: wss:` would **not** block
  them, so the CSP does not protect us here. Only code review does.
- The protocol is documented, stable since app 2.1.0 (Nov 2022), and designed for an
  untrusted host. A hand-written client on `@scure/btc-signer` is about 1,000–1,300 lines.
  It adds no runtime dependencies.
- **Recommendation: hand-write the client.** Use `@ledgerhq/ledger-bitcoin` only as a
  devDependency, as a differential-test oracle.
- Doing this reverses `docs/spec-v1.md:284-285`, which lists WebHID hardware wallets as out of
  scope. The maintainer has to agree to that first.

## 1. Libraries

| | DMK Bitcoin signer | `@ledgerhq/ledger-bitcoin` + `hw-transport-webhid` | Hand-written |
|---|---|---|---|
| Packages | `@ledgerhq/device-signer-kit-bitcoin@1.3.3`, `device-management-kit@1.11.0`, `device-transport-kit-web-hid@1.2.4` | `@ledgerhq/ledger-bitcoin@0.3.1`, `@ledgerhq/hw-transport-webhid@6.36.0` | none |
| Source | [device-sdk-ts tag signer 1.3.3](https://github.com/LedgerHQ/device-sdk-ts/tree/%40ledgerhq/device-signer-kit-bitcoin%401.3.3) | [ABN `jsclient-0.3.1`](https://github.com/LedgerHQ/app-bitcoin-new/tree/f750c800740114127d974bfa1b544f80e58fa96a/bitcoin_client_js), [ledger-live `hw-transport-webhid@6.36.0`](https://github.com/LedgerHQ/ledger-live/tree/%40ledgerhq/hw-transport-webhid%406.36.0) | [ABN `doc/bitcoin.md`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/bitcoin.md) |
| Status | Ledger's supported path | Client: maintained in ABN. Transport: frozen | ours |
| Stable releases (npm `time`) | signer: 10 since 1.0.0 (2025-01-27), last 1.3.3 on 2026-08-11. DMK: 37, last 1.11.0 on 2026-10-06. Daily `0.0.0-develop-*` snapshots | 0.3.0 on 2026-01-13, 0.3.1 on 2026-03-25. Transport 6.36.0 on 2026-06-30 | — |
| API shape | RxJS observables of `DeviceActionState`; DI container (inversify) | Promises; `AppClient` | ours |

Other notes:

- **The unscoped `ledger-bitcoin` package is deprecated.** npm says "Please use
  @ledgerhq/ledger-bitcoin" (`npm view ledger-bitcoin deprecated`).
- **Ledger has frozen ledgerjs.** `libs/ledgerjs` is "deprecated and in transition". New
  integrations "must use the DMK", and the `hw-transport-*` packages are "frozen" pending a
  move to `LedgerHQ/ts-libs`
  ([ledger-live README at `d6105f1`](https://github.com/LedgerHQ/ledger-live/blob/d6105f1ebcb4/libs/ledgerjs/README.md)).
  Ledger's docs say the DMK "is designed to replace" the hw-app/hw-transport libraries
  ([developers.ledger.com](https://developers.ledger.com/docs/device-interaction/explanation/ledgerjs)).
- **The DMK WebHID transport README warns** it "is still under development … may lead to
  breaking changes" (package README, 1.2.4).
- **The DMK signer peer-depends on `bitcoinjs-lib ^6.1.6`.** `ledger-bitcoin` 0.3.1 depends
  on `^7.0.1` (`npm view`), so using both would give two bitcoinjs majors.
- **The DMK signer hardcodes the app name `"Bitcoin"`** (`lib/esm/internal/app-binder/constants.js`).
  Testnet, signet and regtest need the separate "Bitcoin Test" app, so a test-network user
  would open it by hand, and we would pass `skipOpenApp: true`. This comes from reading the
  bundle and is not tried on a device.
- **Hand-written client.** The ABN JS client is 2,251 lines of TS in
  [`bitcoin_client_js/src/lib`](https://github.com/LedgerHQ/app-bitcoin-new/tree/f750c800740114127d974bfa1b544f80e58fa96a/bitcoin_client_js/src/lib).
  Of that, 762 lines are its own PSBTv2 class and 134 are Buffer helpers; `@scure/btc-signer`
  already covers both, since it reads and writes PSBTv2 (`PSBTVersion: 2`, `src/transaction.ts:460-474`
  in 2.4.1). What remains to write:
  - the Merkle tree and Merkleised maps
    ([`doc/merkle.md`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/merkle.md));
  - the client-command loop (YIELD, GET_PREIMAGE, GET_MERKLE_LEAF_PROOF, GET_MERKLE_LEAF_INDEX,
    GET_MORE_ELEMENTS);
  - wallet-policy serialisation;
  - the five commands;
  - HID framing (`hid-framing.js` in hw-transport-webhid is 101 lines).

  Estimate: 1,000–1,300 lines plus tests. That is my estimate and is not measured.

## 2. Cost

Each entry connects, gets an xpub and signs a PSBT (wpkh, default wallet). Built with
esbuild 0.28.2: `--bundle --minify --format=esm --platform=browser`, with a `buffer@6` inject.
The DMK does not build without one (`bitcoinjs-lib` and `safe-buffer` `require('buffer')`), and
ledger-bitcoin builds but uses a global `Buffer` at runtime.

| Bundle | Minified | gzip -9 | Packages installed |
|---|---|---|---|
| DMK + signer + WebHID + rxjs + bitcoinjs-lib 6 | 634,350 B | 178,599 B | 36 |
| ledger-bitcoin 0.3.1 + hw-transport-webhid | 778,615 B | 215,355 B | 30 |
| hw-transport-webhid alone (+buffer) | 79,066 B | 25,450 B | — |
| *Baseline: `@scure/btc-signer` `Transaction` only* | 140,914 B | 46,558 B | — |

Largest pieces of each bundle (esbuild metafile, KiB):

- **DMK:** device-management-kit 116; bitcoinjs-lib 95; crypto-js 69 (npm marks it "no longer
  maintained"); signer 58; xstate 35; bip174 34; rxjs 29; semver 26; buffer 25; inversify
  core 23; @noble/hashes 22; purify-ts 15; reflect-metadata 13; @sentry/hub 13.
- **ledger-bitcoin:** bitcoinjs-lib 134; @bitcoinerlab/descriptors-core 97; valibot 83;
  @bitcoinerlab/secp256k1 70; @noble/curves 64; bip32 51; miniscript 38; bip174 38; client 34;
  semver 26; buffer 25.

Overlap with what we already ship:

- **DMK** brings `@noble/hashes@1.8.0`, while the app uses `2.4.0`, so both would ship. It
  also brings bitcoinjs-lib 6, bip174, bs58check, rxjs and a `buffer` polyfill.
- **ledger-bitcoin** installs two `@noble/curves` (1.9.7, 2.4.0), two `@noble/hashes`
  (1.8.0, 2.4.0) and two `@bitcoinerlab/secp256k1` (1.2.0, 2.0.0) (`npm ls`). It also ships a
  second descriptor parser and miniscript compiler, which overlaps our own
  `src/wallet/descriptor.ts`.
- **Spec conflict.** Both clash with `docs/spec-v1.md:170` ("minimal transitive
  dependencies").

## 3. What they ship

I grepped both minified bundles and the installed `node_modules`.

| | DMK | ledger-bitcoin |
|---|---|---|
| `fetch` | Yes: `DmkNetworkClient` (`fetchImpl`) and `HttpManagerApiDataSource` | none |
| WebSocket | Yes: `isomorphic-ws` and the secure-channel data source | none |
| XHR, `sendBeacon`, WebAssembly, `importScripts` | none | none |
| Hardcoded URLs | `https://manager.api.live.ledger.com/api`, `wss://scriptrunner.api.live.ledger.com/update`, `https://device-mock-server.aws.ldg-ps-default.ldg-tech.com` | none (licence/docs strings only) |
| Telemetry | `@sentry/minimal` `captureException` in `WebHidTransport.js` (4 calls) | none |
| `eval`, `Function` | reflect-metadata `Function("return this;")` and `(0,eval)(…)`, inside `try`, reached only if `globalThis`, `global`, `self` and `this` are all missing | lodash-style `Function("return this")()` after `self`, unreached in a browser |

What reaches the network on the DMK path, judged by reading the source:

- The manager-API calls (`getAppList`, `getDeviceVersion`, `getFirmwareVersion`,
  `getAppsByHash`) are used only by GetFirmwareMetadata, GetApplicationsMetadata,
  ListAppsWithMetadata, GenuineCheck, InstallApp, UninstallApp and ListInstalledApps.
- The Bitcoin signer uses only `OpenAppDeviceAction` and `SendCommandInAppDeviceAction`,
  which call none of them.
- So I found no network call on the connect, xpub, sign or address path. This is from
  reading the code, **not observed at runtime**.

The `@sentry/minimal` calls should do nothing unless the page sets up a Sentry client.
That is unverified beyond the package's purpose.

CSP changes. Neither library needs one: there is no wasm, the eval paths are unreached, and the
CSP does not govern WebHID. But the current `connect-src 'self' ws: wss: http: https:`
(`vite.config.ts:20`) would let the DMK's manager-API or WebSocket code reach Ledger if any
path ever called it. Locking `connect-src` down to the user's server is not possible either,
because the server URL is chosen at runtime.

## 4. PSBT requirements

All behaviour below is from the ABN source and docs at `f8f790a`.

- **PSBT version.** The device takes PSBTv2 only: "Given a PSBTv2 and a registered wallet (or
  a standard one)…"
  ([bitcoin.md SIGN_PSBT](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/bitcoin.md#sign_psbt)).
  Both JS libraries accept a v0 PSBT and convert it. A hand-written client converts with
  scure, by re-encoding with `PSBTVersion: 2`. Whether scure's v2 output matches the
  reference client's output is not yet checked.
- **witnessUtxo is required on every segwit input.** Without it the device rejects with
  `EC_SIGN_PSBT_MISSING_WITNESSUTXO_FOR_SEGWIT`
  ([`preprocess_inputs.c:355-359`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/handler/sign_psbt/preprocess_inputs.c#L355-L359)).
- **nonWitnessUtxo on segwit v0 (wpkh, wsh) is optional.** If it is missing the device shows
  a **warning** and signs after the user approves
  ([`preprocess_inputs.c:343-352`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/handler/sign_psbt/preprocess_inputs.c#L343-L352);
  CHANGELOG 2.0.6 "Support signing of segwit V0 transactions with unverified inputs").
  - If it is present, the device hashes it against the prevout txid and checks it against
    witnessUtxo. A mismatch aborts (`EC_SIGN_PSBT_NONWITNESSUTXO_CHECK_FAILED`,
    `…_AND_WITNESSUTXO_MISMATCH`, lines 227-283).
  - scure also checks the txid when one is added (`nonWitnessUtxo: wrong txid`,
    `src/transaction.ts:664`).
- **Taproot needs no previous transaction.** The warning applies only to
  `segwit_version == 0`. For `tr`, the fields we already set are enough: `witnessUtxo`,
  `tapInternalKey` and `tapBip32Derivation` with empty leaf hashes (`src/wallet/psbt.ts:91-99`).
- **Derivations and fingerprint.** "Only inputs whose corresponding BIP-32 derivations are
  present in the PSBT are signed"
  ([integration.md](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/integration.md#transaction-signing-model)).
  A key needs its origin, or "the device will not sign for any key derived by it"
  ([wallet.md](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/wallet.md)).
  This matters here: `origin()` in `src/wallet/psbt.ts:60-69` falls back to the xpub's own
  fingerprint and an empty path when a descriptor has no origin. Ledger signing must refuse
  those wallets up front.
- **Change outputs need their derivations.** These let the device hide change and check that
  it goes to the same account. We already set them (`src/wallet/psbt.ts:185-197`).
- **Sighash.** Only SIGHASH_ALL and SIGHASH_DEFAULT are allowed unless the user enables a
  setting. That matches our `signsEverything` check (`src/wallet/psbt.ts:413-420`).
- **Lock time** comes from `PSBT_GLOBAL_FALLBACK_LOCKTIME` (integration.md, "Lock time").
  Our anti-fee-sniping lock time (`psbt.ts:133-136`) must survive the v2 conversion.
- **What signing returns.** Signing returns partial signatures, not a PSBT. Each one is
  `(input_index, pubkey, signature[, tapleaf_hash])`. For segwit v0 the signature carries the
  sighash byte "as it would be pushed on the stack"; for taproot keypath it is 64 bytes
  ([bitcoin.md](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/bitcoin.md#if-tag_or_input_index-is-at-most-65535)).
  - ledger-bitcoin returns `[number, PartialSignature][]` (`appClient.d.ts`).
  - The DMK `signPsbt` returns `PsbtSignature[]`; its `signTransaction` finalises with
    bitcoinjs and returns tx hex.
- **Merging the signatures back** (scure):
  - wpkh and wsh: `tx.updateInput(i, { partialSig: [[pubkey, sig]] }, true)`;
  - tr: `tx.updateInput(i, { tapKeySig: sig }, true)`.

  Merge into the PSBT we showed, not the one with `nonWitnessUtxo`, then hand the bytes to
  `signed()` (§10).

## 5. BIP388 wallet policies

**Default wallets** need no registration
([wallet.md "Default wallets"](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/wallet.md#default-wallets);
[`policy.c:1418-1500`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/handler/lib/policy.c#L1418-L1500)):

- The template is `wpkh(@0/**)` or `tr(@0/**)`, with exactly one key, which is the
  device's own.
- The origin must be exactly `m/purpose'/coin'/account'`:
  - purpose is 84 or 86;
  - coin is 0 on the Bitcoin app, 1 on Bitcoin Test (`BIP44_COIN_TYPE`,
    [Makefile:70-94](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/Makefile#L70-L94));
  - account is at most 100.
- The address index must be at most 50,000
  ([`constants.h:136-137`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/constants.h#L136-L137)).
- The wallet name must be empty.
- Anything else, including a non-standard path, "must be registered first".

**Silent xpub export.** This works for BIP-44/48/49/84/86/87 paths, in full or cut at the
deepest hardened level. Other paths need `display=1` and show a warning
([bitcoin.md GET_EXTENDED_PUBKEY](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/bitcoin.md#description)).

**Registration.**

- `REGISTER_WALLET` shows the name, the template and every key on the device. On approval it
  returns a 32-byte HMAC-SHA256.
- The HMAC key comes from the seed (SLIP-21), so registration cannot be revoked.
- The host must store the exact policy and name with the HMAC, and send all three on every
  later call. Lose the HMAC and you register again
  ([wallet.md "Registration and usage"](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/wallet.md#registration-and-usage)).
- At least one key must be the device's own
  ([`register_wallet.c:164-169`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/handler/register_wallet.c#L164-L169)).
- Name rules: 1–64 printable ASCII characters, with no space at either end (wallet.md "Wallet
  name").

**Mapping our multisig.**

- `wsh(multi(...))` and `wsh(sortedmulti(...))` are both supported templates.
- BIP388 needs placeholders in first-appearance order (`@0`, `@1`, …;
  [BIP388](https://github.com/bitcoin/bips/blob/c9547b9dad4c/bip-0388.mediawiki), "Key
  placeholders out of order" is listed as invalid). Our descriptor keys are "in the order
  written" (`src/wallet/descriptor.ts:27-28`), so key *i* becomes `@i`, and the order of
  `multi` is kept.
- Each key-vector entry is `[fp/path]xpub`, without a suffix.

**Limits and gaps.**

- **Key count.** `MAX_N_KEYS_IN_WALLET_POLICY 15`
  ([`wallet.h:54`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/common/wallet.h#L54)).
  We allow 16 (`descriptor.ts:42`), so a 16-key multisig cannot be registered.
- **Nano X memory.** The Nano X has a smaller policy budget (`MAX_WALLET_POLICY_BYTES` 1024
  against 1536, `wallet.h:61-70`). Whether a 15-key `wsh(multi)` fits is unverified.
- **Key suffixes.** Only `/**` or `/<M;N>/*` with unhardened M≠N are accepted
  ([`wallet.c:540-580`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/src/common/wallet.c#L540-L580)).
  We also accept a single `/*` chain and fixed steps before the wildcard
  (`descriptor.ts:72-102`, spec line 171). Those wallets cannot be expressed as a policy and
  must be refused for Ledger signing.
- **Repeated xpubs** are rejected (BIP388; `policy.c` `is_policy_sane`).

## 6. Xpub retrieval and address display

**Import from the device:**

1. `GET_MASTER_FINGERPRINT`.
2. `GET_EXTENDED_PUBKEY` at `m/84'/c'/a'` or `m/86'/c'/a'`. This is silent: the path is
   standard and needs no display.
3. Build `wpkh([fp/84h/ch/ah]xpub/<0;1>/*)` for 84, or `tr([fp/86h/ch/ah]xpub/<0;1>/*)`
   for 86.

A multisig cosigner key uses `m/48'/c'/a'/2'`, which is BIP-48 and also silent. The device
returns a plain `xpub`/`tpub` (BIP32 version bytes), which our parser already normalises
(`descriptor.ts:116`).

**Show an address on the device:** `GET_WALLET_ADDRESS` with `display=1`.

- Default wallets pass a zero HMAC; registered wallets pass the stored one
  ([bitcoin.md GET_WALLET_ADDRESS](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/doc/bitcoin.md#get_wallet_address);
  integration.md "trusted screen").
- Indexes at or above 2³¹ are refused (CHANGELOG 2.1.2).

## 7. Browser

Support and gesture rules, from [MDN BCD](https://github.com/mdn/browser-compat-data)
`@mdn/browser-compat-data@8.1.8` and the
[WebHID spec at `1890d6f`](https://github.com/WICG/webhid/blob/1890d6f696fe/index.bs):

- **Where WebHID runs.** `navigator.hid` is in Chrome, Edge 89+ and Opera 75+. It is in
  **no** Firefox, Safari, Chrome Android or Android WebView.
- **Other vendors refuse it.** Mozilla's position is
  [negative](https://github.com/mozilla/standards-positions/issues/459), and WebKit's is
  [oppose](https://github.com/WebKit/standards-positions/issues/510).
- **Secure context.** The interface is `[SecureContext]` (index.bs:202). The app is served
  over https in dev and prod.
- **User gesture.** `requestDevice()` rejects without transient activation, and only works
  from a Window (index.bs:735-748). It must be called directly from a click handler, and
  there must be no `await` (e.g. a dynamic `import()`) before it, because a long wait loses
  the activation. Both libraries call `requestDevice` inside `create()` / `startDiscovering()`.
  So: preload the chunk, then call.
- **Remembered permission.** `getDevices()` lists devices granted before, filtered on the
  Ledger vendor ID `0x2c97` (`@ledgerhq/devices` `ledgerUSBVendorId`). `HIDDevice.forget()`
  revokes the grant (index.bs:1235).
- **Permissions-Policy.** The feature `hid` defaults to `'self'` (index.bs:2124-2126), so
  the top-level app needs no header. Whether the hosting sends a restrictive
  `Permissions-Policy` is unverified, since the deploy config is not in this repo.
- **Android.** WebUSB is in Chrome Android 61+ (BCD). Ledger publishes
  `@ledgerhq/hw-transport-webusb@6.35.0` (frozen with ledgerjs) and
  `@ledgerhq/device-transport-kit-web-ble@1.3.2`. npm has no DMK web-usb transport. A WebUSB
  path is a separate transport and out of scope for a first cut.

## 8. Devices and versions

- **Current app targets:** `nanox`, `nanos+`, `stax`, `flex`, `apex_p`
  ([`ledger_app.toml`](https://github.com/LedgerHQ/app-bitcoin-new/blob/f8f790a325ba772dcce8eb8f9441ebf5289020d0/ledger_app.toml)).
- **Minimum app version:** 2.1.0. That is where today's protocol starts (bitcoin.md, line 3),
  and `@ledgerhq/ledger-bitcoin` "supports versions 2.1.0 and above" (README).
  - Whether every feature we need (wpkh, tr keypath, wsh multisig) works on 2.1.0 itself is
    unverified. Taproot trees came in 2.1.2 (CHANGELOG), and we use none.
  - I found no app-version check in the DMK signer (grepped `lib/esm`).
- **Nano S (original):**
  - All `TARGET_NANOS` code was removed on 2024-06-20
    ([`90f8f29`](https://github.com/LedgerHQ/app-bitcoin-new/commit/90f8f29)).
  - The last Nano S deployment tag is `nanos_2.1.0_2.2.8_sdk_lns-2.1.0-v24.0`, i.e. app 2.2.8
    on Nano S firmware 2.1.0. I am reading that from the tag name; it is not a documented
    statement.
  - It should still sign wpkh, tr and wsh multisig, but gets no fixes. This is unverified on a
    device.
- **Minimum firmware** for each device: unverified. The ABN repo does not state it, and I did
  not find a Ledger page that does.
- **Release dates.** App 2.5.0 is dated 24-07-2026 and 2.5.1 is dated 09-09-2026 in the
  CHANGELOG. GitHub Releases carry no assets
  ([API](https://api.github.com/repos/LedgerHQ/app-bitcoin-new/releases)).

## 9. Testing

**Speculos (the emulator).**

- **Where to get it:** the Docker image is `ghcr.io/ledgerhq/speculos`, and PyPI has
  `speculos` 0.27.4 (Python ≥3.10; building it needs `qemu-user-static`).
  Sources: [docker.md](https://github.com/LedgerHQ/speculos/blob/39e6fb1503d2de2c0bc599ffec095470f46097a3/docs/user/docker.md),
  [build.md](https://github.com/LedgerHQ/speculos/blob/39e6fb1503d2de2c0bc599ffec095470f46097a3/docs/installation/build.md),
  [PyPI](https://pypi.org/project/speculos/).
- **REST API:** on `:5000`, with `POST /apdu`, `/button/*`, `/finger`, `/events` and
  `/screenshot`. CORS is `origins: "*"`
  ([`api.py:78-104`](https://github.com/LedgerHQ/speculos/blob/39e6fb1503d2de2c0bc599ffec095470f46097a3/speculos/api/api.py#L78-L104)).
  So a browser page can reach it; our CSP's `http:` allows it.
- **Approving on screen:** `--automation` takes JSON rules that press buttons when given text
  shows ([automation.md](https://github.com/LedgerHQ/speculos/blob/39e6fb1503d2de2c0bc599ffec095470f46097a3/docs/user/automation.md)).
  ABN ships ready rules for registering, signing and messages in
  [`bitcoin_client_js/src/__tests__/automations`](https://github.com/LedgerHQ/app-bitcoin-new/tree/f750c800740114127d974bfa1b544f80e58fa96a/bitcoin_client_js/src/__tests__/automations).
- **App binary:** there is no prebuilt app ELF to download. It has to be built with
  `ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder` (ABN README). That means one Docker
  build per pinned app tag, cached.

**Shape of the tests.** WebHID cannot be driven by Speculos. So:

1. Test the APDU client at the transport boundary, in Node, with a tiny
   `exchange(apdu) → POST /apdu` transport. This fits beside `integration/` and the regtest
   setup (`integration/vitest.config.ts`).
2. Unit-test the HID framing against captured frames.
3. Optionally, run one Playwright test with a test-only transport injected.

**CI.** `.forgejo/workflows/ci.yml` runs in a `node:22-bookworm` container with no Docker and
does not run `test:integration`. Speculos would be local-only, like regtest, unless the runner
gets Docker or qemu. Feasible, not free.

**Real device, for a manual test:**

- a Ledger with Bitcoin (or Bitcoin Test) ≥2.1.0;
- desktop Chrome or Edge over https;
- on Linux, udev rules for vendor `2c97`. This comes from Ledger's support docs and is
  unverified here.

Cases to cover:

- one wpkh and one tr spend on testnet or signet;
- a 2-of-3 `wsh(sortedmulti)` with registration, plus one with `multi`;
- refusal paths: rejecting on the device, a wrong app open, the device locked.

## 10. Mapping onto this codebase

**The signing seam**

- `SignFlow` (`src/screens/send/Sign.tsx:41`) already funnels every returned signature
  through `signed(psbt)` (`Sign.tsx:100-117`). That runs `collectSigned` for multisig or
  `finaliseSigned` otherwise, and both re-check outputs, fee and `unsignedTx` against `built`
  (`src/wallet/psbt.ts:286-341`).
- A "Sign with Ledger" button belongs next to "Signed it, scan it back"
  (`Sign.tsx:213-220`). It should:
  1. take `toSign` (`Sign.tsx:98`);
  2. add `nonWitnessUtxo` for v0 inputs;
  3. send it to the device;
  4. merge the returned signatures into `toSign`, without `nonWitnessUtxo`;
  5. call `signed(merged)`.
- Nothing downstream changes, and multisig collection works as it does now: the Ledger is
  one cosigner.

**nonWitnessUtxo**

- `buildPsbt` sets only `witnessUtxo` (`psbt.ts:163-169`). Keep it that way so QR exports stay
  small.
- Add a separate `withParents(psbt, raw)` that fills `nonWitnessUtxo` for wpkh and wsh inputs,
  used only on the device path.
- `Bump.tsx:102` builds through the same `buildPsbt`, so it inherits this.

**Are parent transactions present?** Yes, by construction.

- Raw transactions live in the closure variable `raw`, loaded from `cache/<id>/txs`
  (`src/core/wallet.ts:100`).
- A coin exists only as an output of a parsed transaction (`src/core/view.ts:164`,
  `211-233`), and `parsed()` returns `undefined` unless `raw[txid]` is present
  (`wallet.ts:123-131`).
- Inputs' parents are fetched too (`wallet.ts:263-267`), which covers bumps.
- A reorg empties `raw` and the cache together (`wallet.ts:234-241`).
- Gaps:
  - `raw` is not exposed. `WalletSession` (`wallet.ts:51-75`) needs a getter such as
    `transaction(txid): Uint8Array | undefined`.
  - A send resumed from `send/<id>` after a reorg could name a coin whose parent is gone.
    Handle a missing parent by refusing, or by signing with the device's warning. Do not
    assume it is there.
- The cached raw transactions include witnesses. scure re-encodes `nonWitnessUtxo` as
  `RawTx`, and the device hashes the stripped form for the txid. That works in principle,
  but is unverified on a device.

**Where the policy HMAC lives**

- `WalletRecord` (`src/core/wallets.ts:11-21`), sealed in the vault like everything else
  (`src/vault/vault.ts:303-316`). A new optional field such as
  `ledger?: { name: string; hmac: string }` keeps it with its wallet.
- `wallet/*` records are included in backups (`wallets.ts:102-105`). That is wanted, because
  registration is non-revocable and losing the HMAC means registering again.
- The registered name must be stored separately from the display name. Renaming
  (`wallets.ts:83`) must not change it, and it must meet the ASCII rules in §5.
- The HMAC is not a secret key, but it belongs in the vault next to the policy.

**ImportWallet: xpub from the device**

- Add a "Read from Ledger" button beside "Scan a QR code" (`src/screens/ImportWallet.tsx:250-252`).
- It writes the built descriptor into `text` (`ImportWallet.tsx:103`), so `interpret`,
  duplicate detection and the backup step all apply unchanged.
- It needs a choice of script type (84 or 86) and an account number. Multisig still comes
  from pasting a descriptor; the device can supply our cosigner key at `48'/c'/a'/2'`.

**Receive: show the address on the device**

- Put it beside the address (`src/screens/Receive.tsx:126-134`).
- For multisig, the existing advice to check on a cosigner device
  (`Receive.tsx:136-141`) becomes a button once the wallet is registered.
- The default-wallet limits (account ≤100, index ≤50,000) mean some wallets need
  registration even for single-sig.

**Lazy loading.** The only dynamic import today is the demo (`src/main.tsx:15`). Load the
Ledger module with `import()` when the Sign, Import or Receive screen mounts and the feature
is present, not in the click handler (see the gesture point in §7). Its chunk then stays off
the main path. The service worker will still precache it (`vite.config.ts:41-60` lists
every emitted file), which is fine for offline use.

**Feature detection.** Show the buttons only when `"hid" in navigator && isSecureContext`.
Firefox and Safari users then never see them. Hide them in the demo build too.

**Refusing early.** Refuse Ledger signing up front, with a reason, for:

- keys without an origin (`psbt.ts:60-69`);
- a single-chain or fixed-step key path;
- more than 15 keys;
- a fingerprint that does not match the device.

## Recommendation

**Write a small client against the documented protocol, on `@scure/btc-signer`, with its
own HID framing.**

The reason: both Ledger libraries roughly quadruple the crypto code we ship, through
bitcoinjs-lib and a Buffer polyfill. The supported one (DMK) also ships Ledger network
endpoints that our CSP cannot block. The protocol, on the other hand, is small, stable since
2.1.0, and designed so the client need not be trusted.

Use `@ledgerhq/ledger-bitcoin` as a devDependency only. In integration tests it serves as an
oracle: it produces the same commands as our client against Speculos, so the two can be
compared.

If the maintainer would rather not own protocol code, pick `@ledgerhq/ledger-bitcoin` +
`hw-transport-webhid` over the DMK. It has no network code and no telemetry, and has a smaller
API surface. Its costs are the frozen transport and about 210 KiB gzipped.

## Open questions for the maintainer

1. Lift "Hardware wallets over WebUSB or WebHID" from Out of Scope (`docs/spec-v1.md:284`)?
   That also bends the "no vendor-specific code" line.
2. Accept owning about 1,200 lines of protocol code, or prefer roughly 210 KiB gzipped of
   Ledger dependencies?
3. With a segwit v0 parent missing: refuse, or let the device show its "unverified inputs"
   warning?
4. Multisig: is registering policies in scope for the first release, or single-sig only?
5. Is Speculos in CI wanted? It needs Docker or qemu on the Forgejo runner. Otherwise it stays
   local, like regtest.
6. Test networks: support the "Bitcoin Test" app (coin type 1) from the start?

## Work breakdown (PR-sized)

1. **Spec and ADR.** Record the decision and its scope in `docs/adr/` and update the spec.
   Tested by: review only.
2. **APDU core.**
   - Contents: Merkle tree, Merkleised maps, wallet-policy serialisation and id, and the
     client-command interpreter, behind an `exchange(apdu)` interface.
   - Tests: unit tests with vectors from `doc/merkle.md`, `doc/wallet.md` and BIP388, cited
     and fetched, not remembered; an interpreter test against scripted responses.
3. **Commands and PSBTv2.**
   - Contents: get fingerprint, get xpub, get address, sign PSBT (v0→v2 via scure), register.
   - Tests: local Speculos tests in `integration/`, using `POST /apdu` with automation rules,
     and differential tests against `@ledgerhq/ledger-bitcoin` (dev only).
4. **WebHID transport.**
   - Contents: HID framing, `requestDevice` and `getDevices`, errors (locked, wrong app,
     rejected).
   - Tests: framing unit tests against frames captured from Speculos or `hw-transport-webhid`;
     manual check in Chrome.
5. **Device path in `psbt.ts`.**
   - Contents: `withParents` and `mergeSignatures`; a `WalletSession` getter for raw parents.
   - Tests: unit tests showing that merged signatures pass `finaliseSigned` and
     `collectSigned`, that a missing parent is handled, and that QR exports are unchanged.
6. **Sign screen.**
   - Contents: a lazy-loaded "Sign with Ledger" button, feature detection, progress and
     refusal notices.
   - Tests: Vitest component test with a fake client; Playwright check that the button is
     absent without `navigator.hid` and in the demo; a manual real-device spend.
7. **Import from the device.** Tests: component test that it fills the descriptor; manual
   test on a device.
8. **Show the address on the device** (single-sig). Tests: component test; manual
   comparison against the device screen.
9. **Multisig registration.**
   - Contents: register, store `{ name, hmac }` on `WalletRecord`, use it for signing and
     addresses, round-trip through backups.
   - Tests: vault and backup unit tests; Speculos registration flow; manual 2-of-3.
