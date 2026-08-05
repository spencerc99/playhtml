// ABOUTME: Tests package version outcomes produced by the Changesets release config.
// ABOUTME: Guards peer dependency releases from forcing unnecessary major bumps.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Changesets release versioning", () => {
  it("keeps React on a patch release when a compatible playhtml peer gets a minor release", () => {
    const fixture = mkdtempSync(join(tmpdir(), "playhtml-changeset-versioning-"));
    const changesetDir = join(fixture, ".changeset");
    mkdirSync(changesetDir, { recursive: true });
    mkdirSync(join(fixture, "apps/docs"), { recursive: true });
    mkdirSync(join(fixture, "extension"), { recursive: true });
    mkdirSync(join(fixture, "extension/website"), { recursive: true });
    mkdirSync(join(fixture, "extension/worker"), { recursive: true });
    mkdirSync(join(fixture, "packages/playhtml"), { recursive: true });
    mkdirSync(join(fixture, "packages/react"), { recursive: true });

    cpSync(join(repoRoot, ".changeset/config.json"), join(changesetDir, "config.json"));
    writeJson(join(fixture, "package.json"), {
      name: "playhtml-release-fixture",
      private: true,
      workspaces: [
        "apps/docs",
        "extension",
        "extension/website",
        "extension/worker",
        "packages/playhtml",
        "packages/react",
      ],
      devDependencies: {
        "@changesets/cli": "^2.27.9",
      },
    });
    writeJson(join(fixture, "packages/playhtml/package.json"), {
      name: "playhtml",
      version: "2.11.3",
    });
    writeJson(join(fixture, "packages/react/package.json"), {
      name: "@playhtml/react",
      version: "1.0.1",
      devDependencies: {
        playhtml: "workspace:^",
      },
      peerDependencies: {
        playhtml: "workspace:^",
      },
    });
    writeJson(join(fixture, "apps/docs/package.json"), {
      name: "@playhtml/docs-site",
      version: "0.0.0",
      private: true,
    });
    writeJson(join(fixture, "extension/package.json"), {
      name: "@playhtml/extension",
      version: "0.0.0",
      private: true,
    });
    writeJson(join(fixture, "extension/website/package.json"), {
      name: "wewere-online",
      version: "0.0.0",
      private: true,
    });
    writeJson(join(fixture, "extension/worker/package.json"), {
      name: "@playhtml/extension-worker",
      version: "0.0.0",
      private: true,
    });
    writeFileSync(
      join(changesetDir, "core-minor.md"),
      ["---", '"playhtml": minor', "---", "", "Release a compatible core feature.", ""].join(
        "\n",
      ),
    );
    writeFileSync(
      join(changesetDir, "react-patch.md"),
      ["---", '"@playhtml/react": patch', "---", "", "Fix a React binding bug.", ""].join(
        "\n",
      ),
    );

    execFileSync(resolveChangesetBin(), ["version"], {
      cwd: fixture,
      encoding: "utf8",
      env: process.env,
      stdio: "pipe",
    });

    const reactPackageJson = JSON.parse(
      readFileSync(join(fixture, "packages/react/package.json"), "utf8"),
    );
    assert.equal(reactPackageJson.version, "1.0.2");
  });
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveChangesetBin() {
  if (process.env.CHANGESET_BIN) {
    return process.env.CHANGESET_BIN;
  }
  return join(repoRoot, "node_modules/.bin/changeset");
}
