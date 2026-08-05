// ABOUTME: Tests session config helpers — URL resolution, room derivation, overrides.
// ABOUTME: Verifies unknown/absent sessions resolve to null (page redirects to home).

import { describe, it, expect } from "vitest";
import {
  SESSIONS,
  sessionRoom,
  roomForSession,
  roomForCurrentPage,
  defaultSession,
  findSession,
  parseSessionId,
  resolveSession,
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

  it("parseSessionId returns the raw param or null", () => {
    expect(parseSessionId("?session=foo")).toBe("foo");
    expect(parseSessionId("")).toBeNull();
    expect(parseSessionId("?other=1")).toBeNull();
  });

  it("resolveSession returns the session for a known id", () => {
    const known = SESSIONS[0].id;
    expect(resolveSession(`?session=${known}`)?.id).toBe(known);
  });

  it("resolveSession returns null when absent or unknown (page redirects home)", () => {
    expect(resolveSession("")).toBeNull();
    expect(resolveSession("?session=bogus")).toBeNull();
  });

  it("roomForSession uses the explicit override when set, else derives", () => {
    const rhizome = findSession("2025-04-30-rhizome")!;
    expect(rhizome.room).toBe("/events/walking-together/");
    expect(roomForSession(rhizome)).toBe("/events/walking-together/");

    const byod = findSession("2026-06-06-byod")!;
    expect(byod.room).toBeUndefined();
    expect(roomForSession(byod)).toBe("walking-together-2026-06-06-byod");
  });

  it("roomForCurrentPage accepts testRoom only on local hosts", () => {
    const byod = findSession("2026-06-06-byod")!;

    expect(
      roomForCurrentPage(
        byod,
        new URL(
          "http://localhost:5173/events/walking-together/session.html?testRoom=codex",
        ),
      ),
    ).toBe("codex");

    expect(
      roomForCurrentPage(
        byod,
        new URL(
          "http://127.0.0.1:5173/events/walking-together/session.html?testRoom=codex",
        ),
      ),
    ).toBe("codex");

    expect(
      roomForCurrentPage(
        byod,
        new URL(
          "https://playhtml.fun/events/walking-together/session.html?testRoom=codex",
        ),
      ),
    ).toBe(roomForSession(byod));
  });
});
