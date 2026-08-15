// ABOUTME: Checks whether a playhtml checkout has generated dependencies and package builds.
// ABOUTME: Reports the exact command that restores each missing workspace artifact.

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredArtifacts = [
  {
    path: "node_modules",
    type: "directory",
    repair: "Run `bun install --frozen-lockfile`.",
  },
  {
    path: "extension/.wxt/tsconfig.json",
    type: "file",
    repair: "Run `bun install --frozen-lockfile` to run the WXT prepare step.",
  },
  {
    path: "packages/common/dist/main.d.ts",
    type: "file",
    repair: "Run `bun run build-packages`.",
  },
  {
    path: "packages/extension-types/dist/index.d.ts",
    type: "file",
    repair: "Run `bun run build-packages`.",
  },
  {
    path: "packages/playhtml/dist/main.d.ts",
    type: "file",
    repair: "Run `bun run build-packages`.",
  },
  {
    path: "packages/react/dist/main.d.ts",
    type: "file",
    repair: "Run `bun run build-packages`.",
  },
];

function artifactExists(root, artifact) {
  const artifactPath = resolve(root, artifact.path);
  if (!existsSync(artifactPath)) {
    return false;
  }

  const artifactStats = statSync(artifactPath);
  return artifact.type === "directory"
    ? artifactStats.isDirectory()
    : artifactStats.isFile();
}

export function findMissingWorkspaceArtifacts(root) {
  return requiredArtifacts.filter((artifact) => !artifactExists(root, artifact));
}

export function formatWorkspaceReadinessFailure(missingArtifacts) {
  const details = missingArtifacts.map(
    ({ path, repair }) => `  - Missing ${path}. ${repair}`,
  );
  return ["Workspace is not ready:", ...details].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missingArtifacts = findMissingWorkspaceArtifacts(workspaceRoot);
  if (missingArtifacts.length > 0) {
    console.error(formatWorkspaceReadinessFailure(missingArtifacts));
    process.exitCode = 1;
  } else {
    console.log("Workspace is ready.");
  }
}
