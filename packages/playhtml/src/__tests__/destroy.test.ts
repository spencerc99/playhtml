// ABOUTME: Tests for playhtml.destroy() — full teardown, idempotence,
// ABOUTME: and that init() can run again afterward.
import { describe, it, expect, beforeEach } from "vitest";
import { playhtml } from "../index";

describe("playhtml.destroy", () => {
  beforeEach(async () => {
    // Leave no trace between tests
    try {
      await playhtml.destroy();
    } catch {}
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("link[href*='playhtml']")
      .forEach((n) => n.remove());
    document.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("is idempotent when playhtml has not been init'd", async () => {
    await expect(playhtml.destroy()).resolves.toBeUndefined();
    await expect(playhtml.destroy()).resolves.toBeUndefined();
  });

  it("removes window.playhtml and data-playhtml after destroy", async () => {
    await playhtml.init({ host: "http://localhost:1999" } as any);
    expect((window as any).playhtml).toBe(playhtml);
    expect(document.documentElement.dataset.playhtml).toBe("true");

    await playhtml.destroy();
    expect((window as any).playhtml).toBeUndefined();
    expect(document.documentElement.dataset.playhtml).toBeUndefined();
  });

  it("allows init() to be called again after destroy", async () => {
    await playhtml.init({ host: "http://localhost:1999" } as any);
    await playhtml.destroy();
    await expect(
      playhtml.init({ host: "http://localhost:1999" } as any),
    ).resolves.not.toThrow();
  });
});
