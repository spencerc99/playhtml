// ABOUTME: Verifies package metadata and build config for the core package.
// ABOUTME: Keeps generated declarations pointed at public package imports.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("playhtml package contract", () => {
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
});
