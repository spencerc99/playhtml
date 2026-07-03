// ABOUTME: Tests village guestbook standing copy for earned-role counters.
// ABOUTME: Verifies session-based guestbook rules render the matching UI state.

import { describe, expect, test } from "bun:test";
import { describeGuestbookStanding } from "../utils/guestbookStanding";

describe("describeGuestbookStanding", () => {
  test("uses the configured session counter for returning visitors", () => {
    const copy = describeGuestbookStanding({
      rung: "returning",
      counterName: "sessions",
      counters: { days: 1, sessions: 2 },
      permissionsEnforced: true,
      canSign: true,
      regularThreshold: 5,
    });

    expect(copy.standing).toBe(
      "you are a returning · the room has seen you in 2 sessions",
    );
    expect(copy.signNote).toBe(
      "you may sign. regulars (5 sessions) may also sweep up.",
    );
  });
});
