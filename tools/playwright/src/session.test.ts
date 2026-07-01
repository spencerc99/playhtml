// ABOUTME: Verifies reusable runtime helpers for long artificial-user scenes.
// ABOUTME: Covers duration bounds and base URL composition.

import { describe, expect, test } from "bun:test";
import { buildSceneUrl, createRunUntil } from "./session";

describe("buildSceneUrl", () => {
  test("joins a base URL and path without duplicate slashes", () => {
    expect(buildSceneUrl("http://localhost:5173/", "/fridge?wall=test")).toBe(
      "http://localhost:5173/fridge?wall=test",
    );
  });

  test("returns absolute URLs unchanged", () => {
    expect(buildSceneUrl(undefined, "https://playhtml.fun/fridge")).toBe(
      "https://playhtml.fun/fridge",
    );
  });
});

describe("createRunUntil", () => {
  test("tracks remaining time from a supplied clock", () => {
    let now = 1000;
    const runUntil = createRunUntil(5000, () => now);

    expect(runUntil.remainingMs()).toBe(5000);
    expect(runUntil.active()).toBe(true);

    now = 5999;
    expect(runUntil.remainingMs()).toBe(1);
    expect(runUntil.active()).toBe(true);

    now = 6000;
    expect(runUntil.remainingMs()).toBe(0);
    expect(runUntil.active()).toBe(false);
  });
});
