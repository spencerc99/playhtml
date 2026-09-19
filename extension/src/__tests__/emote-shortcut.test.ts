// ABOUTME: Verifies extension and embedded-site emote wheel shortcuts.
// ABOUTME: Prevents bare-E behavior from overriding typing or modified commands.

import { describe, expect, it } from "vitest";
import { matchesEmoteShortcut } from "../features/emotes/emoteShortcut";

function event(
  overrides: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key: "e",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("emote wheel shortcuts", () => {
  it("matches bare E outside typing targets", () => {
    expect(matchesEmoteShortcut(event(), "bare-e", true, false)).toBe(true);
    expect(
      matchesEmoteShortcut(event({ key: "E" }), "bare-e", true, false),
    ).toBe(true);
    expect(matchesEmoteShortcut(event(), "bare-e", true, true)).toBe(false);
    expect(
      matchesEmoteShortcut(event({ metaKey: true }), "bare-e", true, false),
    ).toBe(false);
  });

  it("preserves the extension modifier shortcut", () => {
    expect(
      matchesEmoteShortcut(
        event({ metaKey: true, shiftKey: true }),
        "modifier-e",
        true,
        false,
      ),
    ).toBe(true);
    expect(
      matchesEmoteShortcut(
        event({ ctrlKey: true, shiftKey: true }),
        "modifier-e",
        false,
        false,
      ),
    ).toBe(true);
    expect(matchesEmoteShortcut(event(), "modifier-e", true, false)).toBe(
      false,
    );
  });
});
