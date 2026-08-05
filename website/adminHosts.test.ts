// ABOUTME: Verifies admin console PartyKit host presets.
// ABOUTME: Ensures operator requests use the same API domains as the runtime defaults.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const ADMIN_HOST_SOURCE_PATHS = [
  path.join(import.meta.dir, "admin.tsx"),
  path.join(import.meta.dir, "test/admin.tsx"),
  path.join(import.meta.dir, "adminHosts.ts"),
];

const CUSTOM_API_HOSTS = [
  "https://api.playhtml.fun",
  "https://api-staging.playhtml.fun",
];

const WORKERS_DEV_PARTYKIT_HOSTS = [
  "https://playhtml.spencerc99.workers.dev",
  "https://playhtml-staging.spencerc99.workers.dev",
];

function readAdminHostSources(): string {
  return ADMIN_HOST_SOURCE_PATHS.filter(existsSync)
    .map((sourcePath) => readFileSync(sourcePath, "utf8"))
    .join("\n");
}

describe("admin PartyKit hosts", () => {
  test("targets the custom API domains", () => {
    const adminHostSources = readAdminHostSources();

    for (const host of CUSTOM_API_HOSTS) {
      expect(adminHostSources.includes(host), host).toBe(true);
    }

    for (const host of WORKERS_DEV_PARTYKIT_HOSTS) {
      expect(adminHostSources.includes(host), host).toBe(false);
    }
  });
});
