#!/bin/bash
# ABOUTME: Build both browser zips into ./publish and submit to Chrome + Firefox stores via `wxt submit`.
# ABOUTME: Usage: ./release.sh [--dry-run] [--skip-firefox] [--skip-chrome]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DRY_RUN=""
SKIP_FIREFOX=0
SKIP_CHROME=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    --skip-firefox) SKIP_FIREFOX=1 ;;
    --skip-chrome) SKIP_CHROME=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

if [ ! -f ".env.submit" ]; then
  echo "Missing .env.submit — run \`bunx wxt submit init\` first."
  exit 1
fi

if [ "$SKIP_CHROME" -eq 0 ]; then
  set -a; . ./.env.submit; set +a
  TOKEN_PROBE=$(curl -s -X POST https://oauth2.googleapis.com/token \
    -d "client_id=${CHROME_CLIENT_ID}" \
    -d "client_secret=${CHROME_CLIENT_SECRET}" \
    -d "refresh_token=${CHROME_REFRESH_TOKEN}" \
    -d "grant_type=refresh_token")
  if echo "$TOKEN_PROBE" | grep -q '"error"'; then
    echo "Chrome refresh token rejected by Google:"
    echo "  $TOKEN_PROBE"
    echo ""
    echo "Regenerate it with: bun run submit:refresh-chrome-token"
    echo ""
    echo "If this happens roughly every 7 days, the OAuth client in Cloud Console is the wrong type."
    echo "It must be a Desktop app client (not Web application) — Web clients use the deprecated OOB"
    echo "flow which Google now penalizes with short-lived tokens."
    exit 1
  fi
fi

VERSION=$(node -p "require('./package.json').version")
PUBLISH_DIR="publish"

echo "Building extension v${VERSION} into ${PUBLISH_DIR}/ ..."
rm -rf "${PUBLISH_DIR}"
WXT_OUT_DIR="${PUBLISH_DIR}" bun run wxt zip
WXT_OUT_DIR="${PUBLISH_DIR}" bun run wxt zip -b firefox

CHROME_ZIP=$(ls "${PUBLISH_DIR}"/*-${VERSION}-chrome.zip | head -1)
FIREFOX_ZIP=$(ls "${PUBLISH_DIR}"/*-${VERSION}-firefox.zip | head -1)
SOURCES_ZIP=$(ls "${PUBLISH_DIR}"/*-${VERSION}-sources.zip | head -1)

echo "  chrome:  ${CHROME_ZIP}"
echo "  firefox: ${FIREFOX_ZIP}"
echo "  sources: ${SOURCES_ZIP}"

SUBMIT_ARGS=()
if [ "$SKIP_CHROME" -eq 0 ]; then
  SUBMIT_ARGS+=(--chrome-zip "${CHROME_ZIP}")
fi
if [ "$SKIP_FIREFOX" -eq 0 ]; then
  SUBMIT_ARGS+=(--firefox-zip "${FIREFOX_ZIP}" --firefox-sources-zip "${SOURCES_ZIP}")
fi

echo "Submitting to stores..."
if [ -n "$DRY_RUN" ]; then
  bun run wxt submit "$DRY_RUN" "${SUBMIT_ARGS[@]}"
else
  bun run wxt submit "${SUBMIT_ARGS[@]}"
fi

echo ""
echo "Done. Zips retained in ${PUBLISH_DIR}/ for record."
