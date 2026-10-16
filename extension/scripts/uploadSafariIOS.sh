#!/bin/bash
# ABOUTME: Archives the iOS Safari app and uploads it to App Store Connect for TestFlight.
# ABOUTME: Builds on packageSafariIOS.sh's project; separate from the macOS release in submitSafari.sh.

set -euo pipefail

# Usage: scripts/uploadSafariIOS.sh [--skip-build]
#   --skip-build  Reuse an existing Safari build in publish/safari-mv3.
#
# Requires APPLE_TEAM_ID, APPLE_API_KEY_ID, APPLE_API_ISSUER_ID and
# APPLE_API_KEY_PATH (the downloaded .p8 key). BUILD_NUMBER must grow with
# every upload; IOS_VERSION is the TestFlight version and defaults to 1.0.

PACKAGE_ARGS=(--project-only)
for arg in "$@"; do
  case "$arg" in
    --skip-build) PACKAGE_ARGS+=(--skip-build) ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER_ID:?APPLE_API_ISSUER_ID is required}"
: "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH is required}"
: "${BUILD_NUMBER:?BUILD_NUMBER is required}"
IOS_VERSION="${IOS_VERSION:-1.0}"

if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "Apple API key was not found at ${APPLE_API_KEY_PATH}."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$EXTENSION_DIR"

"${SCRIPT_DIR}/packageSafariIOS.sh" "${PACKAGE_ARGS[@]}"

IOS_PROJECT_ROOT="publish/safari-ios-app"
APP_NAME="we were online"
PROJECT_PATH="${IOS_PROJECT_ROOT}/${APP_NAME}/${APP_NAME}.xcodeproj"
ARCHIVE_PATH="${IOS_PROJECT_ROOT}/archives/iOS.xcarchive"
EXPORT_OPTIONS="${IOS_PROJECT_ROOT}/ExportOptions.plist"

AUTHENTICATION=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$APPLE_API_KEY_PATH"
  -authenticationKeyID "$APPLE_API_KEY_ID"
  -authenticationKeyIssuerID "$APPLE_API_ISSUER_ID"
)

mkdir -p "$(dirname "$ARCHIVE_PATH")"
plutil -create xml1 "$EXPORT_OPTIONS"
plutil -insert method -string app-store-connect "$EXPORT_OPTIONS"
plutil -insert destination -string upload "$EXPORT_OPTIONS"
plutil -insert signingStyle -string automatic "$EXPORT_OPTIONS"
plutil -insert teamID -string "$APPLE_TEAM_ID" "$EXPORT_OPTIONS"
plutil -insert manageAppVersionAndBuildNumber -bool false "$EXPORT_OPTIONS"

xcodebuild \
  -quiet \
  -project "$PROJECT_PATH" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  "MARKETING_VERSION=${IOS_VERSION}" \
  "CURRENT_PROJECT_VERSION=${BUILD_NUMBER}" \
  "DEVELOPMENT_TEAM=${APPLE_TEAM_ID}" \
  CODE_SIGN_STYLE=Automatic \
  INFOPLIST_KEY_ITSAppUsesNonExemptEncryption=NO \
  "${AUTHENTICATION[@]}" \
  archive

xcodebuild \
  -quiet \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  "${AUTHENTICATION[@]}"

echo "Uploaded iOS build ${IOS_VERSION} (${BUILD_NUMBER}) to App Store Connect."
echo "Internal TestFlight testers get it once Apple finishes processing."
