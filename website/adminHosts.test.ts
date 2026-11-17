// ABOUTME: Verifies admin console PartyKit host presets.
// ABOUTME: Ensures operator requests use the same API domains and send the token only in a header.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { adminFetch } from "./adminHosts";

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

describe("adminFetch", () => {
  test("sends the token in the Authorization header, not the URL, and keeps other headers", async () => {
    const seen: {
      url: string;
      authorization: string | null;
      contentType: string | null;
      method: string;
    }[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        seen.push({
          url: request.url,
          authorization: request.headers.get("Authorization"),
          contentType: request.headers.get("Content-Type"),
          method: request.method,
        });
        return new Response("ok");
      },
    });

    try {
      const response = await adminFetch(
        `http://127.0.0.1:${server.port}/parties/main/room/admin/hard-reset`,
        "admin-secret",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      expect(await response.text()).toBe("ok");
    } finally {
      server.stop(true);
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].authorization).toBe("Bearer admin-secret");
    expect(seen[0].contentType).toBe("application/json");
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).not.toContain("admin-secret");
    expect(new URL(seen[0].url).search).toBe("");
  });

  test("the admin console never puts the token in a request URL", () => {
    const source = readFileSync(
      path.join(import.meta.dir, "admin.tsx"),
      "utf8",
    );
    expect(source.includes("token=")).toBe(false);
    expect(/await fetch\(/.test(source)).toBe(false);
  });
});
