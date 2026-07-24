// ABOUTME: Tests the configure()/init() split — config is declared once up
// ABOUTME: front and survives option-less "ensure running" calls (e.g. islands).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerIdentity } from "@playhtml/common";
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

  // Repeated init() calls must NOT rebuild providers or trigger navigation:
  // @playhtml/react components call init() across renders/effects, so a rebuild
  // per call would cause an infinite teardown/rebuild → re-render loop. Bootstrap
  // runs exactly once; later init()s are pure ensure-running no-ops.
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

  it("treats an empty nested option object as no config (does not lock)", async () => {
    // {cursors: {}} declares no opinion — it must not lock config to cursors-off,
    // or the owner's later configure() would be ignored.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      playhtml.configure({ cursors: {} }); // no-op, must not lock
      playhtml.configure({ cursors: { enabled: true } }); // real config wins
      await playhtml.init();
      expect(warn).not.toHaveBeenCalled();
      expect(playhtml.cursorClient).not.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn when a later call adds a default-valued option the owner omitted", async () => {
    // Owner declares cursors only. A second call site passes the same cursors
    // plus defaultRoomOptions:{includeSearch:false} — which is the default. The
    // owner never declared that key, so it's not a conflict.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await playhtml.init({ cursors: { enabled: true } });
      await playhtml.init({
        cursors: { enabled: true },
        defaultRoomOptions: { includeSearch: false },
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when a later call changes a locked concrete option to a function", async () => {
    // A function-room can't be value-compared, but replacing a locked string
    // room with a function is a real change — it must not be silently dropped.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await playhtml.init({ host: "http://localhost:1999", room: "/fixed" });
      await playhtml.init({
        host: "http://localhost:1999",
        room: () => "/dynamic",
      } as any);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn when both calls pass a function for the same option", async () => {
    // Two functions for the same key can't be compared and must not warn — the
    // first declaration wins (the deliberate lenient policy).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await playhtml.init({
        host: "http://localhost:1999",
        room: () => "/a",
      } as any);
      await playhtml.init({
        host: "http://localhost:1999",
        room: () => "/b",
      } as any);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not lock config when a caller mutates its options object after configure()", async () => {
    // configure() must snapshot config; a caller reusing/mutating the object
    // can't retroactively change the locked config.
    const opts = { cursors: { enabled: true } };
    playhtml.configure(opts);
    opts.cursors.enabled = false; // mutate after declaring
    await playhtml.init();
    expect(playhtml.cursorClient).not.toBeNull();
  });

  it("keeps extension-injected identity on the public identity shape", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = undefined;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await playhtml.init({
        cursors: {
          enabled: true,
          playerIdentity: {
            publicKey: "page-key",
            name: "Page user",
            playerStyle: { colorPalette: ["#111111"] },
            privateKey: { kty: "EC", d: "private" },
            profile: { discoveredSites: ["example.com"] },
          } as any,
        },
      });

      document.dispatchEvent(
        new CustomEvent("playhtml:configure-identity", {
          detail: {
            playerIdentity: {
              publicKey: "extension-key",
              playerStyle: {
                colorPalette: ["#ffae00"],
                cursorStyle: "pointer",
                animationStyle: "gentle",
              },
            },
          },
        }),
      );

      const identity = playhtml.cursorClient!.getMyPlayerIdentity();

      expect(identity).toEqual({
        publicKey: "extension-key",
        name: "Page user",
        playerStyle: {
          colorPalette: ["#ffae00"],
          cursorStyle: "pointer",
        },
      });
      expect(JSON.stringify(identity)).not.toContain("privateKey");
      expect(JSON.stringify(identity)).not.toContain("profile");
      expect(log).toHaveBeenCalledWith(
        "[playhtml] Merged extension identity via CustomEvent",
      );
    } finally {
      log.mockRestore();
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("adopts extension identity when cursors are disabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const pageIdentity: PlayerIdentity = {
      publicKey: "page-key",
      name: "page name",
      custom: { mood: "curious" },
      playerStyle: { colorPalette: ["#111111"] },
    };
    const extensionIdentity: PlayerIdentity = {
      publicKey: "extension-key",
      playerStyle: { colorPalette: ["#abcdef"] },
    };

    try {
      await playhtml.init({
        playerIdentity: pageIdentity,
        cursors: { enabled: false },
      });

      document.dispatchEvent(
        new CustomEvent("playhtml:configure-identity", {
          detail: { playerIdentity: extensionIdentity },
        }),
      );

      expect(playhtml.cursorClient).toBeNull();
      expect(playhtml.users.me.pid).toBe("extension-key");
      expect(playhtml.users.me.color).toBe("#abcdef");
      expect(playhtml.users.me.name).toBe("page name");
      expect(playhtml.users.me.custom).toEqual({ mood: "curious" });
      expect(log).toHaveBeenCalledWith(
        "[playhtml] Merged extension identity via CustomEvent",
      );
    } finally {
      log.mockRestore();
    }
  });
});
