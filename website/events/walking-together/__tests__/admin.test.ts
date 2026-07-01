// ABOUTME: Tests the admin gate — requires matching name AND color, case-insensitive.

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
});
