#!/usr/bin/env bash
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/wait-wallet-image.sh
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
export fixture
export PATH="$fixture:$PATH"
export MOCK_DIGEST="sha256:$(printf '%064d' 1)"
export MOCK_REVISION=release-commit
export MOCK_UNAVAILABLE=0
export MOCK_PULL_STATUS=0

cat > "$fixture/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$fixture/calls"
case "$1 $2" in
  'buildx imagetools')
    count=$(cat "$fixture/count")
    echo $((count + 1)) > "$fixture/count"
    if ((count < MOCK_UNAVAILABLE)); then exit 1; fi
    echo "$MOCK_DIGEST"
    ;;
  'pull '*) exit "$MOCK_PULL_STATUS" ;;
  'image inspect') echo "$MOCK_REVISION" ;;
  *) exit 2 ;;
esac
DOCKER
cat > "$fixture/sleep" <<'SLEEP'
#!/usr/bin/env bash
exit 0
SLEEP
chmod +x "$fixture/docker" "$fixture/sleep"

run() {
  echo 0 > "$fixture/count"
  : > "$fixture/calls"
  status=0
  bash "$script" ghcr.io/example/wallet v1 release-commit > "$fixture/out" 2> "$fixture/err" || status=$?
}

run
[[ $status == 0 && $(cat "$fixture/out") == "ghcr.io/example/wallet@$MOCK_DIGEST" ]]
grep -q "pull ghcr.io/example/wallet@$MOCK_DIGEST" "$fixture/calls"
grep -q "image inspect ghcr.io/example/wallet@$MOCK_DIGEST" "$fixture/calls"

MOCK_UNAVAILABLE=2
run
[[ $status == 0 && $(cat "$fixture/count") == 3 ]]

MOCK_UNAVAILABLE=60
run
[[ $status != 0 && ! -s "$fixture/out" && $(cat "$fixture/count") == 60 ]]
! grep -q '^pull ' "$fixture/calls"
grep -q 'Timed out' "$fixture/err"

MOCK_UNAVAILABLE=0
MOCK_REVISION=wrong-commit
run
[[ $status != 0 && ! -s "$fixture/out" ]]
grep -q 'does not match' "$fixture/err"

MOCK_REVISION=release-commit
MOCK_PULL_STATUS=1
run
[[ $status != 0 && ! -s "$fixture/out" ]]
! grep -q '^image inspect ' "$fixture/calls"

MOCK_PULL_STATUS=0
MOCK_DIGEST=invalid
run
[[ $status != 0 && ! -s "$fixture/out" ]]
! grep -q '^pull ' "$fixture/calls"
echo '6 wallet image checks passed'
