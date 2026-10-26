#!/bin/bash
# ABOUTME: End-to-end check of the iPhone app: installs a fresh Simulator build and taps through it with a UI test.
# ABOUTME: Covers the home screen, the in-app browser, the extension's popup, setup and a relaunch (ios/check/).

set -euo pipefail

# Usage: scripts/checkSafariIOSApp.sh [--skip-build] [--device <name or udid>]
#   --skip-build  Reuse the last Simulator build instead of packaging again.
#   --device      Simulator to run on. Defaults to the first booted one.
# Needs Xcode, xcodegen, and network access (the test loads live pages).
# Screenshots from the run land in publish/ios-app-check/screenshots.

SKIP_BUILD=0
DEVICE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --device) DEVICE="$2"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$EXTENSION_DIR"

BUNDLE_ID="online.wewere.app"
CHECK_ROOT="publish/ios-app-check"
RESULT_BUNDLE="${CHECK_ROOT}/result.xcresult"

if ! command -v xcodegen >/dev/null; then
  echo "xcodegen is required: brew install xcodegen"
  exit 1
fi

if [ -z "$DEVICE" ]; then
  DEVICE=$(xcrun simctl list devices booted -j | node -e '
    const devices = Object.values(JSON.parse(require("fs").readFileSync(0, "utf8")).devices).flat();
    if (!devices.length) throw new Error("No booted Simulator. Boot one or pass --device.");
    process.stdout.write(devices[0].udid);
  ')
fi
xcrun simctl boot "$DEVICE" 2>/dev/null || true

if [ "$SKIP_BUILD" -eq 0 ]; then
  ./scripts/packageSafariIOS.sh --simulator
fi

APP_PATH=$(xcodebuild \
  -project "publish/safari-ios-app/we were online/we were online.xcodeproj" \
  -scheme "we were online" \
  -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -showBuildSettings 2>/dev/null | awk -F' = ' '
    / TARGET_BUILD_DIR = / { dir = $2 }
    / WRAPPER_NAME = / && $2 ~ /\.app$/ { app = $2 }
    END { print dir "/" app }')
if [ ! -d "$APP_PATH" ]; then
  echo "No Simulator build at ${APP_PATH}. Run without --skip-build."
  exit 1
fi

# A fresh install, so the run starts where a new person does: before setup.
xcrun simctl uninstall "$DEVICE" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$DEVICE" "$APP_PATH"

rm -rf "$CHECK_ROOT"
mkdir -p "$CHECK_ROOT"
xcodegen generate --quiet --spec ios/check/project.yml --project "$CHECK_ROOT"

xcodebuild \
  -quiet \
  -project "${CHECK_ROOT}/WWOAppCheck.xcodeproj" \
  -scheme WWOAppCheck \
  -destination "id=${DEVICE}" \
  -resultBundlePath "$RESULT_BUNDLE" \
  test

xcrun xcresulttool export attachments \
  --path "$RESULT_BUNDLE" \
  --output-path "${CHECK_ROOT}/screenshots" >/dev/null
echo "iPhone app check passed on ${DEVICE}. Screenshots: ${CHECK_ROOT}/screenshots"
