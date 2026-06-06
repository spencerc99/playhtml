// ABOUTME: Tests session config helpers — resolution from URL and room derivation.
// ABOUTME: Verifies fallback to the latest active session when ?session is absent.

import { describe, it, expect } from "vitest";
import {
  SESSIONS,
  sessionRoom,
  defaultSession,
  findSession,
  resolveSessionId,
} from "../sessions";

describe("sessions", () => {
  it("has at least one non-archived session", () => {
    expect(SESSIONS.some((s) => !s.archived)).toBe(true);
  });

  it("sessionRoom prefixes with walking-together-", () => {
    expect(sessionRoom("abc")).toBe("walking-together-abc");
  });

  it("defaultSession returns the last non-archived session", () => {
    const active = SESSIONS.filter((s) => !s.archived);
    expect(defaultSession().id).toBe(active[active.length - 1].id);
  });

  it("findSession returns undefined for unknown id", () => {
    expect(findSession("does-not-exist")).toBeUndefined();
  });

  it("resolveSessionId reads ?session and falls back when absent/unknown", () => {
    const known = SESSIONS[0].id;
    expect(resolveSessionId(`?session=${known}`)).toBe(known);
    expect(resolveSessionId("")).toBe(defaultSession().id);
    expect(resolveSessionId("?session=bogus")).toBe(defaultSession().id);
  });
});
