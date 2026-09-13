# btc-browser-wallet

Watch-only Bitcoin wallet that runs in a browser tab, builds PSBTs, and hands
them to an air-gapped signer over animated QR. Static SPA, no backend, holds no
keys, connects only to the user's own Electrum server.

Spec: `docs/spec-v1.md`.

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
