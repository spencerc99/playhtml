// ABOUTME: Tests workspace readiness checks against complete and incomplete checkout fixtures.
// ABOUTME: Verifies that each missing artifact reports a precise recovery command.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  findMissingWorkspaceArtifacts,
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
