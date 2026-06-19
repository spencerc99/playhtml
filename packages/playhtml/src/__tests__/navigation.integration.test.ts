// ABOUTME: End-to-end tests for playhtml.handleNavigation — room switch
// ABOUTME: detection, playhtml:navigated dispatch, and fire-when-cursors-disabled.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

describe("playhtml.handleNavigation", () => {
  beforeEach(async () => {
    try { await resetPlayHTML(); } catch {}
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

  it("recomputes a function explicit room on navigation", async () => {
    // A function room is re-invoked on each nav, so a path-derived room follows
    // the URL — unlike a static string, which stays fixed.
    const { before, after } = await roomsAcrossNav("/a", "/b", {
      room: () => `wwo${window.location.pathname}`,
    });
    expect(before).toContain("wwo");
    expect(before).toContain("a");
    expect(after).toContain("b");
    expect(before).not.toEqual(after);
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

  it("does not carry page-data into the next room on navigation", async () => {
    // Page data is room-scoped: a channel's contents written in room /a must
    // NOT survive into room /b. The doc is reused across room rebuilds, so
    // without an explicit reset the old room's page-data would persist in the
    // doc and sync into the new room. Tested at the local-doc layer (no socket).
    const origPath = window.location.pathname + window.location.search;
    try {
      history.replaceState(null, "", "/room-a");
      await playhtml.init({ host: "http://localhost:1999" } as any);

      const channelA = playhtml.createPageData("notes", { items: [] as string[] });
      channelA.setData({ items: ["from-a"] });
      await new Promise((r) => queueMicrotask(r));
      expect(channelA.getData()).toEqual({ items: ["from-a"] });

      // Navigate to a different room.
      history.replaceState(null, "", "/room-b");
      await playhtml.handleNavigation();
      await new Promise((r) => queueMicrotask(r));

      // A channel opened in room /b must start from its default, not /a's data.
      const channelB = playhtml.createPageData("notes", { items: [] as string[] });
      expect(channelB.getData()).toEqual({ items: [] });
    } finally {
      history.replaceState(null, "", origPath);
    }
  });

  it("keeps a surviving page-data handle usable after a room change", async () => {
    // A consumer that holds a channel handle across an SPA route change must
    // still be able to read/write it — the room-change reset clears the DATA
    // but must not orphan the handle's proxy (which would make setData throw).
    const origPath = window.location.pathname + window.location.search;
    try {
      history.replaceState(null, "", "/survive-a");
      await playhtml.init({ host: "http://localhost:1999" } as any);

      const channel = playhtml.createPageData("counter", { n: 0 });
      channel.setData({ n: 1 });
      await new Promise((r) => queueMicrotask(r));

      history.replaceState(null, "", "/survive-b");
      await playhtml.handleNavigation();
      await new Promise((r) => queueMicrotask(r));

      // Same handle, after nav: reads the cleared default, and writing works.
      expect(channel.getData()).toEqual({ n: 0 });
      expect(() => channel.setData({ n: 5 })).not.toThrow();
      await new Promise((r) => queueMicrotask(r));
      expect(channel.getData()).toEqual({ n: 5 });
    } finally {
      history.replaceState(null, "", origPath);
    }
  });

  it("keeps notifying a surviving handle's onUpdate after a room change", async () => {
    // A handle that registered onUpdate and survives a room change must keep
    // receiving updates: when its proxy is re-acquired on the next setData, the
    // deep observer has to be re-attached, or notifications go silently dead.
    const origPath = window.location.pathname + window.location.search;
    try {
      history.replaceState(null, "", "/notify-a");
      await playhtml.init({ host: "http://localhost:1999" } as any);

      const channel = playhtml.createPageData("live", { n: 0 });
      const updates: any[] = [];
      channel.onUpdate((d) => updates.push(d));

      history.replaceState(null, "", "/notify-b");
      await playhtml.handleNavigation();
      await new Promise((r) => queueMicrotask(r));

      // Writing through the surviving handle must still notify its listener.
      channel.setData({ n: 7 });
      await new Promise((r) => queueMicrotask(r));
      expect(updates).toContainEqual({ n: 7 });
    } finally {
      history.replaceState(null, "", origPath);
    }
  });

  it("a stale handle's destroy after a room change does not break a reopened channel", async () => {
    // After nav, code often re-creates its channel. Destroying the OLD handle
    // (e.g. in a cleanup) must not tear down the freshly reopened same-name
    // channel's listeners/observer/proxy.
    const origPath = window.location.pathname + window.location.search;
    try {
      history.replaceState(null, "", "/stale-a");
      await playhtml.init({ host: "http://localhost:1999" } as any);

      const oldHandle = playhtml.createPageData("shared", { v: "a" });
      await new Promise((r) => queueMicrotask(r));

      history.replaceState(null, "", "/stale-b");
      await playhtml.handleNavigation();
      await new Promise((r) => queueMicrotask(r));

      // Reopen the same channel name in the new room, then destroy the old one.
      const newHandle = playhtml.createPageData("shared", { v: "default" });
      const updates: any[] = [];
      newHandle.onUpdate((d) => updates.push(d));
      oldHandle.destroy();

      // The reopened channel must still be live: its writes apply and notify.
      newHandle.setData({ v: "b" });
      await new Promise((r) => queueMicrotask(r));
      expect(newHandle.getData()).toEqual({ v: "b" });
      expect(updates).toContainEqual({ v: "b" });
    } finally {
      history.replaceState(null, "", origPath);
    }
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
    await resetPlayHTML();

    await playhtml.init({
      host: "http://localhost:1999",
      room: "/room-a",
    } as any);
    await expect(resetPlayHTML()).resolves.toBeUndefined();
  });
});
