# Product

<!-- impeccable:product-schema 1 -->

Inferred from `docs/spec-v1.md`, `AGENTS.md` and the design brief, without an
interview: the owner was unavailable. Every fact below comes from those
sources; nothing was confirmed in conversation.

## Platform

web

## Users

People who already run their own Bitcoin node and Electrum server (Fulcrum,
electrs) and today use Sparrow on a desktop. Technical, privacy-minded,
sceptical of anything that phones home. They open the app to check a balance
on whatever machine or phone is in front of them, and occasionally to build a
transaction and sign it on an air-gapped signer such as a SeedSigner.

## Product Purpose

A watch-only Bitcoin wallet in a browser tab. Imports a `wpkh` or `tr`
descriptor (or an xpub normalised to one), syncs from the user's own Electrum
server over WSS, shows balance, history, addresses and coins, builds PSBTs,
hands them to the signer over animated QR (`ur:crypto-psbt`) or file, takes
the signed PSBT back and broadcasts through the same server. Holds no keys.

## Positioning

The send screen is built around the user's coins, not around an amount field,
and says live which previously unlinked sources a selection would join
on-chain. Nothing else does this well; it is the feature to protect.

## Operating Context

- First action is always connecting to the user's own server. There is no
  default server and no demo. Self-signed certificates fail silently in
  WebSockets; the user must open the `https://` URL in another tab and accept
  the certificate. The connection screen is the funnel.
- Signing happens beside an air-gapped device: phone or laptop screen held up
  to a SeedSigner camera, then the phone camera scanning the signer's QR back.
- Networks: mainnet, signet, regtest.

## Capabilities and Constraints

- Static SPA, React, Vite, TypeScript, Tailwind v4. No component library.
- No outbound requests except the user's Electrum server: no CDN, no remote
  fonts, no analytics. Strict CSP without `unsafe-inline`; no inline `style`
  attributes.
- No fiat anywhere, by design.
- Must work fully on a phone, including coin selection and QR scanning.
- Multiple wallets in one encrypted vault, unlocked by one passphrase.
- Labels (BIP329), frozen coins, RBF always on, fee bumping, mempool-derived
  fee suggestions with a manual sat/vB entry.

## Brand Commitments

- British English. No em-dashes in UI copy. Plain, honest copy.
- Honest about the trust model of the hosted instance.

## Evidence on Hand

No logo, name mark, screenshots or user quotes exist. All wallet data in
prototypes is synthetic.

## Product Principles

1. The user's own node or nothing. Never fall back, never leak.
2. Coins are the unit of thought; amounts are a consequence.
3. Say the privacy cost before it is paid, in plain words.
4. Every failure names its cause and the next step.
5. Nothing changes under the user mid-session.
