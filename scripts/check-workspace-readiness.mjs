// ABOUTME: Checks whether a playhtml checkout has safe, complete generated workspace artifacts.
// ABOUTME: Reports missing builds and emitted JavaScript that shadows TypeScript sources.

import { execFileSync } from "node:child_process";
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

function listGitFiles(root, args) {
  return execFileSync("git", ["-C", root, "ls-files", "-z", ...args], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

export function findShadowingJavaScript(root) {
  const sourcePathspecs = [
    ":(glob)packages/*/src/**/*.js",
    ":(glob)extension/src/**/*.js",
  ];
  const trackedTypeScript = new Set(
    listGitFiles(root, [
      "--",
      ":(glob)packages/*/src/**/*.ts",
      ":(glob)packages/*/src/**/*.tsx",
      ":(glob)extension/src/**/*.ts",
      ":(glob)extension/src/**/*.tsx",
    ]),
  );
  const untrackedJavaScript = [
    ...listGitFiles(root, [
      "--others",
      "--exclude-standard",
      "--",
      ...sourcePathspecs,
    ]),
    ...listGitFiles(root, [
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ...sourcePathspecs,
    ]),
  ];

  return untrackedJavaScript
    .filter((path) => {
      const sourcePath = path.slice(0, -".js".length);
      return (
        trackedTypeScript.has(`${sourcePath}.ts`) ||
        trackedTypeScript.has(`${sourcePath}.tsx`)
      );
    })
    .sort();
}

export function formatWorkspaceReadinessFailure(
  missingArtifacts,
  shadowingJavaScript = [],
) {
  const details = missingArtifacts.map(
    ({ path, repair }) => `  - Missing ${path}. ${repair}`,
  );
  details.push(
    ...shadowingJavaScript.map(
      (path) =>
        `  - ${path} shadows a tracked TypeScript source. Remove the emitted JavaScript file.`,
    ),
  );
  return ["Workspace is not ready:", ...details].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missingArtifacts = findMissingWorkspaceArtifacts(workspaceRoot);
  const shadowingJavaScript = findShadowingJavaScript(workspaceRoot);
  if (missingArtifacts.length > 0 || shadowingJavaScript.length > 0) {
    console.error(
      formatWorkspaceReadinessFailure(missingArtifacts, shadowingJavaScript),
    );
    process.exitCode = 1;
  } else {
    console.log("Workspace is ready.");
  }
}
