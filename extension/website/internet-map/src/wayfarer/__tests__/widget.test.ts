// ABOUTME: Checks the widget bridge's journey handling against a stand-in wayfarer.
// ABOUTME: Cold starts, repeat stops, unknown places and the status messages posted up to the shell.

import { describe, expect, it, vi } from "vitest";
import { WidgetBridge, isJourneyMessage, SHELL_SOURCE, WIDGET_SOURCE } from "../widget";

function harness() {
  const posts: unknown[] = [];
  const listeners: ((s: unknown) => void)[] = [];
  const wf = {
    active: false,
    widget: false,
    tripSeconds: 7,
    walker: { plan: null as null | { steps: unknown[] }, baseSpeed: 1 },
    enter: vi.fn(function (this: { active: boolean }) { this.active = true; }),
    travel: vi.fn(() => true),
    planLength: () => 500,
    onStatus: (fn: (s: unknown) => void) => listeners.push(fn),
  };
  const located: Record<string, { page: number; sub: number; dom: number; quality: string; name: string; host: string; domain: string }> = {
    "https://a.test/x": { page: 1, sub: 0, dom: 0, quality: "page", name: "a.test/x", host: "a.test", domain: "a.test" },
    "https://b.test/y": { page: 2, sub: 1, dom: 1, quality: "page", name: "b.test/y", host: "b.test", domain: "b.test" },
  };
  const locator = { locate: (url: string) => located[url] ?? null };
  const bridge = new WidgetBridge(wf as never, locator as never, (m) => posts.push(m));
  return { wf, posts, bridge, listeners };
}

describe("WidgetBridge", () => {
  it("announces readiness and flags the wayfarer as a widget", () => {
    const { wf, posts, bridge } = harness();
    bridge.start();
    expect(wf.widget).toBe(true);
    expect(wf.tripSeconds).toBeLessThan(7);
    expect(posts).toEqual([{ source: WIDGET_SOURCE, type: "ready" }]);
  });

  it("puts the walker down at a lone first stop", () => {
    const { wf, posts, bridge } = harness();
    bridge.journey([{ url: "https://a.test/x" }]);
    expect(wf.enter).toHaveBeenCalledWith({ page: 1, instant: true });
    expect(wf.travel).not.toHaveBeenCalled();
    expect(posts.at(-1)).toMatchObject({ type: "status", state: "arrived", place: { host: "a.test" } });
  });

  it("on a cold start with history, starts at the stop before and walks to the last", () => {
    const { wf, posts, bridge } = harness();
    bridge.journey([{ url: "https://a.test/x" }, { url: "https://b.test/y" }]);
    expect(wf.enter).toHaveBeenCalledWith({ page: 1, instant: true });
    expect(wf.travel).toHaveBeenCalledWith(2);
    expect(posts.at(-1)).toMatchObject({ state: "walking", text: "walking to b.test" });
  });

  it("ignores a journey whose last stop it is already bound for", () => {
    const { wf, bridge } = harness();
    bridge.journey([{ url: "https://a.test/x" }]);
    bridge.journey([{ url: "https://a.test/x" }]);
    expect(wf.enter).toHaveBeenCalledTimes(1);
  });

  it("reports a place the map does not know and stays put", () => {
    const { wf, posts, bridge } = harness();
    bridge.journey([{ url: "https://a.test/x" }]);
    bridge.journey([{ url: "https://a.test/x" }, { url: "https://nowhere.example/z" }]);
    expect(wf.travel).not.toHaveBeenCalled();
    expect(posts.at(-1)).toMatchObject({ state: "lost", place: null, text: "nowhere.example is off the map" });
  });

  it("relays the walker's own arrival as a status", () => {
    const { posts, bridge, listeners } = harness();
    bridge.journey([{ url: "https://a.test/x" }, { url: "https://b.test/y" }]);
    for (const fn of listeners) fn({ state: "arrived" });
    expect(posts.at(-1)).toMatchObject({ state: "arrived", text: "at b.test" });
  });
});

describe("isJourneyMessage", () => {
  it("accepts only the shell's journey shape", () => {
    expect(isJourneyMessage({ source: SHELL_SOURCE, type: "journey", stops: [] })).toBe(true);
    expect(isJourneyMessage({ source: SHELL_SOURCE, type: "journey" })).toBe(false);
    expect(isJourneyMessage({ source: "someone", type: "journey", stops: [] })).toBe(false);
    expect(isJourneyMessage(null)).toBe(false);
  });
});
