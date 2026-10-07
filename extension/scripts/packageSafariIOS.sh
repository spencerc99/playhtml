#!/bin/bash
# ABOUTME: Packages the Safari build into an iOS app project for local device testing.
# ABOUTME: Separate from the macOS release path; it never archives or uploads anything.

set -euo pipefail

# Usage: scripts/packageSafariIOS.sh [--simulator] [--skip-build]
#   --simulator   Build the generated project for the iOS Simulator without
#                 signing, to check that it compiles. Without it, the script
#                 opens the project in Xcode so you can run it on an iPhone.
#   --skip-build  Reuse an existing Safari build in publish/safari-mv3.
#
# Set APPLE_TEAM_ID to have the project signed with your team automatically.

SIMULATOR=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --simulator) SIMULATOR=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$EXTENSION_DIR"

SAFARI_BUNDLE_ID="${SAFARI_BUNDLE_ID:-online.wewere.app}"
SAFARI_BUILD_DIR="publish/safari-mv3"
IOS_PROJECT_ROOT="publish/safari-ios-app"
APP_NAME="we were online"
PROJECT_PATH="${IOS_PROJECT_ROOT}/${APP_NAME}/${APP_NAME}.xcodeproj"
PROJECT_FILE="${PROJECT_PATH}/project.pbxproj"
# Safari 18 is the floor the macOS app already targets; iOS 18 ships it.
IOS_DEPLOYMENT_TARGET="18.0"
GENERATED_APP_BUNDLE_ID="${SAFARI_BUNDLE_ID%.*}.we-were-online"

if [ "$SKIP_BUILD" -eq 0 ]; then
  WXT_OUT_DIR=publish bun run build:safari
fi

if [ ! -f "${SAFARI_BUILD_DIR}/manifest.json" ]; then
  echo "Safari build is missing at ${SAFARI_BUILD_DIR}."
  exit 1
fi

rm -rf "$IOS_PROJECT_ROOT"
xcrun safari-web-extension-packager \
  --project-location "$IOS_PROJECT_ROOT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$SAFARI_BUNDLE_ID" \
  --swift \
  --ios-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  "$SAFARI_BUILD_DIR"

# The packager derives the app's bundle id from the app name. Use the same id
# as the macOS app so both can later live under one App Store record.
if grep -q "$GENERATED_APP_BUNDLE_ID" "$PROJECT_FILE"; then
  sed -i '' "s/${GENERATED_APP_BUNDLE_ID}/${SAFARI_BUNDLE_ID}/g" "$PROJECT_FILE"
fi
sed -i '' "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]*;/IPHONEOS_DEPLOYMENT_TARGET = ${IOS_DEPLOYMENT_TARGET};/g" "$PROJECT_FILE"

if [ -n "${APPLE_TEAM_ID:-}" ]; then
  sed -i '' "s/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Automatic;\\
                DEVELOPMENT_TEAM = ${APPLE_TEAM_ID};/g" "$PROJECT_FILE"
fi

if [ "$SIMULATOR" -eq 1 ]; then
  xcodebuild \
    -quiet \
    -project "$PROJECT_PATH" \
    -scheme "$APP_NAME" \
    -configuration Debug \
    -destination "generic/platform=iOS Simulator" \
    CODE_SIGNING_ALLOWED=NO \
    build
  echo "iOS Simulator build succeeded."
  exit 0
fi

open "$PROJECT_PATH"
echo "Opened ${PROJECT_PATH}."
echo "In Xcode, pick your iPhone as the run destination and press Run."
echo "Then on the iPhone: Settings > Apps > Safari > Extensions > we were online,"
echo "turn it on, and allow it on all websites."
