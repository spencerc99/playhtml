// ABOUTME: Tests ephemeral Wikipedia text-selection sharing and rendering.
// ABOUTME: Verifies DOM-safe ranges, presence cleanup, and readable cursor-color tinting.

import type {
  PlayerIdentity,
  PresenceAPI,
  PresenceView,
} from "@playhtml/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deserializeSelectionRange,
  serializeSelectionRange,
  WikipediaLiveSelections,
} from "../features/WikipediaLiveSelections";

function identity(publicKey: string, color: string): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: [color] },
  } as PlayerIdentity;
}

function setupPresence(): {
  api: PresenceAPI;
  emit: (presences: Map<string, PresenceView>) => void;
  writes: Array<{ channel: string; data: unknown }>;
} {
  let callback: ((presences: Map<string, PresenceView>) => void) | null = null;
  const writes: Array<{ channel: string; data: unknown }> = [];
  return {
    api: {
      setMyPresence: (channel, data) => writes.push({ channel, data }),
      getPresences: () => new Map(),
      onPresenceChange: (_channel, nextCallback) => {
        callback = nextCallback;
        nextCallback(new Map());
        return () => {
          callback = null;
        };
      },
      getMyIdentity: () => identity("me", "#c4724e"),
    },
    emit: (presences) => callback?.(presences),
    writes,
  };
}

describe("WikipediaLiveSelections", () => {
  const highlights = new Map<string, unknown>();
  const originalCss = globalThis.CSS;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<main id="mw-content-text"><p>Octopus intelligence</p></main>';
    highlights.clear();
    if (!globalThis.CSS) {
      Object.defineProperty(globalThis, "CSS", {
        configurable: true,
        value: {},
      });
    }
    Object.defineProperty(globalThis.CSS, "highlights", {
      configurable: true,
      value: {
        set: (name: string, highlight: unknown) =>
          highlights.set(name, highlight),
        delete: (name: string) => highlights.delete(name),
      },
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class {
        constructor(public range: Range) {}
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: originalCss,
    });
    vi.restoreAllMocks();
  });

  it("round-trips a text range without serializing article text", () => {
    const root = document.querySelector("#mw-content-text")!;
    const text = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);

    const serialized = serializeSelectionRange(root, range);

    expect(serialized).toEqual({
      start: { path: [0, 0], offset: 0 },
      end: { path: [0, 0], offset: 7 },
    });
    expect(JSON.stringify(serialized)).not.toContain("Octopus");
    expect(deserializeSelectionRange(root, serialized)?.toString()).toBe(
      "Octopus",
    );
  });

  it("broadcasts the current selection and clears it when collapsed", async () => {
    const presence = setupPresence();
    const liveSelections = new WikipediaLiveSelections(presence.api, "#c4724e");
    liveSelections.init();
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    document.dispatchEvent(new Event("selectionchange"));
    await vi.waitFor(() =>
      expect(presence.writes.at(-1)?.data).toEqual({
        start: { path: [0, 0], offset: 0 },
        end: { path: [0, 0], offset: 7 },
      }),
    );

    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await vi.waitFor(() => expect(presence.writes.at(-1)?.data).toBeNull());
    liveSelections.destroy();
  });

  it("publishes at most every 250ms and skips unchanged selections", async () => {
    vi.useFakeTimers();
    const presence = setupPresence();
    const liveSelections = new WikipediaLiveSelections(presence.api, "#c4724e");
    liveSelections.init();
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    for (let index = 0; index < 5; index++) {
      document.dispatchEvent(new Event("selectionchange"));
    }
    await vi.advanceTimersByTimeAsync(249);
    expect(presence.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(presence.writes).toHaveLength(2);

    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(250);
    expect(presence.writes).toHaveLength(2);

    range.setEnd(text, 8);
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(250);
    expect(presence.writes).toHaveLength(3);

    liveSelections.destroy();
  });

  it("renders peer ranges with transparent cursor-color tints", () => {
    const presence = setupPresence();
    const liveSelections = new WikipediaLiveSelections(presence.api, "#c4724e");
    liveSelections.init();
    presence.emit(
      new Map([
        [
          "peer",
          {
            isMe: false,
            cursor: null,
            playerIdentity: identity("peer", "#4a9a8a"),
            selection: {
              start: { path: [0, 0], offset: 0 },
              end: { path: [0, 0], offset: 7 },
            },
          } as PresenceView,
        ],
      ]),
    );

    expect(highlights.size).toBe(1);
    const css = document.querySelector(
      "#wwo-live-selection-styles",
    )?.textContent;
    expect(css).toContain("rgb(74, 154, 138) 32%, transparent");
    expect(css).toContain("color: inherit");

    liveSelections.destroy();
    expect(highlights.size).toBe(0);
    expect(presence.writes.at(-1)).toEqual({
      channel: "selection",
      data: null,
    });
  });
});
