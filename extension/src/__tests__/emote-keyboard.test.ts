// ABOUTME: Verifies the emote number-key shortcuts and the proximity hint poll in initEmotes.
// ABOUTME: Typing digits into inputs must not broadcast emotes; the hint poll stops once shown.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceAPI } from "@playhtml/common";
import { initEmotes } from "../features/emotes";

function createDeps(peers: Map<string, { cursor: { x: number; y: number } | null }>) {
  const sent: Array<{ channel: string; value: unknown }> = [];
  const presence = {
    getMyIdentity: () => ({ publicKey: "pk_me" }),
    setMyPresence: (channel: string, value: unknown) => {
      sent.push({ channel, value });
    },
    onPresenceChange: () => () => {},
  } as unknown as PresenceAPI;
  const cursorClient = {
    getCursorPresences: () => peers,
    triggerCursorAnimation: () => true,
    hideCursor: () => {},
    showCursor: () => {},
  };
  return { deps: { presence, cursorClient }, sent };
}

describe("initEmotes keyboard", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("fires an emote for a bare number key outside typing targets", () => {
    const { deps, sent } = createDeps(new Map());
    cleanup = initEmotes(deps, { showProximityHint: false });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe("emotes");
  });

  it("does not fire an emote when a digit is typed into an input", () => {
    const { deps, sent } = createDeps(new Map());
    cleanup = initEmotes(deps, { showProximityHint: false });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", bubbles: true }),
    );
    expect(sent).toHaveLength(0);
  });
});

describe("initEmotes proximity hint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("stops polling for nearby cursors once the hint has been shown", () => {
    const peers = new Map([["pk_peer", { cursor: { x: 0, y: 0 } }]]);
    let reads = 0;
    const { deps } = createDeps(peers);
    const getCursorPresences = deps.cursorClient.getCursorPresences;
    deps.cursorClient.getCursorPresences = () => {
      reads += 1;
      return getCursorPresences();
    };
    const cleanup = initEmotes(deps);
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 1, clientY: 1 }),
    );
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(reads).toBeGreaterThan(0);
    // Let the hint's own hide timer run out; no proximity poll should remain.
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
  });
});
