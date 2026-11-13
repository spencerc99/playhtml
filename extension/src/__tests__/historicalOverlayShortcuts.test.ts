// ABOUTME: Tests the historical overlay's forced server backfill shortcut.
// ABOUTME: Cmd/Ctrl+Shift+9 must match even though Shift reports the key as "(".

import { describe, expect, it } from "vitest";
import { isServerBackfillShortcut } from "../components/HistoricalOverlay";

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("isServerBackfillShortcut", () => {
  it("matches Cmd+Shift+9 as a US keyboard reports it", () => {
    expect(
      isServerBackfillShortcut(
        keydown({ key: "(", code: "Digit9", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches Ctrl+Shift+9", () => {
    expect(
      isServerBackfillShortcut(
        keydown({ key: "(", code: "Digit9", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("ignores the key without both modifiers", () => {
    expect(
      isServerBackfillShortcut(keydown({ key: "9", code: "Digit9", metaKey: true })),
    ).toBe(false);
    expect(
      isServerBackfillShortcut(keydown({ key: "(", code: "Digit9", shiftKey: true })),
    ).toBe(false);
  });
});
