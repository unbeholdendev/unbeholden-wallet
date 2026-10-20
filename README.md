# Unbeholden Wallet

A watch-only Bitcoin wallet that runs in a browser tab. It talks only to your
own server, Electrum over WebSocket or an Esplora API, holds no keys, builds PSBTs, and hands them to an
air-gapped signer over animated QR or a file.

Supports `wpkh` and `tr` single-signature wallets on mainnet, signet and
regtest.

## Why it exists

I built it for myself: I wanted my on-chain wallet on any device I pick up,
with the features I need, without having to install anything. Sparrow is great, but only on desktop.

It holds no private keys. The worst a bug or a tampered copy can do is show
you wrong information or build a wrong transaction, and your signer still has
to approve it. That is a far smaller risk than a wallet that can spend on its
own.

It was written by AI, under my direction. Writing it by hand would have taken
far longer. I decided what it does and reviewed the work, but you should know
how it was made before you trust it.

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
  requests to anyone except the server you enter, and the origin it was
  loaded from, to look for a container's bridge. There is no default
  server, no analytics, no CDN and no remote fonts. A strict Content
  Security Policy blocks every other kind of request, but it cannot name
  your server in advance, so it allows a WebSocket or an HTTP request to
  any host. That the app only ever asks the one server is a property of its
  code, not something the policy enforces.
- **It does protect your history at rest.** Wallet data in the browser is
  encrypted with a key derived from your passphrase (Argon2id, AES-GCM). Set
  no passphrase and it does not: anyone using the browser can see your wallets.
- **Your signer protects your keys.** The app never sees them. Check the
  addresses and amounts on your signer's own screen before you sign, and
  verify receive addresses on the signer when it matters.

For real money, prefer the container below or a copy whose hashes you have
checked.

## Run it yourself

The container serves the built app on `http://localhost:8080`. A localhost
origin is a secure context that may open plain `ws://`, so this is also how
you reach a node on your own network without a certificate.

Use Compose, which keeps it running across restarts:

```sh
curl -O https://raw.githubusercontent.com/unbeholdendev/unbeholden-wallet/main/compose.yaml
docker compose up -d
```

An Electrum server without WebSocket, such as electrs, is reached through the
container: give it the server's TCP port, or `ssl://host:port` for its SSL
port, and the wallet offers
`ws://localhost:8080/electrum` on its connection screen.

```sh
ELECTRUM=192.168.1.20:50001 docker compose up -d
```

The image is `ghcr.io/unbeholdendev/unbeholden-wallet`, tagged `latest` and
with each build's short commit. Set `TAG=<short commit>` to stay on a version
you have checked. Update with `docker compose pull && docker compose up -d`.

Without Compose:

```sh
docker run --rm -p 127.0.0.1:8080:8080 -e ELECTRUM=192.168.1.20:50001 ghcr.io/unbeholdendev/unbeholden-wallet
```

Or build the image from a checkout you have verified:

```sh
docker build --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) -t unbeholden-wallet .
docker run --rm -p 127.0.0.1:8080:8080 unbeholden-wallet
```

## Verify a build

Builds are reproducible: the same commit gives the same files, byte for byte.
Each release publishes `hashes.txt` and a tarball of the built files. CI
checks that two builds of every commit match.

```sh
git checkout <release tag>
bun install --frozen-lockfile
GIT_COMMIT=<short commit> bun run build
bun run --silent hashes | diff - hashes.txt
```

## Use the container from your phone

The app only runs on a secure page: https, or http://localhost. Opened as
`http://192.168.1.20:8080` from another device, it says so and stops,
because the browser withholds the encryption the vault needs. Put https in
front of the container instead. It stays bound to `127.0.0.1`.

With Tailscale, on the machine running the container (HTTPS certificates
enabled for your tailnet):

```sh
tailscale serve --bg 8080
```

Then open `https://<machine>.<tailnet>.ts.net` on any device in your tailnet.

With Caddy and a name you own, in a `Caddyfile`:

```
wallet.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy fetches the certificate itself. That needs port 80 open to the internet,
or a DNS challenge, as in Reach your node below.

The container's Electrum bridge follows: behind either, it offers
`wss://<that name>/electrum` on the connection screen.

## Reach your node

A browser will not open `wss://` to a self-signed certificate it has not
accepted, and an `https://` page cannot open `ws://` at all. Give your node a
certificate your browser trusts. Any way works:

- Your own domain with Let's Encrypt. A DNS challenge needs no open port, and
  the name can point at a home network address.
- A private network that issues certificates, such as Tailscale with
  `tailscale cert`.
- Your own certificate authority, such as mkcert, trusted on each device.
- A self-signed certificate, accepted once on each device. The connection
  screen walks you through it.

Then point Fulcrum at it and open a secure WebSocket port, in `fulcrum.conf`:

```
wss = 0.0.0.0:50004
cert = /path/to/node.example.com.crt
key = /path/to/node.example.com.key
```

Restart Fulcrum and connect the wallet to `wss://node.example.com:50004`.

Let's Encrypt and Tailscale certificates last 90 days. Renew and restart
Fulcrum before they expire, for example from a monthly cron job.

An Esplora server cannot push news, so the app asks it for a new block every
30 seconds; a payment still in the mempool shows at the next block or when
you refresh. Your Esplora must send `Access-Control-Allow-Origin` naming this
app's origin (electrs: `--cors <origin>`), or the browser hides its answers.

## Development

`bun run dev`, `bun run build`, `bun run typecheck`, `bun run test`,
`bun run test:e2e`. See `AGENTS.md` and `docs/spec-v1.md`.

The dev server is https only, with a self-signed certificate: the vault
needs a secure context, and a LAN address over http is not one. Accept the
certificate warning once. It needs a real Node: Vite on Bun crashes serving
https. The devcontainer installs one.

### Try it on regtest

The devcontainer starts this stack, with a fresh chain, every time it starts.

```sh
bun run regtest:up        # bitcoind + Fulcrum, prints ws://127.0.0.1:50003
bun run regtest:fixture   # a funded test wallet; prints its descriptors
bun run dev               # then connect to wss://<host>:5173/electrum and import one
```

`regtest:fund <address> [btc]`, `regtest:mine [n]` and `regtest:reorg [depth]`
move the chain; `regtest:down` stops it. `bun run test:integration` and the
send spec in `bun run test:e2e` need the same stack. The fixture's private
keys are in `scripts/regtest/fixture.ts`, for signing in tests only.
