// ABOUTME: Verifies package metadata and build config for the React bindings.
// ABOUTME: Keeps the React package connected to the app's playhtml client.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("@playhtml/react package contract", () => {
  it("requires the app to provide the playhtml runtime boundary", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.dependencies).not.toHaveProperty("playhtml");
    expect(packageJson.dependencies).not.toHaveProperty("@playhtml/common");
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

  it("leaves playhtml as a runtime import in the library bundle", () => {
    const viteConfigSource = readFileSync(
      path.resolve(process.cwd(), "vite.config.ts"),
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
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toContain('"@playhtml/common"');
    }
  });
});
