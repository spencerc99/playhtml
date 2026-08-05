// ABOUTME: Tests EmoteGhostRenderer — the ghost of your OWN cursor doing an emote.
// ABOUTME: Covers position/color, OS-cursor hide via stylesheet, grace-period mousemove revert, and cleanup timing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EmoteGhostRenderer } from "../features/emotes/EmoteGhostRenderer";

const HIDE_CURSOR_STYLE_ID = "wwo-emote-hide-cursor";

function osCursorHidden(): boolean {
  return document.getElementById(HIDE_CURSOR_STYLE_ID) !== null;
}

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  document.getElementById(HIDE_CURSOR_STYLE_ID)?.remove();
}

describe("EmoteGhostRenderer", () => {
  let renderer: EmoteGhostRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    clearBody();
  });

  afterEach(() => {
    renderer?.destroy();
    vi.useRealTimers();
    clearBody();
  });

  it("renders a ghost at the self cursor position in the self color, opaque, and hides the OS cursor", () => {
    renderer = new EmoteGhostRenderer(() => ({ x: 200, y: 300 }), () => "#5b8db8");
    renderer.play("spin");
    const node = document.querySelector(".cursor-gesture-spin") as HTMLElement;
    expect(node).not.toBeNull();
    expect(node.style.left).toBe("184px"); // 200 - 16
    expect(node.style.top).toBe("284px"); // 300 - 16
    expect(node.style.opacity).toBe("1");
    expect(node.innerHTML).toContain("#5b8db8");
    expect(osCursorHidden()).toBe(true);
  });

  it("no-ops for an unknown emote id", () => {
    renderer = new EmoteGhostRenderer(() => ({ x: 0, y: 0 }), () => "#4a9a8a");
    renderer.play("not-a-real-emote");
    expect(document.querySelector(".emote-ghost")).toBeNull();
    expect(osCursorHidden()).toBe(false);
  });

  it("ignores mousemove during the grace period, then reverts on a later move", () => {
    renderer = new EmoteGhostRenderer(() => ({ x: 0, y: 0 }), () => "#5b8db8");
    renderer.play("dance"); // 2000ms — long enough to move mid-play
    expect(osCursorHidden()).toBe(true);

    // A move during the grace period must NOT revert (avoids the twitch-after-firing kill).
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event("mousemove"));
    expect(document.querySelector(".emote-ghost")).not.toBeNull();
    expect(osCursorHidden()).toBe(true);

    // After the grace period, a deliberate move cuts the emote short.
    vi.advanceTimersByTime(400); // now past MOVE_REVERT_GRACE_MS (450ms total)
    window.dispatchEvent(new Event("mousemove"));
    expect(document.querySelector(".emote-ghost")).toBeNull();
    expect(osCursorHidden()).toBe(false);
  });

  it("reverts the OS cursor on its own timeout even without mouse movement", () => {
    renderer = new EmoteGhostRenderer(() => ({ x: 0, y: 0 }), () => "#5b8db8");
    renderer.play("spin"); // 1000ms duration
    vi.advanceTimersByTime(1100);
    expect(document.querySelector(".emote-ghost")).toBeNull();
    expect(osCursorHidden()).toBe(false);
  });

  it("replaces an in-flight ghost instead of stacking", () => {
    renderer = new EmoteGhostRenderer(() => ({ x: 0, y: 0 }), () => "#5b8db8");
    renderer.play("wave");
    renderer.play("poke");
    expect(document.querySelectorAll(".emote-ghost").length).toBe(1);
    expect(document.querySelector(".cursor-gesture-poke")).not.toBeNull();
  });

  it("destroy removes the active ghost and restores the OS cursor", () => {
    renderer = new EmoteGhostRenderer(() => ({ x: 0, y: 0 }), () => "#5b8db8");
    renderer.play("spin");
    expect(document.querySelectorAll(".emote-ghost").length).toBe(1);
    expect(osCursorHidden()).toBe(true);
    renderer.destroy();
    expect(document.querySelectorAll(".emote-ghost").length).toBe(0);
    expect(osCursorHidden()).toBe(false);
  });
});
