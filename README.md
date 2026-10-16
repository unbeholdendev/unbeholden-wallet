# Bitcoin browser wallet

A watch-only Bitcoin wallet that runs in a browser tab. It talks only to your
own Electrum server, holds no keys, builds PSBTs, and hands them to an
air-gapped signer over animated QR or a file.

Supports `wpkh` and `tr` single-signature wallets on mainnet, signet and
regtest.

## What the hosted app can and cannot protect you from

Read this before trusting a hosted copy with real money.

- **It cannot protect you from whoever controls the domain.** They can serve
  different code to you than to everyone else. A malicious build could show
  you a receive address that is not yours, or quietly send your addresses
  somewhere. Nothing in a web page can rule that out.
- **It does protect you from code changing under you.** After the first load a
  service worker pins the code. A new version is downloaded in the
  background but only runs when you choose to reload into it, or after every
  tab of the app has been closed. The running version is always shown.
- **It does protect you from leaking to third parties.** The app makes no
  requests to anyone except the Electrum server you enter. There is no
  default server, no analytics, no CDN and no remote fonts, and a strict
  Content Security Policy enforces it.
- **It does protect your history at rest.** Wallet data in the browser is
  encrypted with a key derived from your passphrase (Argon2id, AES-GCM).
- **Your signer protects your keys.** The app never sees them. Check the
  addresses and amounts on your signer's own screen before you sign, and
  verify receive addresses on the signer when it matters.

For real money, prefer the container below or a copy whose hashes you have
checked.

## Run it yourself

The container serves the built app on `http://localhost:8080`. A localhost
origin is a secure context that may open plain `ws://`, so this is also how
you reach a node on your own network without a certificate.

```sh
docker build --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) -t btc-browser-wallet .
docker run --rm -p 127.0.0.1:8080:8080 btc-browser-wallet
```

## Verify a build

Builds are reproducible: the same commit gives the same files, byte for byte.
Each release publishes `hashes.txt`.

```sh
bun install --frozen-lockfile
GIT_COMMIT=<short commit> bun run build
bun run --silent hashes | diff - hashes.txt
```

## Reach your node with Tailscale

A browser will not open `wss://` to a self-signed certificate, and an
`https://` page cannot open `ws://` at all. Tailscale gives your node a real
certificate on a private name, reachable from any of your devices with no
port forwarding.

1. Install Tailscale on the node and on your devices, and enable HTTPS
   certificates in the Tailscale admin console.
2. On the node, issue a certificate for its name:
   `tailscale cert node.your-tailnet.ts.net`.
3. Point Fulcrum at it and open a secure WebSocket port, in `fulcrum.conf`:

   ```
   wss = 0.0.0.0:50004
   cert = /path/to/node.your-tailnet.ts.net.crt
   key = /path/to/node.your-tailnet.ts.net.key
   ```

4. Restart Fulcrum and connect the wallet to
   `wss://node.your-tailnet.ts.net:50004`.

Tailscale certificates last 90 days. Re-run `tailscale cert` and restart
Fulcrum before they expire, for example from a monthly cron job.

## Development

`bun run dev`, `bun run build`, `bun run typecheck`, `bun run test`,
`bun run test:e2e`. See `AGENTS.md` and `docs/spec-v1.md`.

### Try it on regtest

```sh
bun run regtest:up        # bitcoind + Fulcrum, prints ws://127.0.0.1:50003
bun run regtest:fixture   # a funded test wallet; prints its descriptors
bun run dev               # then connect to ws://127.0.0.1:50003 and import one
```

`regtest:fund <address> [btc]`, `regtest:mine [n]` and `regtest:reorg [depth]`
move the chain; `regtest:down` stops it. `bun run test:integration` and the
send spec in `bun run test:e2e` need the same stack. The fixture's private
keys are in `scripts/regtest/fixture.ts`, for signing in tests only.
