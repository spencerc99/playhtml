// ABOUTME: Verifies package metadata and build config for the core package.
// ABOUTME: Keeps generated declarations pointed at public package imports.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("playhtml package contract", () => {
  it("does not advertise unsupported CommonJS entry points", () => {
    const packagePaths = [
      "../common/package.json",
      "../extension-types/package.json",
      "../react/package.json",
    ];

    for (const packagePath of packagePaths) {
      const packageJson = JSON.parse(
        readFileSync(path.resolve(process.cwd(), packagePath), "utf8"),
      );

      expect(packageJson.exports["."], packagePath).not.toHaveProperty(
        "require",
      );
    }
  });

  it("keeps @playhtml/common as a package dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.dependencies).toHaveProperty(
      "@playhtml/common",
      "workspace:^",
    );
    expect(packageJson.peerDependencies ?? {}).not.toHaveProperty(
      "@playhtml/common",
    );
  });

  it("rewrites common workspace declaration paths to package imports", () => {
    const viteConfigSource = readFileSync(
      path.resolve(process.cwd(), "vite.config.ts"),
      "utf8",
    );

    expect(viteConfigSource).toContain("beforeWriteFile");
    expect(viteConfigSource).toContain('from "@playhtml/common"');
    expect(viteConfigSource).toContain('import("@playhtml/common")');
  });

  it("publishes self-contained leaf editor declarations", () => {
    const declarationSource = readFileSync(
      path.resolve(process.cwd(), "leafEditor.d.ts"),
      "utf8",
    );

    expect(declarationSource).not.toContain('from "./dist/main"');
    expect(declarationSource).toContain(
      "export declare function parseStateLeafValue",
    );
  });
});
