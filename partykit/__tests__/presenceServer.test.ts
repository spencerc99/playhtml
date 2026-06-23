// ABOUTME: Verifies generic presence server lifecycle diagnostics.
// ABOUTME: Keeps expected WebSocket closes from polluting Worker logs.
import { describe, expect, it } from "bun:test";
import { isExpectedPresenceClose } from "../presenceDiagnostics";

describe("presence server diagnostics", () => {
  it("treats normal and clean no-code closes as expected", () => {
    expect(isExpectedPresenceClose(1000, true)).toBe(true);
    expect(isExpectedPresenceClose(1005, true)).toBe(true);
  });

  it("keeps unclean and error closes diagnosable", () => {
    expect(isExpectedPresenceClose(1005, false)).toBe(false);
    expect(isExpectedPresenceClose(1011, true)).toBe(false);
  });
});
