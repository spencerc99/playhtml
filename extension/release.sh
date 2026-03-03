#!/bin/bash
# ABOUTME: Build and publish extension as a GitHub release for beta distribution
# ABOUTME: Usage: ./release.sh v0.1.0 ["optional release notes"]

set -euo pipefail

VERSION="${1:-}"
NOTES="${2:-"closed beta release"}"
TAG="extension-${VERSION}"

if [ -z "$VERSION" ]; then
  echo "Usage: ./release.sh <version> [\"release notes\"]"
  echo "  e.g. ./release.sh v0.1.0"
  echo "  e.g. ./release.sh v0.1.1 \"fixed cursor color bug\""
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

ZIP_NAME="we-were-online-${VERSION}.zip"

echo "Building extension..."
bun run build

echo "Packaging ${ZIP_NAME}..."
cd dist/chrome-mv3
zip -r "../../${ZIP_NAME}" .
cd "$SCRIPT_DIR"

echo "Creating GitHub release ${TAG}..."
gh release create "$TAG" "$ZIP_NAME" \
  --title "we were online extension ${VERSION}" \
  --notes "$NOTES" \
  --prerelease

RELEASE_URL=$(gh release view "$TAG" --json url -q .url)
echo ""
echo "Released ${TAG}"
echo "${RELEASE_URL}"

rm "$ZIP_NAME"
