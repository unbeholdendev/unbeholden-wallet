# Spec: v1 watch-only wallet with PSBT construction

## Problem Statement

To look at my own Bitcoin, I have to install a desktop wallet. Checking a
balance, reading through transaction history, or working out which UTXOs I hold
are all read-only activities, and none of them justify installing and
maintaining software on every machine I sit at.

Building a transaction is worse. The wallets that do it well are desktop
applications, and the ones that run anywhere are custodial, tied to a service
that watches my addresses, or unable to talk to my own node. When I do get to
build a transaction, coin selection is buried behind an advanced toggle, and no
wallet tells me the thing I actually want to know when I pick coins: which of
my previous payments I am about to link together.

I run my own Electrum server. I should be able to open a tab, connect to it, see
everything, build a transaction, sign it on an air-gapped signer, and broadcast
it, without installing anything on the machine in front of me.

## Solution

A browser-based, watch-only Bitcoin wallet. It is a static single-page app,
installable as a PWA, that connects over WebSocket Secure directly to the user's
own Electrum server. It holds no keys.

The user imports an output descriptor (or an extended public key, which is
normalised to one). The app derives addresses, syncs history and UTXOs from the
Electrum server, caches everything encrypted in the browser, and presents
balance, history, addresses and coins.

To spend, the user opens a send screen that is built around their UTXOs rather
than hiding them. As coins are selected, the app shows the fee and change
consequences and, distinctively, the privacy consequence: which previously
unconnected coins this selection will link on-chain. An automatic selector is
one tap away for users who do not care.

The resulting PSBT is exported as an animated QR (UR) or a file, signed on an
air-gapped signer such as a SeedSigner, scanned or loaded back in, and
broadcast through the user's own server.

No keys, no server operated by the project, no outbound requests to anyone but
the user's own node.

## User Stories

### Onboarding and wallet setup

1. As a node runner, I want to enter my Electrum server's `wss://` address, so that the wallet talks only to infrastructure I control.
2. As a node runner, I want the wallet to remember my server address between sessions, so that I do not retype it every time.
3. As a node runner, I want to see clearly whether I am connected, connecting, or disconnected, so that I can trust what I am looking at.
4. As a node runner whose connection failed, I want to be told precisely why (certificate rejected, connection refused, timed out, responded but is not an Electrum server), so that I can fix the actual problem.
5. As a node runner with a self-signed certificate, I want step-by-step guidance on making the browser accept it, so that I am not left with a silent failure.
6. As a node runner, I want documented guidance on exposing my node over Tailscale with a valid certificate, so that I can reach it from any device without port forwarding.
7. As a privacy-conscious user, I want the app to refuse to work without my own server rather than quietly falling back to a public one, so that I never leak my addresses by accident.
8. As a new user, I want to import a wallet by pasting an output descriptor, so that the script type and derivation are unambiguous.
9. As a user migrating from another wallet, I want to paste a bare `zpub`, `vpub` or `xpub`, so that I can use an export that is not a descriptor.
10. As a user who pasted an extended key, I want to see the descriptor the app inferred from it, so that a wrong guess is visible before I rely on an empty wallet.
11. As a user importing a wallet, I want to scan a descriptor from a QR code shown by my signer, so that I do not have to type or transfer it manually.
12. As a user, I want to set a passphrase that encrypts my wallet data in this browser, so that someone with access to my device cannot read my financial history.
13. As a returning user, I want to unlock with my passphrase and get straight to my balance, so that checking in is fast.
14. As a user, I want the app to prompt me to back up my descriptor during onboarding, so that losing browser storage is an inconvenience rather than a loss.
15. As a user with several wallets, I want to hold more than one in the app and switch between them quickly, so that I can keep savings and spending separate.
16. As a user, I want to name each wallet, so that I can tell them apart at a glance.
17. As a user, I want to remove a wallet from the app, so that I can clean up wallets I no longer watch.

### Viewing

18. As a wallet owner, I want to see my confirmed and unconfirmed balance, so that I know what I hold and what is still settling.
19. As a wallet owner, I want to see my transaction history newest first, with amounts, dates and confirmation counts, so that I can review activity.
20. As a wallet owner, I want to open a transaction and see its inputs, outputs, fee, size, fee rate and block, so that I can understand exactly what happened.
21. As a wallet owner, I want to see which outputs of a transaction were mine, so that I can read a transaction without decoding it myself.
22. As a wallet owner, I want to see every UTXO I hold with its value, age, confirmation count and address, so that I can reason about my coins.
23. As a wallet owner, I want to see my receive addresses, which have been used, and which is next unused, so that I can pick an address safely.
24. As a wallet owner, I want to copy a receive address and show it as a QR code, so that I can be paid.
25. As a wallet owner, I want to see the derivation path of any address, so that I can verify it on my signer if I choose.
26. As a wallet owner, I want to search and filter my transactions by label, amount or date, so that I can find a specific payment.
27. As a wallet owner, I want to see whether an address has been reused, so that I can avoid compounding a privacy mistake.

### Syncing

28. As a wallet owner, I want my wallet to appear within a second when I come back to it, so that checking a balance feels instant.
29. As a wallet owner with a large history, I want a first sync to complete in seconds rather than minutes, so that importing does not feel broken.
30. As a wallet owner, I want to see sync progress while it runs, so that I know the app is working rather than stuck.
31. As a wallet owner, I want new transactions to appear without me refreshing, so that I can watch a payment arrive.
32. As a wallet owner with sparse address use, I want to scan beyond the default gap limit on demand, so that coins outside it are not invisible.
33. As a wallet owner, I want my history cached locally so returning syncs only fetch what changed, so that I am not re-downloading my whole wallet.
34. As a wallet owner, I want the app to notice a chain reorganisation, re-sync and tell me it happened, so that I am never shown stale confirmations.

### Labels

35. As a wallet owner, I want to label a transaction, so that I can remember what a payment was for.
36. As a wallet owner, I want to label an address, a UTXO and an output, so that my coins are meaningful rather than anonymous amounts.
37. As a wallet owner, I want to import my labels from another wallet as a BIP329 file, so that switching does not mean starting from nothing.
38. As a wallet owner, I want to export my labels as a BIP329 file, so that I am not locked into this wallet.
39. As a wallet owner, I want to mark a coin as do-not-spend, so that dust or tainted coins are never selected automatically.
40. As a wallet owner, I want frozen coins visibly excluded from selection and balances, so that I am not surprised by what is spendable.

### Building a transaction

41. As a wallet owner, I want a send screen that shows my coins by default, so that I can choose what I spend rather than hunting for the option.
42. As a wallet owner, I want to select coins and see the resulting fee, change and total update live, so that I understand the trade-off as I make it.
43. As a wallet owner, I want to be told which of my previously unlinked coins a selection would link together on-chain, so that I can protect my privacy deliberately.
44. As a wallet owner in a hurry, I want a one-tap automatic selection, so that I do not have to think about coins when I do not care.
45. As a wallet owner, I want the automatic selector to prefer solutions without change where possible, so that my transactions are cheaper and more private.
46. As a wallet owner, I want to enter a recipient address and amount, with validation and network checks, so that I cannot build a transaction to a malformed or wrong-network address.
47. As a wallet owner, I want to scan a recipient address or BIP21 URI from a QR code, so that I do not mistype it.
48. As a wallet owner, I want to send my entire balance or an entire coin, so that I can sweep without arithmetic.
49. As a wallet owner, I want to add more than one recipient, so that I can batch payments into one transaction.
50. As a wallet owner, I want to see where my chosen fee places me in the current mempool, so that my fee decision is informed by reality rather than a guess.
51. As a wallet owner, I want fee suggestions derived from my node's mempool, so that I am not relying on an estimator that returns nothing useful.
52. As a wallet owner, I want to set a fee rate manually in sat/vB, so that I retain control.
53. As a wallet owner, I want to review the full transaction before export, so that I can check every output.
54. As a wallet owner, I want my transactions to signal RBF by default, so that I can unstick them later.
55. As a wallet owner, I want to see the change address and its derivation path, so that I can confirm change is returning to me.

### Signing and broadcasting

56. As an air-gapped signer user, I want the PSBT exported as an animated QR, so that my signer can read it without a cable.
57. As an air-gapped signer user, I want the QR animation to show progress and parts, so that I know how far through a transfer I am.
58. As an air-gapped signer user, I want to control the animation speed and QR density, so that I can make it readable by my particular device and camera.
59. As an air-gapped signer user, I want to scan the signed PSBT back in with my camera, so that I can complete the round trip in the browser.
60. As an air-gapped signer user, I want the scanner to show how many parts it has captured, so that I know it is progressing and when to stop.
61. As a user without a working camera, I want to export and import the PSBT as a file, so that I have a reliable fallback.
62. As a wallet owner, I want the app to verify a returned PSBT is fully signed and matches the transaction I built, so that I cannot broadcast something unexpected.
63. As a wallet owner, I want to broadcast the finalised transaction through my own node, so that I do not reveal my IP address and transaction to a third party.
64. As a wallet owner, I want to see the broadcast transaction appear immediately in my history as unconfirmed, so that I have confirmation it went out.
65. As a wallet owner whose broadcast failed, I want the node's actual rejection reason, so that I can understand what is wrong.

### Fee bumping

66. As a wallet owner with a stuck transaction, I want to bump its fee, so that it confirms during a busy period.
67. As a wallet owner bumping a fee, I want the app to construct a valid replacement that satisfies replacement rules, so that my node does not reject it.
68. As a wallet owner bumping a fee, I want to see the old and new fee rate side by side, so that I know what the bump costs.
69. As a wallet owner bumping a fee, I want the same QR or file signing round trip as a normal send, so that the flow is familiar.

### Unconfirmed coins and safety

70. As a wallet owner, I want to spend my own unconfirmed change freely, so that I am not blocked between transactions.
71. As a wallet owner, I want a clear warning before spending an unconfirmed payment from someone else, so that I understand it can be replaced out from under me.
72. As a wallet owner, I want coins with unconfirmed parents excluded by default, so that I do not build transactions that cannot propagate.

### Trust, storage and platform

73. As a security-conscious user, I want to see which version of the app I am running, so that I can compare it against a published release.
74. As a security-conscious user, I want published build hashes and reproducible builds, so that I can verify the hosted app matches the source.
75. As a security-conscious user, I want to run the app locally from a container, so that I can pin the code I use.
76. As a user running the app locally, I want to connect to my node over plain `ws://` on my own network, so that I do not need a certificate at home.
77. As a security-conscious user, I want an honest statement of what the hosted instance can and cannot protect me from, so that I can choose an appropriate level of care.
78. As a user, I want the app not to update itself silently mid-session, so that the code I am using does not change while I am building a transaction.
79. As a mobile user, I want to install the app to my home screen, so that my wallet data is not evicted by the browser after a week of not using it.
80. As a mobile user, I want to be told plainly why installing matters on iOS, so that I do not lose my wallet data by ignoring a prompt.
81. As a mobile user, I want the whole app to work on a phone screen, including coin selection and QR scanning, so that the browser promise holds where I most want it.
82. As a user, I want the app to make no network requests to anyone except my Electrum server, so that using it does not leak anything anywhere.
83. As a developer or tester, I want to use the wallet on signet and regtest, so that I can exercise the full signing flow without risking funds.
84. As a wallet owner, I want to lock the app manually, so that I can leave it open without exposing my history.

## Implementation Decisions

### Delivery and stack

- A static single-page app, no backend of any kind. React, Vite, TypeScript, Tailwind. No component library: build the small number of components needed.
- Shipped as a PWA. The service worker pins code after first load. Updates are explicit and visible: the running version is displayed, and code is never swapped mid-session.
- A container image serving the built app over `http://localhost` is a first-class delivery target. It provides the pinned-code path and, because a localhost origin is a secure context that may open `ws://`, it is also the escape hatch for connecting to a LAN node without a certificate.
- Reproducible builds with published hashes per release.
- No CDN, no analytics, no remote fonts, no runtime requests to any origin other than the user's configured server. Strict CSP without `unsafe-inline`. The dependency budget is part of the security model, not separate from it: every added dependency weakens the storage encryption it sits beside.

### Bitcoin layer

- `@scure/btc-signer` and `@scure/bip32` as the primary libraries: audited, minimal transitive dependencies, native taproot, PSBT support. `bitcoinjs-lib` may be used where it already solves a specific problem well rather than reimplementing it.
- Descriptor support is limited to `wpkh` and `tr`. A small BIP380 parser is written in-project for that subset rather than pulling in a general descriptor library.
- Extended public keys are accepted and normalised to descriptors. SLIP-132 prefixes (`zpub`, `vpub`, `ypub` and testnet equivalents) determine the script type automatically. A `[fingerprint/path]` key origin takes its script type from the BIP44 purpose (84h, 86h). A bare `xpub` requires the user to choose once. The inferred descriptor is always shown back to the user.
- Network parameters (mainnet, signet, regtest) are a configuration value threaded through derivation, address encoding and validation, never a module-level constant.

### Backend interface

- All external I/O goes through a single `WalletBackend` interface. This is both the architectural seam that keeps an Esplora implementation possible and the test seam.
- The interface covers: fetching the chain tip, subscribing to headers, fetching history for a batch of scripthashes, fetching a batch of transactions, subscribing to scripthashes, fetching the mempool fee histogram, and broadcasting a raw transaction.
- The v1 implementation is Electrum over WSS only. There is no default server, no bundled server list, no demo mode, and no instance operated by the project.
- Electrum JSON-RPC batching is used wherever more than one call of the same kind is needed. This is the primary sync performance lever and is a requirement, not an optimisation.
- The connection screen classifies failures into distinct, actionable states: certificate rejected, connection refused, timed out, and connected-but-not-Electrum. Each has its own guidance. Tailscale is the documented happy path for reaching a home node with a valid certificate.

### Storage

- One encrypted vault per browser origin, holding multiple wallets, unlocked by a single passphrase. Argon2id for key derivation, AES-GCM for encryption, IndexedDB for storage.
- The vault holds descriptors, wallet metadata, labels, frozen-coin flags, cached transactions and cached address history.
- Cached chain data is treated as a cache, not as a record of truth. The descriptor is the only thing whose loss matters, so descriptor backup is part of onboarding, and each wallet's descriptor stays in Settings to copy, download or show as a QR.
- `navigator.storage.persist()` is requested where supported. On iOS the app relies on home-screen installation to avoid seven-day storage eviction, and says so explicitly rather than burying it.

### Syncing

- Default gap limit of 20 per chain, with an explicit user-triggered deeper scan.
- Delta sync against the stored chain tip on return visits. Full history is only fetched once.
- Subscriptions are taken on the chain tip and on addresses within the active gap window. Addresses outside it are polled on new blocks.
- Performance targets are treated as acceptance criteria: a return visit is interactive in under one second, and a first sync of a wallet with roughly 500 transactions completes in under ten seconds against a local Fulcrum.
- Reorg handling is deliberately blunt. When an incoming header does not extend the stored tip, the wallet's cached chain data is discarded, the wallet re-syncs, and the user is told it happened. Surgical invalidation is not worth the edge cases.
- Unconfirmed coins: the wallet's own unconfirmed change is spendable without friction, unconfirmed incoming payments from others carry a hard warning, and coins with unconfirmed parents are excluded by default.

### Sending

- The send screen is UTXO-first. The coin list is the primary interface, not a disclosure behind an advanced toggle.
- A one-tap automatic selection runs branch-and-bound with a single-random-draw fallback, preferring changeless solutions.
- Selecting coins updates fee, change, total and a privacy assessment live. The privacy assessment names which previously unlinked groups of coins the selection would join on-chain. This is the feature the product is differentiated on and is built, not deferred.
- Fee rate options are derived from the mempool fee histogram obtained from the user's own server, not from `blockchain.estimatefee`. The current mempool is visualised so a fee choice can be seen in context. A manual sat/vB entry is always available.
- All transactions signal RBF.
- Fee bumping is in v1: it reconstructs the transaction, re-selects coins if change cannot absorb the increase, and goes through the same signing round trip.

### Signing transport

- Animated QR uses UR (`ur:crypto-psbt`). Descriptors scan as `ur:crypto-output`, `ur:crypto-account`, `ur:output-descriptor` or `ur:account-descriptor`, or as plain text. BBQr (Coldcard Q) is offered as an alternative export format and read back automatically, including its Zlib mode.
- PSBT file export and import ship in the same release as the QR flow and are the supported fallback.
- The scanner uses `getUserMedia` with a QR decoder over the video stream, handles out-of-order UR fragments, and shows captured-parts progress. Animation speed and QR density are user-adjustable.
- A returned PSBT, or a transaction the signer finished, is validated against the transaction that was built before broadcast is offered: outputs, amounts and fee must match, and signatures must be complete.

### Trust model

- The hosted instance is convenience-grade and says so. Whoever controls the domain can serve targeted code, which means a malicious build could display a wrong receive address. This is documented plainly in the README and surfaced in the app rather than hidden.
- Mitigations are PWA code pinning, reproducible builds with published hashes, and the local container image.
- On-device address verification is offered as an optional action, not a mandatory step.

## Testing Decisions

A good test here describes behaviour a user could observe and would notice
breaking: a balance, a selected coin set, a constructed transaction, an error
message. It does not assert on internal function calls, module structure or
intermediate state. Tests enter at the highest available seam and use real code
below it wherever that is possible.

There is no prior art in this repository; it is empty. These tests are the prior
art for everything that follows.

### Seams

There is one I/O seam, `WalletBackend`, and one injected value, the clock.
Nothing else is stubbed.

- Storage is deliberately not a seam. Tests exercise the real encrypted IndexedDB
  path via `fake-indexeddb`, because the encryption and serialisation code is
  where bugs would live and stubbing it would test nothing.
- The UI is not a seam. Components render against the real wallet core with a
  fake `WalletBackend` beneath.
- The clock is injected as a value so that time-dependent behaviour (fee target
  ages, how long a transaction has been unconfirmed) is testable without waiting.

### Layers

**Pure unit tests, no seam required.** Descriptor parsing, key derivation,
address encoding, coin selection, PSBT construction, UR encoding and decoding,
BIP329 serialisation. These are pure functions tested against published vectors:
BIP32, BIP84 and BIP86 derivation vectors, BIP174 PSBT vectors, and descriptor
vectors from BIP380 and Bitcoin Core. Correctness here is provable before
anything depends on it, so this layer is built first.

**Wallet core tests, entered at `WalletBackend`.** A fake backend plus
`fake-indexeddb`. These cover the behaviour that makes the wallet a wallet:
balance and UTXO set derived from a known history, gap-limit scanning and
deeper scans, delta sync against a cached tip, reorg detection and recovery,
unconfirmed and unconfirmed-parent handling, frozen coin exclusion, label
round-trips, and coin selection producing a transaction with the expected inputs,
outputs and fee. The fake backend can also simulate the failure modes the
connection screen must classify.

**Integration tests against real infrastructure.** A `docker-compose` stack of
`bitcoind` in regtest and Fulcrum, driven in CI. Blocks are mined and a known
history is created, then the real Electrum WSS backend is asserted to produce
exactly the expected balance and UTXO set. This is what proves the batching,
subscription and protocol handling work against a real server rather than a
fake. Sync performance targets are asserted here.

**Browser tests for the camera and QR leg.** Playwright with a fake media
stream feeding known animated QR frames, covering the multi-part UR round trip
and out-of-order fragments. Automated coverage here is a floor, not a
substitute: the QR round trip is also manually verified against a real
SeedSigner on a real phone before the surrounding UI is built.

## Out of Scope

Explicitly excluded from v1. None of these get an issue opened until v1 ships.

- Multisig in any form. This is the one that will be requested first and sounds
  like a small addition. It is not: it roughly doubles the PSBT and descriptor
  complexity, and Sparrow already does it well.
- Hardware wallets over WebUSB or WebHID (Ledger, Trezor). The QR and file paths
  cover air-gapped signers with no vendor-specific code.
- CPFP fee bumping.
- Tor.
- Coinjoin and payjoin.
- BIP47 payment codes and silent payments.
- Fiat prices, currency conversion and any form of cost-basis or tax accounting.
  This would require a price oracle and would break the property that the app
  makes no requests to anyone but the user's node.
- Wallet statistics and analytics of any kind. Deferred without a chosen form.
- Message signing and verification.
- Anything Lightning.
- Multiple accounts per descriptor.
- Legacy `pkh` and wrapped `sh(wpkh)` script types.
- Esplora or any HTTP backend implementation. The interface accommodates one;
  v1 does not ship one.
- Any server operated by the project: no default Electrum endpoint, no bundled
  server list, no proxy, no demo mode.
- Mandatory on-device address verification.

## Further Notes

**Why this exists.** The honest framing, agreed explicitly: this is a personal
tool, built because the author wants it, published openly without promises. The
zero-install pitch does not survive contact with "now set up a node and a TLS
certificate", so it is not a growth story. The browser is a convenience for
people who already run a node, and those people already run Sparrow. If this
matters to anyone else, it will be because of the UTXO-first send flow with live
privacy feedback, which nothing else does well. That is the feature to protect
when scope pressure arrives.

**Build order.** The risky legs are not the UI. Before the real build, a
throwaway two-week spike proves four things end to end, unstyled: connecting to
a real Fulcrum over WSS, batched sync of a real wallet within the performance
targets, PSBT construction, and a QR round trip through a real SeedSigner using
a phone camera. Each of those can fail in a way that changes the design. The
spike is discarded afterwards. The real build then proceeds bottom-up from the
descriptor and derivation layer, which has published vectors and can be made
provably correct before anything sits on it.

**The connection screen is the funnel.** Given that there is no default server
and no demo, every user's first action is connecting to their own node, and the
browser makes that harder than it sounds: an HTTPS page cannot open `ws://` at
all, and a `wss://` connection to a self-signed certificate fails with no
in-browser override, because WebSockets have no "proceed anyway" affordance. The
user must first visit the `https://` URL in another tab and accept the
certificate there. This is obscure enough that most people will conclude the app
is broken. Every browser wallet that has died, died here. The failure
classification, the Tailscale documentation and the local container path exist
to address this specific problem and should be treated as product surface, not
plumbing.

**Dev server port.** The devcontainer maps host 5173 to container 5173, Vite's
default. The Vite configuration must bind to 0.0.0.0 rather than localhost, or
the forwarded port will refuse connections from outside the container, and must
set `strictPort`, or a busy 5173 silently moves the server to a port nothing
maps.
