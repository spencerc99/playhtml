// ABOUTME: Tests the configure()/init() split — config is declared once up
// ABOUTME: front and survives option-less "ensure running" calls (e.g. islands).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

describe("playhtml configure() + init()", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("uses config declared via configure() when a later init() passes none", async () => {
    // The owner (e.g. a <head> script) declares config; islands just ensure
    // running with no options. The declared config must win regardless of order.
    playhtml.configure({ cursors: { enabled: true } });
    await playhtml.init();
    expect(playhtml.cursorClient).not.toBeNull();
  });

  it("a repeated empty configure() before init() does not lock config", async () => {
    // configure() with no options is a true no-op: it must not freeze config, so
    // a later real configure() still wins. (configure() is connection-free, so
    // unlike init() it doesn't trigger the bootstrap lock.)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      playhtml.configure({}); // no-op, must not lock
      playhtml.configure({ cursors: { enabled: true } }); // real config wins
      await playhtml.init();
      expect(warn).not.toHaveBeenCalled();
      expect(playhtml.cursorClient).not.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("connects immediately with defaults; a configure() after connect warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // No config declared → init() connects right away with defaults (off).
      await playhtml.init();
      expect(playhtml.cursorClient).toBeNull();

      // Too late — already connected with defaults.
      playhtml.configure({ cursors: { enabled: true } });
      expect(warn).toHaveBeenCalled();
      expect(playhtml.cursorClient).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("locks config to the first init() and warns on a genuine conflict", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await playhtml.init({ cursors: { enabled: true } });
      const client = playhtml.cursorClient;
      expect(client).not.toBeNull();

      // A later init with a CONFLICTING value warns and is ignored.
      await playhtml.init({ cursors: { enabled: false } });
      expect(warn).toHaveBeenCalled();
      expect(playhtml.cursorClient).toBe(client);
    } finally {
      warn.mockRestore();
    }
  });

  it("does NOT warn when the same options are passed again (lenient)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await playhtml.init({ cursors: { enabled: true }, room: "/x" });
      // Same options from another call site — the 'pass identical options
      // everywhere' pattern must stay quiet.
      await playhtml.init({ cursors: { enabled: true }, room: "/x" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does NOT warn when later calls pass no options", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      playhtml.configure({ cursors: { enabled: true } });
      await playhtml.init();
      await playhtml.init();
      await playhtml.init();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // Regression guard for #198: repeated init() calls must NOT rebuild providers
  // or trigger navigation. The earlier "apply later options" behavior re-ran
  // navigationController.trigger() on every repeated init(), which — because
  // @playhtml/react components call init() across renders/effects — caused an
  // infinite teardown/rebuild → re-render loop. Bootstrap runs exactly once;
  // later init()s are pure ensure-running no-ops.
  it("connects exactly once across repeated init calls", async () => {
    playhtml.configure({ cursors: { enabled: true, room: "domain" } });
    await playhtml.init();
    const afterFirst = (globalThis as any).PLAYHTML_TEST_PROVIDERS.length;

    // Simulate many islands/effects each ensuring running.
    for (let i = 0; i < 10; i++) {
      await playhtml.init();
    }

    expect(playhtml.cursorClient).not.toBeNull();
    // No new providers built — no churn, no rebuild loop.
    expect((globalThis as any).PLAYHTML_TEST_PROVIDERS.length).toBe(afterFirst);
  });
});
