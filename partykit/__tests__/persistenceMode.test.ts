// ABOUTME: Verifies persistence degradation helpers for Supabase outage handling.
// ABOUTME: Covers startup timeouts, explicit operator logs, and admin error responses.
import { describe, expect, test } from "bun:test";
import {
  createPersistenceUnavailableResponse,
  formatPersistenceFailureLog,
  retryWithTimeout,
  withTimeout,
} from "../persistenceMode";

describe("withTimeout", () => {
  test("rejects when the operation exceeds the configured timeout", async () => {
    await expect(
      withTimeout(() => new Promise(() => {}), {
        timeoutMs: 1,
        errorMessage: "Supabase document load timed out after 1ms",
      })
    ).rejects.toThrow("Supabase document load timed out after 1ms");
  });

  test("returns the operation value before the timeout", async () => {
    await expect(
      withTimeout(() => Promise.resolve("loaded"), {
        timeoutMs: 100,
        errorMessage: "should not time out",
      })
    ).resolves.toBe("loaded");
  });

  test("aborts an operation that exceeds the timeout", async () => {
    let signal: AbortSignal | undefined;

    await expect(
      withTimeout(
        (operationSignal) => {
          signal = operationSignal;
          return new Promise(() => {});
        },
        { timeoutMs: 1, errorMessage: "timed out" }
      )
    ).rejects.toThrow("timed out");

    expect(signal?.aborted).toBe(true);
  });

  test("does not abort an operation that completes", async () => {
    let signal: AbortSignal | undefined;

    await withTimeout(
      (operationSignal) => {
        signal = operationSignal;
        return Promise.resolve("loaded");
      },
      { timeoutMs: 100, errorMessage: "timed out" }
    );

    expect(signal?.aborted).toBe(false);
  });
});

describe("retryWithTimeout", () => {
  test("returns a later successful attempt", async () => {
    const failures: number[] = [];

    const result = await retryWithTimeout(
      (_signal, attempt) => {
        if (attempt === 1) throw new Error("temporary failure");
        return Promise.resolve("loaded");
      },
      {
        attempts: 3,
        timeoutMs: 100,
        retryDelayMs: 1,
        errorMessage: "timed out",
        onRetry: ({ attempt }) => failures.push(attempt),
      }
    );

    expect(result).toBe("loaded");
    expect(failures).toEqual([1]);
  });

  test("throws only after every attempt fails", async () => {
    const attempts: number[] = [];

    await expect(
      retryWithTimeout(
        (_signal, attempt) => {
          attempts.push(attempt);
          throw new Error(`failure ${attempt}`);
        },
        {
          attempts: 3,
          timeoutMs: 100,
          retryDelayMs: 1,
          errorMessage: "timed out",
        }
      )
    ).rejects.toThrow("failure 3");

    expect(attempts).toEqual([1, 2, 3]);
  });

  test("rejects an invalid attempt count", async () => {
    await expect(
      retryWithTimeout(() => Promise.resolve("loaded"), {
        attempts: 0,
        timeoutMs: 100,
        retryDelayMs: 1,
        errorMessage: "timed out",
      })
    ).rejects.toThrow("Persistence load attempts must be a positive integer");
  });
});

describe("formatPersistenceFailureLog", () => {
  test("makes Supabase startup failures unmistakable in production logs", () => {
    const message = formatPersistenceFailureLog({
      roomName: "example-room",
      timeoutMs: 5000,
      attempts: 3,
      error: new Error("connection timeout"),
    });

    expect(message).toContain("SUPABASE PERSISTENCE UNAVAILABLE");
    expect(message).toContain("room=example-room");
    expect(message).toContain("timeoutMs=5000");
    expect(message).toContain("attempts=3");
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
