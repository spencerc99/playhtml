#!/bin/bash
# ABOUTME: End-to-end check of the iPhone app and Safari: installs a Simulator build and taps through both with UI tests.
# ABOUTME: Runs each test (ios/check/) on its own wiped Simulator, so every run starts where a new person does.

set -euo pipefail

# Usage: scripts/checkSafariIOSApp.sh [--skip-build] [--only <TestClass>]
#   --skip-build  Reuse the last Simulator build instead of packaging again.
#   --only        Run one test class, for example SafariSyncCheck.
# Runs on its own Simulator, "WWO App Check", which it creates once and erases
# before each test: Safari keeps the extension's data even when the app is
# reinstalled, so only a wiped phone starts clean. Other Simulators are untouched.
# Needs Xcode, xcodegen, and network access (the tests load live pages).
# Screenshots from the run land in publish/ios-app-check/screenshots.

SKIP_BUILD=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --only) ONLY="$2"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$EXTENSION_DIR"

BUNDLE_ID="online.wewere.app"
CHECK_ROOT="publish/ios-app-check"
DEVICE_NAME="WWO App Check"
DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
TESTS=(AppBrowserCheck SafariSyncCheck)
if [ -n "$ONLY" ]; then TESTS=("$ONLY"); fi

if ! command -v xcodegen >/dev/null; then
  echo "xcodegen is required: brew install xcodegen"
  exit 1
fi

DEVICE=$(xcrun simctl list devices -j | node -e '
  const name = process.argv[1];
  const devices = Object.values(JSON.parse(require("fs").readFileSync(0, "utf8")).devices).flat();
  const found = devices.find((device) => device.name === name && device.isAvailable);
  process.stdout.write(found ? found.udid : "");
' "$DEVICE_NAME")
if [ -z "$DEVICE" ]; then
  RUNTIME=$(xcrun simctl list runtimes -j | node -e '
    const runtimes = JSON.parse(require("fs").readFileSync(0, "utf8")).runtimes
      .filter((runtime) => runtime.platform === "iOS" && runtime.isAvailable);
    if (!runtimes.length) throw new Error("No iOS Simulator runtime is installed.");
    process.stdout.write(runtimes.at(-1).identifier);
  ')
  DEVICE=$(xcrun simctl create "$DEVICE_NAME" "$DEVICE_TYPE" "$RUNTIME")
fi

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

rm -rf "$CHECK_ROOT"
mkdir -p "$CHECK_ROOT/screenshots"
xcodegen generate --quiet --spec ios/check/project.yml --project "$CHECK_ROOT"

for test in "${TESTS[@]}"; do
  echo "Running ${test} on a wiped ${DEVICE_NAME}..."
  xcrun simctl shutdown "$DEVICE" 2>/dev/null || true
  xcrun simctl erase "$DEVICE"
  xcrun simctl boot "$DEVICE"
  xcrun simctl bootstatus "$DEVICE" -b >/dev/null
  xcrun simctl install "$DEVICE" "$APP_PATH"

  result="${CHECK_ROOT}/${test}.xcresult"
  status=0
  xcodebuild \
    -quiet \
    -project "${CHECK_ROOT}/WWOAppCheck.xcodeproj" \
    -scheme WWOAppCheck \
    -destination "id=${DEVICE}" \
    -resultBundlePath "$result" \
    -only-testing:"WWOAppCheck/${test}" \
    test || status=$?

  # Kept for a failed run too: its screen recording shows where it stopped.
  xcrun xcresulttool export attachments \
    --path "$result" \
    --output-path "${CHECK_ROOT}/screenshots/${test}" >/dev/null
  if [ "$status" -ne 0 ]; then
    echo "${test} failed. Recording and screenshots: ${CHECK_ROOT}/screenshots/${test}"
    exit "$status"
  fi

  # Both copies of the extension wrote their setup to the shared folder; it
  # has to be one person, set up on both sides.
  if [ "$test" = "SafariSyncCheck" ]; then
    group=$(xcrun simctl get_app_container "$DEVICE" "$BUNDLE_ID" groups | awk '{print $2}')
    node -e '
      const fs = require("fs");
      const zlib = require("zlib");
      const folder = process.argv[1] + "/wwo-sync";
      const read = (side) =>
        JSON.parse(zlib.gunzipSync(fs.readFileSync(`${folder}/${side}.state`)));
      const safari = read("safari");
      const app = read("app");
      const key = (state) => state.settings.playerIdentity.public.publicKey;
      if (!safari.onboarded || !app.onboarded) throw new Error("A side is not set up");
      if (key(safari) !== key(app)) throw new Error("Safari and the app have different identities");
      console.log("Safari and the app share one identity:", key(app).slice(0, 18) + "...");
    ' "$group"
  fi
done

xcrun simctl shutdown "$DEVICE" 2>/dev/null || true
echo "iPhone app check passed. Screenshots: ${CHECK_ROOT}/screenshots"
