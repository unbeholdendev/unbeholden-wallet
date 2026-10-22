---
layout: ../layouts/Base.astro
title: Self-hosting Unbeholden Wallet
description: Run Unbeholden Wallet in a container, reach it from your phone over https, connect it to Fulcrum, electrs or Esplora, and check that a build matches its release.
main: page doc
---

<section class="hero">
  <h1>Self-hosting</h1>
  <p class="lead">Run your own copy, so you pick the version of the code you're trusting. It's one container, and it can also bridge to an Electrum server that has no WebSocket.</p>
</section>

<ul class="contents">
  <li><a href="#run-the-container">Run the container</a></li>
  <li><a href="#use-it-from-your-phone">Use it from your phone</a></li>
  <li><a href="#reach-your-node">Reach your node</a></li>
  <li><a href="#verify-a-build">Verify a build</a></li>
  <li><a href="#run-the-demo">Run the demo</a></li>
</ul>

## Run the container

The container serves the built app on `http://localhost:8080`. A localhost origin is a secure context that may open plain `ws://`, so this is also how you reach a node on your own network without a certificate.

Use Compose, which keeps it running across restarts:

```sh
curl -O https://raw.githubusercontent.com/unbeholdendev/unbeholden-wallet/main/compose.yaml
docker compose up -d
```

An Electrum server without WebSocket, such as electrs, is reached through the container. Give it the server's TCP port, or `ssl://host:port` for its SSL port, and the wallet offers `ws://localhost:8080/electrum` on its connection screen.

```sh
ELECTRUM=192.168.1.20:50001 docker compose up -d
```

The image is `ghcr.io/unbeholdendev/unbeholden-wallet`, tagged `latest` and with each release's version. Set `TAG=<version>` to stay on a version you've checked. Update with `docker compose pull && docker compose up -d`.

Without Compose:

```sh
docker run --rm -p 127.0.0.1:8080:8080 -e ELECTRUM=192.168.1.20:50001 ghcr.io/unbeholdendev/unbeholden-wallet
```

Or build the image from a checkout you've verified:

```sh
docker build --build-arg APP_VERSION=$(git describe --tags --always) -t unbeholden-wallet .
docker run --rm -p 127.0.0.1:8080:8080 unbeholden-wallet
```

## Use it from your phone

The app only runs on a secure page: https, or http://localhost. Opened as `http://192.168.1.20:8080` from another device, it says so and stops, because the browser withholds the encryption the vault needs. Put https in front of the container instead, and keep the container bound to `127.0.0.1`.

With Tailscale, on the machine running the container (HTTPS certificates enabled for your tailnet):

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

Caddy fetches the certificate itself. That needs port 80 open to the internet, or a DNS challenge, as below.

The container's Electrum bridge works behind either: it offers `wss://<that name>/electrum` on the connection screen.

## Reach your node

A browser won't open `wss://` to a self-signed certificate it hasn't accepted, and an `https://` page can't open `ws://` at all. Give your node a certificate your browser trusts. Any of these works:

- Your own domain with Let's Encrypt. A DNS challenge needs no open port, and the name can point at a home network address.
- A private network that issues certificates, such as Tailscale with `tailscale cert`.
- Your own certificate authority, such as mkcert, trusted on each device.
- A self-signed certificate, accepted once on each device. The connection screen walks you through it.

Then point Fulcrum at it and open a secure WebSocket port, in `fulcrum.conf`:

```
wss = 0.0.0.0:50004
cert = /path/to/node.example.com.crt
key = /path/to/node.example.com.key
```

Restart Fulcrum and connect the wallet to `wss://node.example.com:50004`.

Let's Encrypt and Tailscale certificates last 90 days. Renew them and restart Fulcrum before they expire, for example from a monthly cron job.

### Esplora

An Esplora server can't push news, so the app asks it for a new block every 30 seconds. A payment still in the mempool shows at the next block or when you refresh. Your Esplora must send `Access-Control-Allow-Origin` naming the app's origin (electrs: `--cors <origin>`), or the browser hides its answers.

## Verify a build

Builds are reproducible: the same commit gives the same files, byte for byte. Each [release](https://github.com/unbeholdendev/unbeholden-wallet/releases) publishes `hashes.txt` and a tarball of the built files, and CI checks that two builds of every commit match.

```sh
git checkout <release tag>
bun install --frozen-lockfile
bun run build
bun run --silent hashes | diff - hashes.txt
```

## Run the demo

The demo, a wallet with made-up history that talks to no server, is its own image. Serve it on its own origin, so it shares no storage with a real vault:

```sh
docker build --target demo -t unbeholden-wallet-demo .
docker run --rm -p 127.0.0.1:8081:8080 unbeholden-wallet-demo
```
