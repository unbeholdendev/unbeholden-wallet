# btc-browser-wallet

Watch-only Bitcoin wallet that runs in a browser tab, builds PSBTs, and hands
them to an air-gapped signer over animated QR. Static SPA, no backend, holds no
keys, connects only to the user's own Electrum server.

Spec: `docs/spec-v1.md`.

## Commands

`bun run dev`, `bun run build`, `bun run typecheck`, `bun run test` (Vitest),
`bun run test:e2e` (Playwright).

Not `bun test`: that is Bun's own runner, which ignores the Vitest config and
so never loads the `fake-indexeddb` setup.

The CSP has no `unsafe-inline`, and it is injected into the built HTML only,
because the dev server's React refresh preamble is inline. So: no `style={{…}}`
attributes, style them with Tailwind classes. An inline style works in dev and
is silently dropped in the build.

Nothing checks the bundle for external origins. The CSP is the only thing
holding the no-outbound-requests guarantee, so read what a new dependency ships.

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

Issues live in Forgejo at `git.unbeholden.dev/unbeholden/btc-browser-wallet`, reached
through the `forgejo` MCP connector. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
