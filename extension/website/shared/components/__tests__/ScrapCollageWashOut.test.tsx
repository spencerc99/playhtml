// ABOUTME: Regression test for wash-out ghost cleanup in the internet-scraps collage.
// ABOUTME: A ghost created before the tide pauses must still be retired once its animation ends.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapCollage, type ScrapItem } from "../ScrapCollage";

const TIDE_WASH_OUT_MS = 1400;
/** Longest gap the scheduler can rest for before its next event. */
const TIDE_GAP_MAX_MS = 7000;

function buildItems(count: number): ScrapItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    key: `s${index}`,
    kind: "button" as const,
    text: `Scrap ${index}`,
    styles: {},
    pageTitle: `Page ${index}`,
    domain: `d${index}.example`,
    pageUrl: `https://d${index}.example/`,
    ts: index,
  }));
}

describe("wash-out ghost cleanup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRect: (() => void) | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // jsdom reports every element as zero-sized, which would lay out nothing.
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function measured(this: Element) {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 900,
        height: 600,
        right: 900,
        bottom: 600,
        toJSON: () => ({}),
      } as DOMRect;
    };
    restoreRect = () => {
      Element.prototype.getBoundingClientRect = originalRect;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreRect?.();
    restoreRect = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const ghosts = () =>
    container.querySelectorAll(".scrap-collage__tile--washing-out");

  const pauseButton = () =>
    container.querySelector<HTMLButtonElement>(
      ".scrap-collage__filter--cycle",
    );

  it("retires a ghost created before the tide is paused", () => {
    // A shore of 4 out of a pool of 12 leaves plenty offshore, so the tide runs.
    // A high draw keeps the scheduler shedding rather than washing in.
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    act(() => {
      root.render(
        <ScrapCollage
          items={buildItems(12)}
          seed={1}
          targetCount={4}
          showKindFilter
        />,
      );
    });

    // Let the scheduler's first rest elapse so a scrap washes out.
    act(() => {
      vi.advanceTimersByTime(TIDE_GAP_MAX_MS + 1);
    });
    expect(ghosts().length).toBeGreaterThan(0);

    // Pause partway through the ghost's animation. This restarts the scheduler
    // effect, which used to own — and therefore cancel — the ghost's removal.
    act(() => {
      vi.advanceTimersByTime(TIDE_WASH_OUT_MS / 2);
    });
    const button = pauseButton();
    expect(button).not.toBeNull();
    act(() => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // Well past the animation's end, the ghost must be gone even though the
    // tide is still paused.
    act(() => {
      vi.advanceTimersByTime(TIDE_WASH_OUT_MS * 4);
    });
    expect(ghosts().length).toBe(0);
  });
});
