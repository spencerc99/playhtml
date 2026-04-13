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

  it("re-derives default room from current pathname on each navigation", async () => {
    // Init without an explicit room — the default room is pathname-based.
    // On navigation, the new pathname should produce a new room ID.
    const origPath = window.location.pathname;
    try {
      history.replaceState(null, "", "/page-a");
      await playhtml.init({ host: "http://localhost:1999" } as any);

      const listener = vi.fn();
      document.addEventListener("playhtml:navigated", listener as EventListener);

      history.replaceState(null, "", "/page-b");
      await playhtml.handleNavigation();

      const rooms = listener.mock.calls.map(
        (c) => (c[0] as CustomEvent).detail.room,
      );
      // The room ID URL-encodes the pathname, so check for the encoded form.
      expect(rooms[rooms.length - 1]).toContain("page-b");
      expect(rooms[rooms.length - 1]).not.toContain("page-a");
      document.removeEventListener("playhtml:navigated", listener as EventListener);
    } finally {
      history.replaceState(null, "", origPath);
    }
  });
});
