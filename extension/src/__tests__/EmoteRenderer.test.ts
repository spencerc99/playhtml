// ABOUTME: Verifies EmoteRenderer mounts a node for an emote and removes it after its duration.
// ABOUTME: Uses fake timers; asserts DOM presence, not animation frames.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmoteRenderer } from "../features/emotes/EmoteRenderer";

describe("EmoteRenderer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mounts an emote node and removes it after durationMs", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const cursors = {
      getCursorPresences: () =>
        new Map([["peer1", { cursor: { x: 50, y: 60 } }]]),
    };
    const r = new EmoteRenderer(shadow, cursors, () => ({ x: 0, y: 0 }));
    r.play("peer1", "wave", false); // durationMs 1500
    expect(shadow.querySelectorAll(".emote-node")).toHaveLength(1);
    vi.advanceTimersByTime(1600);
    expect(shadow.querySelectorAll(".emote-node")).toHaveLength(0);
    r.destroy();
  });

  it("ignores unknown emote ids", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const r = new EmoteRenderer(
      shadow,
      { getCursorPresences: () => new Map() },
      () => ({ x: 0, y: 0 }),
    );
    r.play("me", "nope", true);
    expect(shadow.querySelectorAll(".emote-node")).toHaveLength(0);
    r.destroy();
  });
});
