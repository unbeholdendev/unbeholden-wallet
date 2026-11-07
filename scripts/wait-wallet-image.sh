#!/usr/bin/env bash
set -euo pipefail

image=${1:?image required}
tag=${2:?release tag required}
commit=${3:?commit required}

for ((attempt = 1; attempt <= 60; attempt++)); do
  if digest=$(timeout 10s docker buildx imagetools inspect "$image:$tag" --format '{{.Manifest.Digest}}'); then
    if [[ ! $digest =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo "Invalid digest for $image:$tag: $digest" >&2
      exit 1
    fi
    ref="$image@$digest"
    timeout 180s docker pull "$ref" >&2
    revision=$(timeout 10s docker image inspect "$ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
    if [[ $revision != "$commit" ]]; then
      echo "Image revision $revision does not match release commit $commit" >&2
      exit 1
    fi
    echo "$ref"
    exit 0
  fi
  if ((attempt < 60)); then
    echo "Waiting for $image:$tag (attempt $attempt/60)" >&2
    sleep 10
  fi
done

echo "Timed out waiting for $image:$tag" >&2
exit 1
