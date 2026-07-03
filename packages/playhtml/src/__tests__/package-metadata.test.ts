// ABOUTME: Verifies package metadata and build config for the core package.
// ABOUTME: Keeps generated declarations pointed at public package imports.
// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("playhtml package contract", () => {
  it("keeps @playhtml/common as a package dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
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
      resolve(process.cwd(), "vite.config.ts"),
      "utf8",
    );

    expect(viteConfigSource).toContain("beforeWriteFile");
    expect(viteConfigSource).toContain('from "@playhtml/common"');
    expect(viteConfigSource).toContain('import("@playhtml/common")');
  });
});
