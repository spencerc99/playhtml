#!/bin/bash
# ABOUTME: Packages Safari extension files into a macOS app.
# ABOUTME: Validates an unsigned build or uploads a signed archive to App Store Connect.

set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$EXTENSION_DIR"

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
SAFARI_BUNDLE_ID="${SAFARI_BUNDLE_ID:-online.wewere.app}"
SAFARI_BUILD_DIR="${SAFARI_BUILD_DIR:-publish/safari-mv3}"
SAFARI_PROJECT_ROOT="publish/safari-app"
APP_NAME="we were online"
PROJECT_PATH="${SAFARI_PROJECT_ROOT}/${APP_NAME}/${APP_NAME}.xcodeproj"
PROJECT_FILE="${PROJECT_PATH}/project.pbxproj"
MACOS_DEPLOYMENT_TARGET="13.0"
GENERATED_APP_BUNDLE_ID="${SAFARI_BUNDLE_ID%.*}.we-were-online"

if [ "$DRY_RUN" -eq 0 ]; then
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
fi

if [ ! -f "${SAFARI_BUILD_DIR}/manifest.json" ]; then
  echo "Safari build is missing at ${SAFARI_BUILD_DIR}."
  echo "Run WXT_OUT_DIR=publish bun run zip:safari first."
  exit 1
fi

rm -rf "$SAFARI_PROJECT_ROOT"
PACKAGER_OUTPUT=$(xcrun safari-web-extension-packager \
  --project-location "$SAFARI_PROJECT_ROOT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$SAFARI_BUNDLE_ID" \
  --swift \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  "$SAFARI_BUILD_DIR" 2>&1)
echo "$PACKAGER_OUTPUT"

if echo "$PACKAGER_OUTPUT" | grep -q "Warning:"; then
  echo "Safari packager reported unsupported manifest features."
  exit 1
fi

if ! grep -q "$GENERATED_APP_BUNDLE_ID" "$PROJECT_FILE"; then
  echo "Safari packager did not generate the expected app bundle identifier."
  exit 1
fi
sed -i '' "s/${GENERATED_APP_BUNDLE_ID}/${SAFARI_BUNDLE_ID}/g" "$PROJECT_FILE"

if [ -n "${APPLE_TEAM_ID:-}" ]; then
  SIGNING_CONFIGURATION_COUNT=$(grep -c "CODE_SIGN_STYLE = Automatic;" "$PROJECT_FILE")
  if [ "$SIGNING_CONFIGURATION_COUNT" -ne 4 ]; then
    echo "Safari project did not contain the expected signing configurations."
    exit 1
  fi
  sed -i '' "s/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Automatic;\\
                DEVELOPMENT_TEAM = ${APPLE_TEAM_ID};/g" "$PROJECT_FILE"
fi

COMMON_BUILD_SETTINGS=(
  -quiet
  -project "$PROJECT_PATH"
  -configuration Release
  "MARKETING_VERSION=${VERSION}"
  "CURRENT_PROJECT_VERSION=${BUILD_NUMBER}"
  "MACOSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}"
)

if [ "$DRY_RUN" -eq 1 ]; then
  xcodebuild "${COMMON_BUILD_SETTINGS[@]}" \
    -scheme "$APP_NAME" \
    -destination "generic/platform=macOS" \
    CODE_SIGNING_ALLOWED=NO \
    build
  exit 0
fi

: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER_ID:?APPLE_API_ISSUER_ID is required}"
: "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH is required}"

if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "Apple API key was not found at ${APPLE_API_KEY_PATH}."
  exit 1
fi

AUTHENTICATION=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$APPLE_API_KEY_PATH"
  -authenticationKeyID "$APPLE_API_KEY_ID"
  -authenticationKeyIssuerID "$APPLE_API_ISSUER_ID"
)
ARCHIVE_DIR="${SAFARI_PROJECT_ROOT}/archives"
EXPORT_OPTIONS="${SAFARI_PROJECT_ROOT}/ExportOptions.plist"

mkdir -p "$ARCHIVE_DIR"
plutil -create xml1 "$EXPORT_OPTIONS"
plutil -insert method -string app-store-connect "$EXPORT_OPTIONS"
plutil -insert destination -string upload "$EXPORT_OPTIONS"
plutil -insert signingStyle -string automatic "$EXPORT_OPTIONS"
plutil -insert teamID -string "$APPLE_TEAM_ID" "$EXPORT_OPTIONS"
plutil -insert manageAppVersionAndBuildNumber -bool false "$EXPORT_OPTIONS"

archive_and_upload_macos() {
  local archive_path="${ARCHIVE_DIR}/macOS.xcarchive"
  xcodebuild "${COMMON_BUILD_SETTINGS[@]}" \
    -scheme "$APP_NAME" \
    -destination "generic/platform=macOS" \
    -archivePath "$archive_path" \
    "DEVELOPMENT_TEAM=${APPLE_TEAM_ID}" \
    CODE_SIGN_STYLE=Automatic \
    "${AUTHENTICATION[@]}" \
    archive

  xcodebuild \
    -quiet \
    -exportArchive \
    -archivePath "$archive_path" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    "${AUTHENTICATION[@]}"
}

archive_and_upload_macos
