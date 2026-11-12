# Unbeholden Wallet

Watch-only Bitcoin wallet that runs in a browser tab, builds PSBTs, and hands
them to an air-gapped signer over animated QR. Static SPA, no backend, holds no
keys, connects only to the user's own Electrum server.

Spec: `docs/spec-v1.md`.

## Commands

`bun run dev`, `bun run build`, `bun run typecheck`, `bun run test` (Vitest),
`bun run test:e2e` (Playwright).
`bun run lint` (Biome: format, imports, lint); `bun run format` applies its safe fixes.

`bun run dev` serves https and must run on real Node; Vite on Bun crashes
serving https.

Not `bun test`: that is Bun's own runner, which ignores the Vitest config and
so never loads the `fake-indexeddb` setup.

The CSP has no `unsafe-inline`, and it is injected into the built HTML only,
because the dev server's React refresh preamble is inline. So: no `style={{…}}`
attributes, style them with Tailwind classes. An inline style works in dev and
is silently dropped in the build.

`site/` is the landing page and docs at wallet.unbeholden.dev: Astro, its own
`package.json`, built to static HTML with no client script. Docs go in
`site/src/pages` as Markdown. Its CSP meta has no `unsafe-inline` either, which
is why Shiki highlighting and stylesheet inlining are off.
The app is at app.wallet.unbeholden.dev, the demo at demo.wallet.unbeholden.dev.

Nothing checks the bundle for external origins. The CSP is the only thing
holding the no-outbound-requests guarantee, so read what a new dependency ships.

## Layers

`src/` imports only within a layer or down: `wallet` at the bottom;
`transport` and `backend` above it, neither importing the other; `vault`
importing none of them; then `core` < `ui` < `app` < `screens`. Tests and the
root files (`App.tsx`, `main.tsx`, `demo.tsx`, `fixture.ts`) sit above all.
`bun run lint` fails any other import.

Every vault record name and its stored type is in `vaultKey` in
`src/core/wallets.ts`; read and write through `readRecord`/`writeRecord`, never
`vault.get/put` with a string. Never change a name or a stored shape: existing
vaults and backups must load.

## Constants and test vectors

A constant you cannot work out from the code carries the URL it came from, on
the line above it. Version bytes, charsets, generator polynomials.

Fetch a test vector from its spec and cite it. Never write one from memory. A
remembered vector that happens to match the code proves nothing, and no
reviewer can tell that kind from the real kind by looking.

Where a test needs the same constants as the code, it keeps its own copy. If
it imports the table it is checking, a wrong value agrees with itself and the
test passes.

## Agent skills

### Issue tracker

See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
