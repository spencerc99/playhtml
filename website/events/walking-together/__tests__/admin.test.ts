// ABOUTME: Tests the admin gate — key-based "admin" role, with the legacy
// ABOUTME: name+color match (case-insensitive) as fallback.

import { describe, it, expect } from "vitest";
import { isAdmin } from "../admin";

describe("isAdmin", () => {
  it("is true for the exact admin name + color", () => {
    expect(isAdmin("spencer", "#ffae00")).toBe(true);
  });

  it("is case-insensitive on both name and color", () => {
    expect(isAdmin("Spencer", "#FFAE00")).toBe(true);
  });

  it("requires both name and color to match", () => {
    expect(isAdmin("spencer", "#000000")).toBe(false);
    expect(isAdmin("someone", "#ffae00")).toBe(false);
  });

  it("is false for missing values", () => {
    expect(isAdmin(undefined, undefined)).toBe(false);
    expect(isAdmin("spencer", undefined)).toBe(false);
  });

  it("is true for any identity holding the admin role (key-based path)", () => {
    expect(isAdmin("anyone", "#123456", ["admin"])).toBe(true);
    expect(isAdmin(undefined, undefined, ["admin"])).toBe(true);
  });

  it("ignores unrelated roles", () => {
    expect(isAdmin("someone", "#000000", ["editor"])).toBe(false);
  });
});
