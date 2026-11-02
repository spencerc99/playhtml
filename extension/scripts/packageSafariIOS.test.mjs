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

test("ships an opaque 1024px app icon, which iOS requires", async () => {
  const png = await readFile(path.join(process.cwd(), "ios/AppIcon-1024.png"));

  expect(png.readUInt32BE(16)).toBe(1024);
  expect(png.readUInt32BE(20)).toBe(1024);
  // PNG colour type 2 is RGB with no alpha channel.
  expect(png[25]).toBe(2);
});

test("uploads to TestFlight from its own script, not the macOS release", async () => {
  const script = await readFile(
    path.join(process.cwd(), "scripts/uploadSafariIOS.sh"),
    "utf8",
  );

  expect(script).toContain("packageSafariIOS.sh");
  expect(script).toContain("--project-only");
  expect(script).toContain('-destination "generic/platform=iOS"');
  expect(script).toContain("-exportArchive");
  expect(script).not.toContain("publish/safari-app\"");
});

test("installs our own home screen, with links that leave the app", async () => {
  const script = await readFile(
    path.join(process.cwd(), "scripts/packageSafariIOS.sh"),
    "utf8",
  );
  const css = await readFile(path.join(process.cwd(), "ios/app/Style.css"), "utf8");
  const html = await readFile(path.join(process.cwd(), "ios/app/Main.html"), "utf8");
  const controller = await readFile(
    path.join(process.cwd(), "ios/app/ViewController.swift"),
    "utf8",
  );

  expect(script).toContain("cp ios/app/Main.html");
  expect(script).toContain("cp ios/app/ViewController.swift");
  expect(css).toContain("/*@@FONTS@@*/");
  // Inlined fonts arrive as data: URLs, which the page's own policy must allow.
  expect(html).toContain("font-src 'self' data:");
  expect(html).toContain('href="https://wewere.online/commute"');
  expect(controller).toContain("UIApplication.shared.open(url)");
});
