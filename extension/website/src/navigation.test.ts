// ABOUTME: Tests for extension website navigation path matching.
// ABOUTME: Verifies active links survive trailing slash and query variations.

import { describe, expect, test } from "vitest";

import {
  CHANGELOG_URL,
  isNavigationPathActive,
  LIVE_PORTRAIT_URL,
} from "./navigation";

describe("isNavigationPathActive", () => {
  test("matches links with or without trailing slashes", () => {
    expect(isNavigationPathActive("/changelog", CHANGELOG_URL)).toBe(true);
    expect(isNavigationPathActive("/changelog/", CHANGELOG_URL)).toBe(true);
  });

  test("ignores query strings and hashes", () => {
    expect(isNavigationPathActive("/portrait/?mode=live", LIVE_PORTRAIT_URL)).toBe(
      true,
    );
    expect(isNavigationPathActive("/portrait/#top", LIVE_PORTRAIT_URL)).toBe(true);
  });

  test("does not match a different nav destination", () => {
    expect(isNavigationPathActive("/", CHANGELOG_URL)).toBe(false);
    expect(isNavigationPathActive("/portrait/", CHANGELOG_URL)).toBe(false);
  });
});
