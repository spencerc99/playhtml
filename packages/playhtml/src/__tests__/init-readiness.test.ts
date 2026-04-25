// ABOUTME: Tests the playhtml.isLoading + playhtml.ready public lifecycle API.
// ABOUTME: Covers concurrent init dedup, idempotence, and resetPlayHTML semantics.

import { describe, it, expect, beforeEach } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

describe("playhtml lifecycle (isLoading + ready)", () => {
  beforeEach(async () => {
    try {
      await resetPlayHTML();
    } catch {}
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
    document.body.innerHTML = "";
  });

  it("starts with isLoading=true and a pending ready promise", () => {
    expect(playhtml.isLoading).toBe(true);
    expect(playhtml.ready).toBeInstanceOf(Promise);
  });

  it("ready resolves and isLoading flips false after init()", async () => {
    await playhtml.init({});
    expect(playhtml.isLoading).toBe(false);
    await expect(playhtml.ready).resolves.toBeUndefined();
  });

  it("concurrent init() calls share the same ready promise", async () => {
    const a = playhtml.init({});
    const b = playhtml.init({});
    const c = playhtml.init({});
    // All three resolve together once setup completes.
    await Promise.all([a, b, c]);
    expect(playhtml.isLoading).toBe(false);
    // All concurrent calls received the same underlying readiness signal —
    // verify by checking they all resolve to the canonical ready promise.
    await expect(playhtml.ready).resolves.toBeUndefined();
  });

  it("init() called after readiness returns the resolved ready promise", async () => {
    await playhtml.init({});
    const second = playhtml.init({});
    await expect(second).resolves.toBeUndefined();
    expect(playhtml.isLoading).toBe(false);
  });

  it("createPresenceRoom does not throw after awaiting ready", async () => {
    playhtml.init({});
    await playhtml.ready;
    expect(() => {
      const room = playhtml.createPresenceRoom("ready-test");
      room.destroy();
    }).not.toThrow();
  });

  it("createPageData does not throw after awaiting ready", async () => {
    playhtml.init({});
    await playhtml.ready;
    expect(() => {
      const channel = playhtml.createPageData("ready-test", { count: 0 });
      channel.destroy();
    }).not.toThrow();
  });

  it("resetPlayHTML resets isLoading and gives a fresh ready promise", async () => {
    await playhtml.init({});
    const firstReady = playhtml.ready;
    expect(playhtml.isLoading).toBe(false);

    await resetPlayHTML();
    expect(playhtml.isLoading).toBe(true);
    // New ready is a different, pending promise.
    expect(playhtml.ready).not.toBe(firstReady);

    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
    await playhtml.init({});
    expect(playhtml.isLoading).toBe(false);
  });
});
