---
layout: ../layouts/Base.astro
title: Self-hosting Unbeholden Wallet
description: Run Unbeholden Wallet in a container, reach it from your other devices over https, connect it to your Electrum server or Esplora, and check that a build matches its release.
main: page doc
---

<section class="hero">
  <h1>Self-hosting</h1>
  <p class="lead">Run your own copy, so you pick the version of the code you're trusting.</p>
</section>

<ul class="contents">
  <li><a href="#set-it-up">Set it up</a></li>
  <li><a href="#other-setups">Other setups</a></li>
  <li><a href="#verify-a-build">Verify a build</a></li>
</ul>

## Set it up

You need a computer that stays on, such as the one running your node, with [Docker](https://docs.docker.com/get-started/get-docker/) installed, and your own Electrum server.

### 1. Start the wallet

Replace `192.168.1.20:50001` with your Electrum server's address and port:

```sh
curl -O https://raw.githubusercontent.com/unbeholdendev/unbeholden-wallet/main/compose.yaml
ELECTRUM=192.168.1.20:50001 docker compose up -d
```

Compose starts it again after a restart.

`ELECTRUM` makes the container pass the wallet's traffic on to your Electrum server, for servers without WebSocket. If your server has a WebSocket port, you can leave `ELECTRUM` out and type the server's address on the connection screen. See [Without the container in between](#without-the-container-in-between).

### 2. Open it on your devices

On the computer running the container, open `http://localhost:8080`.

From your phone or another computer, the wallet needs https in front of it. One way is [Tailscale](https://tailscale.com/download), installed on that computer and on each device. Turn on HTTPS certificates in its admin console, then run:

```sh
tailscale serve --bg 8080
```

and open `https://<machine>.<tailnet>.ts.net`. The command prints the exact address. Another way is [your own domain](#your-own-domain).

### 3. Connect

With `ELECTRUM` set, the connection screen fills in your server's address, so you only need to press Connect.

To update later, run `docker compose pull && docker compose up -d`.

## Other setups

You don't need any of this if the steps above work for you.

### Your own domain

Instead of Tailscale, put Caddy in front, in a `Caddyfile`:

```
wallet.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy gets the certificate itself, which needs port 80 open to the internet or a DNS challenge. Keep the container bound to `127.0.0.1`: opened over plain http from another device, the app stops, because the browser doesn't give a plain http page the encryption the vault needs.

### An SSL port

Use `ELECTRUM=ssl://host:port`.

### Without the container in between

To connect straight to your Electrum server, it needs a WebSocket port. Your server's docs show how to open one.

On `http://localhost:8080`, plain `ws://` works and needs no certificate, for example `ws://192.168.1.20:50003`.

From another device over https, the browser only opens `wss://`, with a certificate it trusts on your node: from Let's Encrypt, `tailscale cert`, mkcert, or a self-signed one you accept once on each device (the connection screen shows how). In Fulcrum, for example, that goes in `fulcrum.conf`:

```
wss = 0.0.0.0:50004
cert = /path/to/node.example.com.crt
key = /path/to/node.example.com.key
```

Restart the server and connect to `wss://node.example.com:50004`. Let's Encrypt and Tailscale certificates last 90 days, so renew them and restart the server before then.

### Esplora

Your Esplora must send `Access-Control-Allow-Origin` naming the app's origin (electrs: `--cors <origin>`), or the browser won't let the app read its replies. Esplora doesn't announce new blocks, so the app checks for a new block every 30 seconds, and a payment in the mempool shows at the next block or when you refresh.

### One version

Set `TAG=<version>` when you run `docker compose`. The image is `ghcr.io/unbeholdendev/unbeholden-wallet`.

### Without Compose

Run the image:

```sh
docker run --rm -p 127.0.0.1:8080:8080 -e ELECTRUM=192.168.1.20:50001 ghcr.io/unbeholdendev/unbeholden-wallet
```

Or build it from a checkout you've verified:

```sh
docker build --build-arg APP_VERSION=$(git describe --tags --always) -t unbeholden-wallet .
docker run --rm -p 127.0.0.1:8080:8080 unbeholden-wallet
```

## Verify a build

Builds are reproducible: the same commit gives the same files, byte for byte. Each [release](https://github.com/unbeholdendev/unbeholden-wallet/releases) publishes `hashes.txt` and a tarball of the built files, and CI checks that two builds of every commit match.

```sh
git checkout <release tag>
bun install --frozen-lockfile
bun run build
bun run --silent hashes | diff - hashes.txt
```
