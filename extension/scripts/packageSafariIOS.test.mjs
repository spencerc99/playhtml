// ABOUTME: Verifies the iOS Safari packaging script stays a local, iOS-only dev tool.
// ABOUTME: Guards against it archiving, uploading, or reusing the macOS release project.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

test("packages an iOS-only project apart from the macOS release", async () => {
  const script = await readFile(
    path.join(process.cwd(), "scripts/packageSafariIOS.sh"),
    "utf8",
  );

  expect(script).toContain("--ios-only");
  expect(script).not.toContain("--macos-only");
  expect(script).toContain('IOS_PROJECT_ROOT="publish/safari-ios-app"');
  expect(script).not.toContain("publish/safari-app\"");
  expect(script).toContain('SAFARI_BUNDLE_ID="${SAFARI_BUNDLE_ID:-online.wewere.app}"');
  expect(script).toContain('-destination "generic/platform=iOS Simulator"');
  expect(script).not.toContain("-archivePath");
  expect(script).not.toContain("-exportArchive");
});
