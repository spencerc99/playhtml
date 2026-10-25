#!/bin/bash
# ABOUTME: Packages the Safari build into an iOS app project for local device testing.
# ABOUTME: Separate from the macOS release path; uploadSafariIOS.sh archives what it makes for TestFlight.

set -euo pipefail

# Usage: scripts/packageSafariIOS.sh [--simulator] [--skip-build] [--project-only]
#   --simulator     Build the generated project for the iOS Simulator with an
#                   ad-hoc signature (no Apple account). Without it, the script
#                   opens the project in Xcode so you can run it on an iPhone.
#   --skip-build    Reuse an existing Safari build in publish/safari-mv3.
#   --project-only  Generate the Xcode project and stop, for uploadSafariIOS.sh.
#
# Set APPLE_TEAM_ID to have the project signed with your team automatically.

SIMULATOR=0
SKIP_BUILD=0
PROJECT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --simulator) SIMULATOR=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --project-only) PROJECT_ONLY=1 ;;
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
# The extension's own icon tops out at 128px; iOS needs one opaque 1024px icon.
APP_ICON_SOURCE="ios/AppIcon-1024.png"
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

# Replace the packager's icon set, scaled up from the 128px extension icon,
# with the single 1024px icon iOS builds every other size from.
APP_ICON_SET=$(find "$IOS_PROJECT_ROOT" -type d -name AppIcon.appiconset | head -n 1)
if [ -z "$APP_ICON_SET" ]; then
  echo "The generated project has no AppIcon set."
  exit 1
fi
rm -f "${APP_ICON_SET}"/*
cp "$APP_ICON_SOURCE" "${APP_ICON_SET}/AppIcon-1024.png"
cat > "${APP_ICON_SET}/Contents.json" <<'JSON'
{
  "images" : [
    {
      "filename" : "AppIcon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON

# The app only uses the system's HTTPS, which is exempt from export
# compliance. Declaring it lets each TestFlight build reach testers without
# a compliance question in App Store Connect.
while IFS= read -r plist; do
  if ! /usr/libexec/PlistBuddy -c "Print :NSExtension" "$plist" >/dev/null 2>&1; then
    plutil -replace ITSAppUsesNonExemptEncryption -bool NO "$plist"
  fi
done < <(find "$IOS_PROJECT_ROOT" -name Info.plist -not -path "*/build/*")

# The app runs the extension in its own browser through WKWebExtension, where
# a service worker background never starts (the context reports
# backgroundContentFailedToLoad without running a line of it). The same bundle
# runs as a non-persistent background page, which Safari on iOS also supports.
EXTENSION_MANIFEST="${IOS_PROJECT_ROOT}/${APP_NAME}/${APP_NAME} Extension/Resources/manifest.json"
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  const worker = manifest.background && manifest.background.service_worker;
  if (!worker) throw new Error("The Safari manifest has no background service worker to convert");
  manifest.background = { scripts: [worker], persistent: false };
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
' "$EXTENSION_MANIFEST"

# Replace the packager's placeholder home screen with ours. The app bundles only
# the files the packager listed, so the fonts are inlined into Style.css from
# the extension's own build rather than shipped as separate files.
APP_SOURCES="${IOS_PROJECT_ROOT}/${APP_NAME}/${APP_NAME}"
APP_RESOURCES="${APP_SOURCES}/Resources"
cp ios/app/Main.html "${APP_RESOURCES}/Base.lproj/Main.html"
cp ios/app/ViewController.swift "${APP_SOURCES}/ViewController.swift"
FONT_FACES=""
add_font_face() {
  local family="$1" style="$2" weight="$3" file_prefix="$4"
  local file
  file=$(find "${SAFARI_BUILD_DIR}/assets" -name "${file_prefix}-*.woff2" | head -n 1)
  if [ -z "$file" ]; then
    echo "The Safari build has no ${file_prefix} font for the app's home screen."
    exit 1
  fi
  FONT_FACES+="@font-face{font-family:\"${family}\";font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,$(base64 < "$file" | tr -d '\n')) format(\"woff2\");}"
}
add_font_face "Source Serif 4" italic 200 source-serif-4-latin-200-italic
add_font_face "Lora" normal 600 lora-latin-600-normal
add_font_face "Atkinson Hyperlegible" normal 400 atkinson-hyperlegible-latin-400-normal
add_font_face "Atkinson Hyperlegible" normal 700 atkinson-hyperlegible-latin-700-normal
add_font_face "Martian Mono" normal 500 martian-mono-latin-500-normal
FONT_FACES="$FONT_FACES" node -e '
  const fs = require("node:fs");
  const [source, target] = process.argv.slice(1);
  const css = fs.readFileSync(source, "utf8");
  if (!css.includes("/*@@FONTS@@*/")) throw new Error("Style.css has no fonts placeholder");
  fs.writeFileSync(target, css.replace("/*@@FONTS@@*/", process.env.FONT_FACES));
' ios/app/Style.css "${APP_RESOURCES}/Style.css"

if [ "$PROJECT_ONLY" -eq 1 ]; then
  echo "Generated ${PROJECT_PATH}."
  exit 0
fi

if [ "$SIMULATOR" -eq 1 ]; then
  # Ad-hoc sign instead of skipping signing: Safari in the Simulator refuses
  # to enable an extension whose appex carries no signature, and the switch
  # in Manage Extensions flips straight back off.
  xcodebuild \
    -quiet \
    -project "$PROJECT_PATH" \
    -scheme "$APP_NAME" \
    -configuration Debug \
    -destination "generic/platform=iOS Simulator" \
    CODE_SIGN_IDENTITY=- \
    CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM= \
    PROVISIONING_PROFILE_SPECIFIER= \
    build
  echo "iOS Simulator build succeeded."
  exit 0
fi

open "$PROJECT_PATH"
echo "Opened ${PROJECT_PATH}."
echo "In Xcode, pick your iPhone as the run destination and press Run."
echo "Then on the iPhone: Settings > Apps > Safari > Extensions > we were online,"
echo "turn it on, and allow it on all websites."
