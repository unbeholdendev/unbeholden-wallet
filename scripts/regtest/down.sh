#!/bin/sh
set -u
cd "$(dirname "$0")/../.."
R=$PWD/.regtest
if [ -f "$R/fulcrum/pid" ]; then
  pid=$(cat "$R/fulcrum/pid")
  kill "$pid" 2>/dev/null && while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
  rm -f "$R/fulcrum/pid"
fi
[ -x "$R/bin/bitcoin-cli" ] && [ -d "$R/bitcoind" ] &&
  "$R/bin/bitcoin-cli" -datadir="$R/bitcoind" stop >/dev/null 2>&1 &&
  while [ -f "$R/bitcoind/regtest/bitcoind.pid" ]; do sleep 0.2; done
exit 0
