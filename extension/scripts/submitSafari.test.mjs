// ABOUTME: Verifies Safari release packages target supported Safari runtimes.
// ABOUTME: Locks the Apple platform floors to systems capable of running Safari 18.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

test("requires Safari 18 capable Apple platforms", async () => {
  const script = await readFile(path.join(process.cwd(), "scripts/submitSafari.sh"), "utf8");

  expect(script).toContain('MACOS_DEPLOYMENT_TARGET="13.0"');
  expect(script).toContain('IOS_DEPLOYMENT_TARGET="18.0"');
  expect(script).toContain('"MACOSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}"');
  expect(script).toContain('"IPHONEOS_DEPLOYMENT_TARGET=${IOS_DEPLOYMENT_TARGET}"');
});
