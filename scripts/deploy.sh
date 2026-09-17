#!/usr/bin/env bash
# Build the web client, deploy the Worker for one network, then smoke-check the live URL.
# Usage: scripts/deploy.sh testnet|mainnet
set -euo pipefail

target="${1:-}"
case "$target" in
  testnet)
    env_flag=(--env testnet)
    url="https://testnet.nimrelay.xyz"
    expected_network="TestAlbatross"
    ;;
  mainnet)
    env_flag=(--env "")
    url="https://nimrelay.xyz"
    expected_network="MainAlbatross"
    ;;
  *)
    echo "usage: scripts/deploy.sh testnet|mainnet" >&2
    exit 2
    ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

pnpm --filter @nim-relay/web build
pnpm --filter @nim-relay/worker exec wrangler deploy "${env_flag[@]}"

local_bundle="$(grep -o 'assets/index-[^"]*\.js' apps/web/dist/index.html | head -1)"
for attempt in 1 2 3 4 5 6; do
  health="$(curl -fsS --max-time 15 "$url/api/health" || true)"
  live_bundle="$(curl -fsS --max-time 15 "$url/" | grep -o 'assets/index-[^"]*\.js' | head -1 || true)"
  if [[ "$health" == *"\"network\":\"$expected_network\""* && "$live_bundle" == "$local_bundle" ]]; then
    echo "deployed $target: $url ($live_bundle, $expected_network)"
    exit 0
  fi
  sleep 5
done

echo "deploy smoke check failed for $url: health=$health bundle=$live_bundle expected=$local_bundle" >&2
exit 1
