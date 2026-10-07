// ABOUTME: Verifies Safari releases package only the supported macOS app.
// ABOUTME: Locks the deployment floor to macOS systems capable of running Safari 18.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

test("packages only the macOS Safari app", async () => {
  const script = await readFile(path.join(process.cwd(), "scripts/submitSafari.sh"), "utf8");

  expect(script).toContain("--macos-only");
  expect(script).toContain('SAFARI_BUNDLE_ID="${SAFARI_BUNDLE_ID:-online.wewere.app}"');
  expect(script).toContain('MACOS_DEPLOYMENT_TARGET="13.0"');
  expect(script).toContain(
    'GENERATED_APP_BUNDLE_ID="${SAFARI_BUNDLE_ID%.*}.we-were-online"',
  );
  expect(script).toContain("s/${GENERATED_APP_BUNDLE_ID}/${SAFARI_BUNDLE_ID}/g");
  expect(script).toContain("public.app-category.lifestyle");
  expect(script).toContain('"MACOSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}"');
  expect(script).toContain('if [ -n "${APPLE_TEAM_ID:-}" ]; then');
  expect(script).toContain("SIGNING_CONFIGURATION_COUNT");
  expect(script).toContain("DEVELOPMENT_TEAM = ${APPLE_TEAM_ID};");
  expect(script).toContain('-scheme "$APP_NAME"');
  expect(script).not.toContain("IPHONEOS_DEPLOYMENT_TARGET");
  expect(script).not.toContain("(macOS)");
  expect(script).not.toContain("(iOS)");
  expect(script).not.toContain("generic/platform=iOS");
});

test("uses the App Store version independently from other extension stores", async () => {
  const [script, releaseScript, workflow] = await Promise.all([
    readFile(path.join(process.cwd(), "scripts/submitSafari.sh"), "utf8"),
    readFile(path.join(process.cwd(), "release.sh"), "utf8"),
    readFile(path.join(process.cwd(), "../.github/workflows/extension-release.yml"), "utf8"),
  ]);

  expect(script).toContain(': "${VERSION:?VERSION is required for a Safari upload}"');
  expect(releaseScript).toContain('SAFARI_VERSION=$(node scripts/safariRelease.mjs prepare)');
  expect(releaseScript).toContain('VERSION="$SAFARI_VERSION" scripts/submitSafari.sh');
  expect(releaseScript).toContain('VERSION="$SAFARI_VERSION" node scripts/safariRelease.mjs complete');
  expect(workflow).toContain("VERSION: ${{ steps.safari-version.outputs.version }}");
  expect(workflow).toContain("run: node scripts/safariRelease.mjs complete");
  expect(workflow).toContain("review-safari-build:");
  expect(workflow).toContain("env.REVIEW_SAFARI_BUILD == ''");
});
