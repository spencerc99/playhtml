// ABOUTME: Covers extension build validation for manifest-referenced files.
// ABOUTME: Protects release uploads from store package validation failures.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { validateExtensionBuild } from "./validateExtensionBuild.mjs";

const tempDirs = [];

afterEach(async () => {
  const removals = tempDirs
    .splice(0)
    .map((dir) => rm(dir, { recursive: true, force: true }));
  await Promise.all(removals);
});

async function makeBuildDir(manifest) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "extension-build-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, "content-scripts"), { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

test("throws when manifest resources are missing from the build directory", async () => {
  const dir = await makeBuildDir({
    manifest_version: 3,
    content_scripts: [
      {
        js: ["content-scripts/content.js"],
      },
    ],
    web_accessible_resources: [
      {
        resources: ["content-scripts/content.css"],
        matches: ["<all_urls>"],
      },
    ],
  });
  await writeFile(path.join(dir, "content-scripts/content.js"), "");

  await expect(validateExtensionBuild(dir)).rejects.toThrow(
    /content-scripts\/content\.css/,
  );
});

test("passes when manifest resources exist in the build directory", async () => {
  const dir = await makeBuildDir({
    manifest_version: 3,
    content_scripts: [
      {
        js: ["content-scripts/content.js"],
        css: ["content-scripts/content.css"],
      },
    ],
  });
  await writeFile(path.join(dir, "content-scripts/content.js"), "");
  await writeFile(path.join(dir, "content-scripts/content.css"), "");

  await expect(validateExtensionBuild(dir)).resolves.toBeUndefined();
});

test("passes when web accessible resource patterns match build files", async () => {
  const dir = await makeBuildDir({
    manifest_version: 3,
    web_accessible_resources: [
      {
        resources: ["inventory/*"],
        matches: ["<all_urls>"],
      },
    ],
  });
  await mkdir(path.join(dir, "inventory"), { recursive: true });
  await writeFile(path.join(dir, "inventory/bottle.svg"), "");

  await expect(validateExtensionBuild(dir)).resolves.toBeUndefined();
});
