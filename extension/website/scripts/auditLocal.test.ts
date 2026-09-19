// ABOUTME: Tests the network boundary protecting local browsing audit artifacts.
// ABOUTME: Rejects LAN, rebinding, and cross-origin requests while permitting local review.

import { describe, expect, test } from "vitest";
import type { IncomingMessage } from "node:http";
import { assertPrivateAuditArtifacts, isLocalAuditRequest } from "./auditLocal";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function request(address: string, host: string, origin?: string, site?: string) {
  return { socket: { remoteAddress: address }, headers: { host, origin, "sec-fetch-site": site } } as IncomingMessage;
}

describe("local audit boundary", () => {
  test("blocks a build when a generated artifact exists in public", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "audit-boundary-"));
    try {
      await mkdir(path.join(root, "public"));
      expect(() => assertPrivateAuditArtifacts(root)).not.toThrow();
      await writeFile(path.join(root, "public/commute-evaluation-data.json"), "{}");
      expect(() => assertPrivateAuditArtifacts(root)).toThrow("must not be deployed");
    } finally { await rm(root, { recursive: true }); }
  });
  test("allows a same-origin loopback review", () => {
    expect(isLocalAuditRequest(request("127.0.0.1", "localhost:5173", "http://localhost:5173", "same-origin"))).toBe(true);
  });
  test("rejects LAN clients, rebinding hosts, and cross-origin browser fetches", () => {
    expect(isLocalAuditRequest(request("192.168.1.2", "localhost:5173"))).toBe(false);
    expect(isLocalAuditRequest(request("127.0.0.1", "attacker.example:5173"))).toBe(false);
    expect(isLocalAuditRequest(request("127.0.0.1", "localhost:5173", "https://attacker.example"))).toBe(false);
    expect(isLocalAuditRequest(request("127.0.0.1", "localhost:5173", undefined, "cross-site"))).toBe(false);
  });
});
