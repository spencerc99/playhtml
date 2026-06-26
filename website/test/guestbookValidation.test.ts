// ABOUTME: Tests homepage guestbook input validation helpers.
// ABOUTME: Verifies visitor names stay within the accepted character set.

import { describe, expect, test } from "bun:test";
import {
  isGuestbookNameAllowed,
  sanitizeGuestbookName,
} from "../utils/guestbookValidation";

describe("sanitizeGuestbookName", () => {
  test("removes non-alphanumeric characters", () => {
    expect(sanitizeGuestbookName("spencer chang_99!!")).toBe(
      "spencerchang99",
    );
  });
});

describe("isGuestbookNameAllowed", () => {
  test("allows only alphanumeric names", () => {
    expect(isGuestbookNameAllowed("spencer99")).toBe(true);
    expect(isGuestbookNameAllowed("spencer-99")).toBe(false);
    expect(isGuestbookNameAllowed("spencer chang")).toBe(false);
  });
});
