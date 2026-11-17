// ABOUTME: Verifies package metadata and build config for the React bindings.
// ABOUTME: Keeps the React package connected to the app's playhtml client.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(__dirname, "../..");

describe("@playhtml/react package contract", () => {
  it("requires the app to provide the playhtml runtime boundary", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(packageRoot, "package.json"), "utf8"),
    );

    // A package with no runtime dependencies omits the block entirely.
    const dependencies = packageJson.dependencies ?? {};

    expect(dependencies).not.toHaveProperty("playhtml");
    expect(dependencies).not.toHaveProperty("@playhtml/common");
    expect(packageJson.peerDependencies).toHaveProperty(
      "playhtml",
      "workspace:^",
    );
    expect(packageJson.peerDependencies).not.toHaveProperty("@playhtml/common");
    expect(packageJson.devDependencies).toHaveProperty(
      "playhtml",
      "workspace:^",
    );
    expect(packageJson.devDependencies).not.toHaveProperty("@playhtml/common");
  });

  it("uses the app's React instead of installing its own copy", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(packageRoot, "package.json"), "utf8"),
    );
    const dependencies = packageJson.dependencies ?? {};

    for (const name of ["react", "react-dom"]) {
      expect(dependencies, name).not.toHaveProperty(name);
      expect(packageJson.peerDependencies, name).toHaveProperty(name);
    }
  });

  it("leaves playhtml as a runtime import in the library bundle", () => {
    const viteConfigSource = readFileSync(
      path.resolve(packageRoot, "vite.config.ts"),
      "utf8",
    );

    expect(viteConfigSource).toMatch(/external:\s*\[[^\]]*"playhtml"/s);
    expect(viteConfigSource).not.toContain('"@playhtml/common"');
    expect(viteConfigSource).toContain(
      'import type * as React_2 from "react"',
    );
    expect(viteConfigSource).toContain("reactNamespaceExportBlock");
  });

  it("uses playhtml for shared PlayHTML API imports", () => {
    const sourceFiles = [
      "src/PlayProvider.tsx",
      "src/elements.tsx",
      "src/hooks.ts",
      "src/index.tsx",
      "src/utils.tsx",
      "examples/FridgeWord.tsx",
      "examples/UniquePeoplePill.tsx",
    ];

    for (const file of sourceFiles) {
      const source = readFileSync(path.resolve(packageRoot, file), "utf8");
      expect(source, file).not.toContain('"@playhtml/common"');
    }
  });
});
