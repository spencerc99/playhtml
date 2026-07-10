// ABOUTME: Tests InteractionRenderer's DOM output for the four interaction emotes.
// ABOUTME: jsdom has no Element.animate, so these assert node creation/positioning/cleanup,
// ABOUTME: not the WAAPI keyframes themselves (guarded no-op when animate is unavailable).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { playInteraction } from "../features/emotes/InteractionRenderer";

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

const sender = { x: 100, y: 100 };
const target = { x: 300, y: 100 };

describe("playInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearBody();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearBody();
  });

  it("returns false for a non-interaction emote id", () => {
    expect(
      playInteraction("wave", {
        senderPos: sender,
        senderColor: "#111",
        targetPos: target,
        targetColor: "#222",
      }, 1000),
    ).toBe(false);
    expect(document.querySelectorAll(".interaction-ghost").length).toBe(0);
  });

  it.each(["poke", "highfive", "nuzzle"])(
    "renders a sender and target ghost at their positions for %s",
    (emoteId) => {
      const ok = playInteraction(
        emoteId,
        { senderPos: sender, senderColor: "#111", targetPos: target, targetColor: "#222" },
        1000,
      );
      expect(ok).toBe(true);
      const ghosts = document.querySelectorAll<HTMLElement>(".interaction-ghost");
      expect(ghosts.length).toBe(2);
      expect(ghosts[0].style.left).toBe("84px"); // 100 - 16
      expect(ghosts[0].style.top).toBe("84px");
      expect(ghosts[0].innerHTML).toContain("#111");
      expect(ghosts[1].style.left).toBe("284px"); // 300 - 16
      expect(ghosts[1].innerHTML).toContain("#222");
    },
  );

  it("cleans up ghosts after the duration elapses", () => {
    playInteraction(
      "poke",
      { senderPos: sender, senderColor: "#111", targetPos: target, targetColor: "#222" },
      1000,
    );
    expect(document.querySelectorAll(".interaction-ghost").length).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(document.querySelectorAll(".interaction-ghost").length).toBe(0);
  });

  it("heart renders a sender ghost, a traveling particle, and a target warm-up ghost", () => {
    playInteraction(
      "heart",
      { senderPos: sender, senderColor: "#111", targetPos: target, targetColor: "#222" },
      1300,
    );
    expect(document.querySelectorAll(".interaction-ghost").length).toBe(2);
    const particle = document.querySelector<HTMLElement>(".interaction-particle");
    expect(particle).not.toBeNull();
    expect(particle!.textContent).toBe("♥");
    expect(particle!.style.left).toBe("100px");
    expect(particle!.style.top).toBe("100px");
  });

  it("heart warms the target ghost's color after the particle lands", () => {
    playInteraction(
      "heart",
      { senderPos: sender, senderColor: "#111", targetPos: target, targetColor: "#222" },
      1000,
    );
    const targetGhost = document.querySelectorAll<HTMLElement>(".interaction-ghost")[1];
    expect(targetGhost.innerHTML).toContain("#222");
    vi.advanceTimersByTime(700); // 0.7 * 1000ms landMs
    expect(targetGhost.innerHTML).toContain("#e8863f");
  });

  it("all interaction nodes are cleaned up after duration for heart", () => {
    playInteraction(
      "heart",
      { senderPos: sender, senderColor: "#111", targetPos: target, targetColor: "#222" },
      1000,
    );
    vi.advanceTimersByTime(1000);
    expect(document.querySelectorAll(".interaction-ghost").length).toBe(0);
    expect(document.querySelectorAll(".interaction-particle").length).toBe(0);
  });

  it("accepts a mutual flag for highfive without throwing", () => {
    expect(() =>
      playInteraction(
        "highfive",
        {
          senderPos: sender,
          senderColor: "#111",
          targetPos: target,
          targetColor: "#222",
          mutual: true,
        },
        1200,
      ),
    ).not.toThrow();
  });
});
