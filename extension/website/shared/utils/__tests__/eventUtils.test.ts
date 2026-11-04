// ABOUTME: Tests shared event color selection for visualization sessions.
// ABOUTME: Verifies local-time color derivation and participant fallbacks.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  deriveSessionColor,
  getColorForEvent,
  getColorForParticipant,
  parseColorToHsl,
} from "../eventUtils";

function event(
  overrides: Partial<CollectionEvent["meta"]> = {},
): CollectionEvent {
  return {
    id: "event",
    type: "cursor",
    ts: Date.UTC(2026, 0, 1, 12, 30),
    data: { x: 0.5, y: 0.5, event: "move" },
    meta: {
      pid: "participant",
      sid: "session",
      url: "https://example.com",
      vw: 1920,
      vh: 1080,
      tz: "UTC",
      ...overrides,
    },
  };
}

describe("getColorForEvent", () => {
  it("derives the selected cursor color from the event timestamp and timezone", () => {
    const source = event({ cursor_color: "#336699" });

    expect(getColorForEvent(source)).toBe(
      deriveSessionColor("#336699", source.ts, "UTC"),
    );
  });

  it("uses the supplied session start timestamp", () => {
    const source = event({ cursor_color: "#336699" });
    const sessionStart = Date.UTC(2026, 0, 1, 0, 15);

    expect(getColorForEvent(source, sessionStart)).toBe(
      deriveSessionColor("#336699", sessionStart, "UTC"),
    );
  });

  it("falls back to the participant palette without a selected cursor color", () => {
    const source = event({ cursor_color: null });

    expect(getColorForEvent(source)).toBe(
      getColorForParticipant(source.meta.pid),
    );
  });
});

describe("parseColorToHsl", () => {
  it("reads see-through hex colors by their RGB part", () => {
    expect(parseColorToHsl("#52b1e080")).toEqual(parseColorToHsl("#52b1e0"));
    expect(parseColorToHsl("#0f08")).toEqual(parseColorToHsl("#00ff00"));
    expect(parseColorToHsl("#52b1e0")).not.toBeNull();
  });
});
