// ABOUTME: Verifies persistence degradation helpers for Supabase outage handling.
// ABOUTME: Covers startup timeouts, explicit operator logs, and admin error responses.
import { describe, expect, test } from "bun:test";
import {
  createPersistenceUnavailableResponse,
  formatPersistenceFailureLog,
  withTimeout,
} from "../persistenceMode";

describe("withTimeout", () => {
  test("rejects when the operation exceeds the configured timeout", async () => {
    await expect(
      withTimeout(new Promise(() => {}), {
        timeoutMs: 1,
        errorMessage: "Supabase document load timed out after 1ms",
      })
    ).rejects.toThrow("Supabase document load timed out after 1ms");
  });

  test("returns the operation value before the timeout", async () => {
    await expect(
      withTimeout(Promise.resolve("loaded"), {
        timeoutMs: 100,
        errorMessage: "should not time out",
      })
    ).resolves.toBe("loaded");
  });
});

describe("formatPersistenceFailureLog", () => {
  test("makes Supabase startup failures unmistakable in production logs", () => {
    const message = formatPersistenceFailureLog({
      roomName: "example-room",
      timeoutMs: 5000,
      error: new Error("connection timeout"),
    });

    expect(message).toContain("SUPABASE PERSISTENCE UNAVAILABLE");
    expect(message).toContain("room=example-room");
    expect(message).toContain("timeoutMs=5000");
    expect(message).toContain("connection timeout");
    expect(message).toContain("TRANSIENT MODE");
    expect(message).toContain("autosave disabled");
  });
});

describe("createPersistenceUnavailableResponse", () => {
  test("returns a 503 response that explains the transient room mode", async () => {
    const response = createPersistenceUnavailableResponse({
      roomName: "example-room",
      failedAt: 1779829545000,
      reason: "connection timeout",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "persistence_unavailable",
      message:
        "Supabase persistence is unavailable for this room; admin writes are disabled while realtime runs in transient mode.",
      roomId: "example-room",
      failedAt: "2026-05-26T21:05:45.000Z",
      reason: "connection timeout",
    });
  });
});
