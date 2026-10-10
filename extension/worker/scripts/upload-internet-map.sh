#!/usr/bin/env bash
# ABOUTME: Uploads one internet map bundle to the private R2 bucket the Worker serves it from.
# ABOUTME: Usage: bun run --cwd extension/worker upload-internet-map <absolute-bundle-dir> [bundle-name]

set -euo pipefail

dir="$(cd "${1:?usage: upload-internet-map <absolute-bundle-dir> [bundle-name]}" && pwd)"
name="${2:-$(basename "$dir")}"

if [[ ! "$name" =~ ^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "bundle name must be letters, digits, '.', '_' or '-': $name" >&2
  exit 1
fi

for file in map.json map.bin labels.json.gz; do
  if [[ ! -f "$dir/$file" ]]; then
    echo "missing $dir/$file" >&2
    exit 1
  fi
done

cd "$(dirname "$0")/.."
for file in map.json map.bin labels.json.gz; do
  bunx wrangler r2 object put "wwo-internet-map/$name/$file" \
    --file "$dir/$file" --remote --config wrangler.toml
done

echo "uploaded \"$name\". Open https://wewere.online/internet-map/?data=$name while signed in to /admin/."
