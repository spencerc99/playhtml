// ABOUTME: Verifies protocol ids are valid, distinct, and need no secure page.
// ABOUTME: Plain http pages have no crypto.randomUUID, so ids must not use it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "../randomId";

describe("randomId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns distinct version 4 UUIDs", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("works where crypto.randomUUID does not exist", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    expect(randomId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
