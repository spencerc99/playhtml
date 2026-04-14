// ABOUTME: End-to-end tests for playhtml.handleNavigation — room switch
// ABOUTME: detection, playhtml:navigated dispatch, and fire-when-cursors-disabled.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { playhtml } from "../index";

describe("playhtml.handleNavigation", () => {
  beforeEach(async () => {
    try { await playhtml.destroy(); } catch {}
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
    document.head.querySelectorAll("link[href*='playhtml']").forEach((n) => n.remove());
    document.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
  });

  it("no-ops when not initialized", async () => {
    await expect(playhtml.handleNavigation()).resolves.toBeUndefined();
  });

  it("dispatches playhtml:navigated with current room", async () => {
    await playhtml.init({ host: "http://localhost:1999", room: "/test-room" } as any);

    const listener = vi.fn();
    document.addEventListener("playhtml:navigated", listener as EventListener);

    await playhtml.handleNavigation();

    expect(listener).toHaveBeenCalled();
    const evt = listener.mock.calls[0][0] as CustomEvent;
    expect(evt.detail.room).toBeTruthy();

    document.removeEventListener("playhtml:navigated", listener as EventListener);
  });

  it("dispatches playhtml:navigated even when cursors are disabled", async () => {
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/no-cursors",
      cursors: { enabled: false },
    } as any);

    const listener = vi.fn();
    document.addEventListener("playhtml:navigated", listener as EventListener);

    await playhtml.handleNavigation();

    expect(listener).toHaveBeenCalled();
    document.removeEventListener("playhtml:navigated", listener as EventListener);
  });

  it("does not throw when called with unchanged URL", async () => {
    document.body.innerHTML = `<div id="test-el" can-move>test</div>`;
    await playhtml.init({ host: "http://localhost:1999", room: "/same" } as any);

    await expect(playhtml.handleNavigation()).resolves.toBeUndefined();
    expect(document.getElementById("test-el")).toBeTruthy();
  });

  // Helper: init at `from`, navigate to `to`, return the two emitted room IDs.
  async function roomsAcrossNav(
    from: string,
    to: string,
    initOptions: any = {},
  ): Promise<{ before: string; after: string }> {
    const origPath = window.location.pathname + window.location.search;
    try {
      history.replaceState(null, "", from);
      await playhtml.init({ host: "http://localhost:1999", ...initOptions });

      const listener = vi.fn();
      document.addEventListener("playhtml:navigated", listener as EventListener);

      // Capture current room via an initial nav trigger (no URL change yet)
      await playhtml.handleNavigation();
      const before = (listener.mock.calls[0][0] as CustomEvent).detail.room;

      history.replaceState(null, "", to);
      await playhtml.handleNavigation();
      const after = (
        listener.mock.calls[listener.mock.calls.length - 1][0] as CustomEvent
      ).detail.room;

      document.removeEventListener(
        "playhtml:navigated",
        listener as EventListener,
      );
      return { before, after };
    } finally {
      history.replaceState(null, "", origPath);
    }
  }

  it("re-derives default room from pathname on navigation", async () => {
    const { before, after } = await roomsAcrossNav("/page-a", "/page-b");
    expect(before).toContain("page-a");
    expect(after).toContain("page-b");
    expect(before).not.toEqual(after);
  });

  it("ignores query params by default (includeSearch: false)", async () => {
    const { before, after } = await roomsAcrossNav("/same?x=1", "/same?x=2");
    expect(before).toEqual(after);
  });

  it("includes query params in room when defaultRoomOptions.includeSearch is true", async () => {
    const { before, after } = await roomsAcrossNav("/same?x=1", "/same?x=2", {
      defaultRoomOptions: { includeSearch: true },
    });
    expect(before).not.toEqual(after);
    expect(before).toContain("x%3D1");
    expect(after).toContain("x%3D2");
  });

  it("ignores hash changes", async () => {
    const { before, after } = await roomsAcrossNav("/h#one", "/h#two");
    expect(before).toEqual(after);
  });

  it("keeps static explicit room stable across navigation", async () => {
    const { before, after } = await roomsAcrossNav("/a", "/b", {
      room: "my-app-room",
    });
    expect(before).toEqual(after);
    expect(before).toContain("my-app-room");
  });

  it("strips filename extension from pathname when deriving default room", async () => {
    const { before, after } = await roomsAcrossNav(
      "/page.html",
      "/page",
    );
    // `/page.html` and `/page` should resolve to the same room — extension stripped.
    expect(before).toEqual(after);
  });

  it("does not duplicate elementHandlers on elements that survive navigation", async () => {
    // Regression test for ba1ee0c. Before that fix, runHandleNavigation
    // flushed the Map unconditionally and setupElements re-registered every
    // connected DOM node, attaching a second listener set on already-wired
    // elements. This is observable as Map.size growing per-nav.
    document.body.innerHTML = `<div id="survivor" can-move style="width:10px;height:10px;">x</div>`;
    await playhtml.init({ host: "http://localhost:1999", room: "/stay" } as any);

    const sizeBefore = playhtml.elementHandlers.get("can-move")?.size ?? 0;
    expect(sizeBefore).toBe(1);

    await playhtml.handleNavigation();
    await playhtml.handleNavigation();
    await playhtml.handleNavigation();

    const sizeAfter = playhtml.elementHandlers.get("can-move")?.size ?? 0;
    expect(sizeAfter).toBe(1);

    // The handler should still point at the live DOM node.
    const handler = playhtml.elementHandlers.get("can-move")?.get("survivor");
    expect(handler).toBeTruthy();
    expect((handler as any).element).toBe(document.getElementById("survivor"));
  });

  it("drops handlers for elements removed from the DOM during navigation", async () => {
    document.body.innerHTML = `<div id="doomed" can-move style="width:10px;height:10px;">x</div>`;
    await playhtml.init({ host: "http://localhost:1999", room: "/drop" } as any);
    expect(playhtml.elementHandlers.get("can-move")?.has("doomed")).toBe(true);

    // Simulate a body-swap that removes the element from the DOM.
    document.body.innerHTML = "";
    await playhtml.handleNavigation();

    expect(playhtml.elementHandlers.get("can-move")?.has("doomed")).toBe(false);
  });

  it("cleans up awareness listener on destroy and allows re-init", async () => {
    // Adjacent regression for the reviewer's #1/#3: the awareness "change"
    // listener was previously attached once at init against the init-time
    // provider. After destroy, nothing unsubscribed — so a subsequent init
    // would either double-subscribe or subscribe against the (now destroyed)
    // old object. This test pins the happy path: destroy + re-init doesn't
    // throw and lands in a working state where a second destroy also works.
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/room-a",
    } as any);
    await playhtml.destroy();

    await playhtml.init({
      host: "http://localhost:1999",
      room: "/room-a",
    } as any);
    await expect(playhtml.destroy()).resolves.toBeUndefined();
  });
});
