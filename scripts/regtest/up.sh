#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
R=$PWD/.regtest
mkdir -p "$R/downloads" "$R/bin"

fetch() {
  file=$(basename "$1")
  [ -f "$R/downloads/$file" ] && return
  curl -fsSL -o "$R/downloads/$file.part" "$1"
  sum=$(curl -fsSL "$2" | awk -v f="$file" '$2 == f { print $1 }')
  [ -n "$sum" ] || { echo "$file is not listed in $2" >&2; exit 1; }
  echo "$sum  $R/downloads/$file.part" | sha256sum -c --quiet
  mv "$R/downloads/$file.part" "$R/downloads/$file"
}

if [ ! -x "$R/bin/bitcoind" ]; then
  fetch https://bitcoincore.org/bin/bitcoin-core-31.1/bitcoin-31.1-x86_64-linux-gnu.tar.gz \
    https://bitcoincore.org/bin/bitcoin-core-31.1/SHA256SUMS
  tar -xzf "$R/downloads/bitcoin-31.1-x86_64-linux-gnu.tar.gz" -C "$R/bin" --strip-components=2 \
    bitcoin-31.1/bin/bitcoind bitcoin-31.1/bin/bitcoin-cli
fi
if [ ! -x "$R/bin/Fulcrum" ]; then
  fetch https://github.com/cculianu/Fulcrum/releases/download/v2.1.3/Fulcrum-2.1.3-x86_64-linux.tar.gz \
    https://github.com/cculianu/Fulcrum/releases/download/v2.1.3/Fulcrum-2.1.3-shasums.txt
  tar -xzf "$R/downloads/Fulcrum-2.1.3-x86_64-linux.tar.gz" -C "$R/bin" --strip-components=1 \
    Fulcrum-2.1.3-x86_64-linux/Fulcrum
fi

"$(dirname "$0")/down.sh"
rm -rf "$R/bitcoind" "$R/fulcrum"
mkdir -p "$R/bitcoind" "$R/fulcrum/db"

cat >"$R/bitcoind/bitcoin.conf" <<CONF
regtest=1
txindex=1
fallbackfee=0.0001
[regtest]
rpcuser=regtest
rpcpassword=regtest
CONF
cli() { "$R/bin/bitcoin-cli" -datadir="$R/bitcoind" "$@"; }
"$R/bin/bitcoind" -datadir="$R/bitcoind" -daemon >/dev/null
cli -rpcwait createwallet miner >/dev/null
cli generatetoaddress 101 "$(cli getnewaddress)" >/dev/null

wss=""
if command -v openssl >/dev/null; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=localhost \
    -addext subjectAltName=DNS:localhost,IP:127.0.0.1 \
    -keyout "$R/fulcrum/key.pem" -out "$R/fulcrum/cert.pem" 2>/dev/null
  wss="wss = 127.0.0.1:50004
cert = $R/fulcrum/cert.pem
key = $R/fulcrum/key.pem"
fi
cat >"$R/fulcrum/fulcrum.conf" <<CONF
datadir = $R/fulcrum/db
bitcoind = 127.0.0.1:18443
rpcuser = regtest
rpcpassword = regtest
tcp = 127.0.0.1:50001
ws = 127.0.0.1:50003
$wss
polltime = 0.5
peering = false
announce = false
CONF
LC_ALL=C.UTF-8 nohup "$R/bin/Fulcrum" "$R/fulcrum/fulcrum.conf" >"$R/fulcrum/log" 2>&1 &
echo $! >"$R/fulcrum/pid"

# curl exits 7 only while nothing listens; any other answer means Fulcrum is up.
i=0
until curl -s -o /dev/null http://127.0.0.1:50003 || [ $? -ne 7 ]; do
  i=$((i + 1))
  [ $i -lt 120 ] || { tail "$R/fulcrum/log" >&2; exit 1; }
  sleep 0.5
done
echo "Electrum on ws://127.0.0.1:50003"
[ -z "$wss" ] || echo "and wss://127.0.0.1:50004, self-signed: $R/fulcrum/cert.pem"
