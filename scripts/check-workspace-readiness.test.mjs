// ABOUTME: Tests workspace readiness checks against real filesystem and Git fixtures.
// ABOUTME: Verifies recovery messages for missing artifacts and shadowing JavaScript.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  findMissingWorkspaceArtifacts,
  findShadowingJavaScript,
  formatWorkspaceReadinessFailure,
} from "./check-workspace-readiness.mjs";

const fixtureRoots = [];

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function createWorkspaceFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "playhtml-doctor-"));
  fixtureRoots.push(fixtureRoot);
  return fixtureRoot;
}

function writeArtifact(fixtureRoot, path) {
  const artifactPath = join(fixtureRoot, path);
  mkdirSync(join(artifactPath, ".."), { recursive: true });
  writeFileSync(artifactPath, "");
}

function initializeGitFixture(fixtureRoot) {
  execFileSync("git", ["init", "--quiet", fixtureRoot]);
}

test("reports every missing workspace artifact with its repair command", () => {
  const fixtureRoot = createWorkspaceFixture();
  const missingArtifacts = findMissingWorkspaceArtifacts(fixtureRoot);

  assert.deepEqual(
    missingArtifacts.map(({ path }) => path),
    [
      "node_modules",
      "extension/.wxt/tsconfig.json",
      "packages/common/dist/main.d.ts",
      "packages/extension-types/dist/index.d.ts",
      "packages/playhtml/dist/main.d.ts",
      "packages/react/dist/main.d.ts",
    ],
  );
  assert.match(
    formatWorkspaceReadinessFailure(missingArtifacts),
    /Missing node_modules\. Run `bun install --frozen-lockfile`\./,
  );
  assert.match(
    formatWorkspaceReadinessFailure(missingArtifacts),
    /Missing packages\/react\/dist\/main\.d\.ts\. Run `bun run build-packages`\./,
  );
});

test("passes when dependencies, WXT metadata, and package builds exist", () => {
  const fixtureRoot = createWorkspaceFixture();
  mkdirSync(join(fixtureRoot, "node_modules"));
  writeArtifact(fixtureRoot, "extension/.wxt/tsconfig.json");
  writeArtifact(fixtureRoot, "packages/common/dist/main.d.ts");
  writeArtifact(fixtureRoot, "packages/extension-types/dist/index.d.ts");
  writeArtifact(fixtureRoot, "packages/playhtml/dist/main.d.ts");
  writeArtifact(fixtureRoot, "packages/react/dist/main.d.ts");

  assert.deepEqual(findMissingWorkspaceArtifacts(fixtureRoot), []);
});

test("reports ignored JavaScript that shadows tracked TypeScript sources", () => {
  const fixtureRoot = createWorkspaceFixture();
  initializeGitFixture(fixtureRoot);
  writeFileSync(
    join(fixtureRoot, ".gitignore"),
    "packages/*/src/**/*.js\nextension/src/**/*.js\n",
  );
  writeArtifact(fixtureRoot, "packages/playhtml/src/index.ts");
  writeArtifact(fixtureRoot, "extension/src/content.tsx");
  execFileSync("git", [
    "-C",
    fixtureRoot,
    "add",
    ".gitignore",
    "packages/playhtml/src/index.ts",
    "extension/src/content.tsx",
  ]);
  writeArtifact(fixtureRoot, "packages/playhtml/src/index.js");
  writeArtifact(fixtureRoot, "packages/playhtml/src/orphan.js");
  writeArtifact(fixtureRoot, "extension/src/content.js");

  const shadowingJavaScript = findShadowingJavaScript(fixtureRoot);

  assert.deepEqual(shadowingJavaScript, [
    "extension/src/content.js",
    "packages/playhtml/src/index.js",
  ]);
  assert.match(
    formatWorkspaceReadinessFailure([], shadowingJavaScript),
    /packages\/playhtml\/src\/index\.js shadows a tracked TypeScript source\. Remove the emitted JavaScript file\./,
  );
});
