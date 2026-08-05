// ABOUTME: Verifies browser error classification for artificial-user scenes.
// ABOUTME: Keeps noisy expected network messages separate from fatal page failures.

import { describe, expect, test } from "bun:test";
import { isFatalConsoleMessage } from "./errors";

describe("isFatalConsoleMessage", () => {
  test("treats PlayHTML runtime errors as fatal", () => {
    expect(isFatalConsoleMessage("[playhtml] failed to register element")).toBe(
      true,
    );
  });

  test("ignores expected transient network noise", () => {
    expect(isFatalConsoleMessage("WebSocket connection to partykit failed")).toBe(
      false,
    );
    expect(isFatalConsoleMessage("Failed to load favicon.ico")).toBe(false);
  });
});
