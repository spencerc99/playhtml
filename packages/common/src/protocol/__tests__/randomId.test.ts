// ABOUTME: Verifies protocol ids are valid, distinct, and need no secure page.
// ABOUTME: Plain http pages have no crypto.randomUUID, so ids must not use it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId, randomItemId, randomItemIds } from "../randomId";

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

describe("randomItemId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 8 URL-safe characters", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(randomItemId()).toMatch(/^[A-Za-z0-9_-]{8}$/);
    }
  });

  it("works where crypto.randomUUID does not exist", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    expect(randomItemId()).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });
});

describe("randomItemIds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the requested number of ids, all different", () => {
    const ids = randomItemIds(5000);
    expect(ids).toHaveLength(5000);
    expect(new Set(ids).size).toBe(5000);
    expect(randomItemIds(0)).toEqual([]);
  });

  it("draws again when the random source repeats an id", () => {
    const repeats = [1, 1, 2];
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        const value = repeats.shift();
        if (value === undefined) throw new Error("Drew more ids than expected");
        return bytes.fill(value);
      },
    });
    expect(randomItemIds(2)).toEqual(["BBBBBBBB", "CCCCCCCC"]);
  });
});
