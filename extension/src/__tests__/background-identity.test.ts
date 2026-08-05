// ABOUTME: Verifies background identity messages expose only public profile data.
// ABOUTME: Prevents private signing material from crossing into extension UI or content scripts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDefineBackground = (globalThis as any).defineBackground;

describe("background identity messages", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalDefineBackground === undefined) {
      delete (globalThis as any).defineBackground;
    } else {
      (globalThis as any).defineBackground = originalDefineBackground;
    }
  });

  it("returns public identity and profile data without private keys", async () => {
    const onMessageAddListener = vi.fn();
    const storageData: Record<string, unknown> = {
      playerIdentity: {
        public: {
          publicKey: "pk_test",
          playerStyle: { colorPalette: ["#4a9a8a"] },
        },
        privateKey: { kty: "EC", d: "private" },
      },
      playerDiscoveredSites: ["example.com"],
    };

    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => ({
        getPendingEvents: vi.fn(),
        markEventsAsUploaded: vi.fn(),
        addEvents: vi.fn(),
        getGlobalStats: vi.fn(),
        getAllDomains: vi.fn(),
        getAllEvents: vi.fn(),
      })),
    }));
    vi.doMock("../storage/sync", () => ({
      uploadEvents: vi.fn(),
    }));
    vi.doMock("../storage/restore", () => ({
      fetchEventsByPid: vi.fn(),
    }));
    vi.doMock("webextension-polyfill", () => ({
      default: {
        storage: {
          local: {
            get: vi.fn((keys?: any) => {
              if (Array.isArray(keys)) {
                return Promise.resolve(
                  Object.fromEntries(keys.map((key) => [key, storageData[key]])),
                );
              }
              if (typeof keys === "string") {
                return Promise.resolve({ [keys]: storageData[keys] });
              }
              return Promise.resolve({ ...storageData });
            }),
            set: vi.fn((items: Record<string, unknown>) => {
              Object.assign(storageData, items);
              return Promise.resolve();
            }),
            remove: vi.fn(),
          },
          session: {
            setAccessLevel: vi.fn().mockResolvedValue(undefined),
          },
        },
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: onMessageAddListener },
          getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        },
        tabs: {
          create: vi.fn().mockResolvedValue(undefined),
          captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,test"),
        },
        alarms: {
          create: vi.fn(),
          onAlarm: { addListener: vi.fn() },
        },
      },
    }));

    (globalThis as any).defineBackground = (setup: () => void) => {
      setup();
      return setup;
    };

    await import("../entrypoints/background");

    const listener = onMessageAddListener.mock.calls[0][0];
    const publicIdentity = await new Promise((resolve) => {
      const handled = listener({ type: "GET_PUBLIC_PLAYER_IDENTITY" }, {}, resolve);
      expect(handled).toBe(true);
    });
    const profile = await new Promise((resolve) => {
      const handled = listener({ type: "GET_PLAYER_PROFILE" }, {}, resolve);
      expect(handled).toBe(true);
    });

    expect(publicIdentity).toEqual({
      publicKey: "pk_test",
      playerStyle: { colorPalette: ["#4a9a8a"] },
    });
    expect(JSON.stringify(publicIdentity)).not.toContain("private");
    expect(profile).toEqual({
      identity: publicIdentity,
      discoveredSites: ["example.com"],
    });
    expect(JSON.stringify(profile)).not.toContain("private");
  });
});
