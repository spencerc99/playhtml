// ABOUTME: Tests the once-per-session proximity react hint — mount, platform text, show/position/auto-hide, cleanup.
// ABOUTME: jsdom + fake timers; the hint is vanilla DOM in a shadow root.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReactHint } from "../features/emotes/ReactHint";

function makeShadow(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

describe("ReactHint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("mounts a hidden hint into the shadow root", () => {
    const shadow = makeShadow();
    const hint = new ReactHint(shadow, true);
    const el = shadow.querySelector(".emote-react-hint") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains("visible")).toBe(false);
    hint.destroy();
  });

  it("uses the mac shortcut on mac and ctrl on other platforms", () => {
    const macShadow = makeShadow();
    new ReactHint(macShadow, true);
    expect(macShadow.querySelector("kbd")?.textContent).toBe("⌘⇧E");

    const winShadow = makeShadow();
    new ReactHint(winShadow, false);
    expect(winShadow.querySelector("kbd")?.textContent).toBe("Ctrl⇧E");
  });

  it("shows at a position near the cursor, then auto-hides after the duration", () => {
    const shadow = makeShadow();
    const hint = new ReactHint(shadow, true);
    const el = shadow.querySelector(".emote-react-hint") as HTMLElement;

    hint.showAt({ x: 100, y: 200 });
    expect(el.classList.contains("visible")).toBe(true);
    expect(el.style.left).toBe("120px"); // x + 20
    expect(el.style.top).toBe("220px"); // y + 20

    vi.advanceTimersByTime(4100);
    expect(el.classList.contains("visible")).toBe(false);
    hint.destroy();
  });

  it("is idempotent while already showing", () => {
    const shadow = makeShadow();
    const hint = new ReactHint(shadow, true);
    const el = shadow.querySelector(".emote-react-hint") as HTMLElement;
    hint.showAt({ x: 10, y: 10 });
    hint.showAt({ x: 999, y: 999 }); // ignored while visible
    expect(el.style.left).toBe("30px"); // still the first position
    hint.destroy();
  });

  it("destroy removes the element and clears the pending hide", () => {
    const shadow = makeShadow();
    const hint = new ReactHint(shadow, true);
    hint.showAt({ x: 0, y: 0 });
    hint.destroy();
    expect(shadow.querySelector(".emote-react-hint")).toBeNull();
    // advancing timers after destroy must not throw
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});
