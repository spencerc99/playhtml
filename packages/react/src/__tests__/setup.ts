import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect method with methods from React Testing Library
expect.extend(matchers);

// Runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});

// Create a mock playhtml instance
const presenceListeners = new Map<string, Set<(presences: Map<string, unknown>) => void>>();
const mockPresences = new Map<string, unknown>();

const mockedPlayhtml = {
  isInitialized: false,
  init: vi.fn().mockImplementation(() => {
    mockedPlayhtml.isInitialized = true;
    return Promise.resolve();
  }),
  setupPlayElements: vi.fn(),
  setupPlayElement: vi.fn(),
  removePlayElement: vi.fn(),
  deleteElementData: vi.fn(),
  elementHandlers: {},
  globalData: new Map(),
  dispatchPlayEvent: vi.fn(),
  registerPlayEventListener: vi.fn().mockReturnValue("mock-id"),
  removePlayEventListener: vi.fn(),
  handleNavigation: vi.fn().mockResolvedValue(undefined),
  presence: {
    setMyPresence: vi.fn((channel: string, data: unknown) => {
      mockPresences.set("me", { ...data, isMe: true, cursor: null });
      const listeners = presenceListeners.get(channel);
      if (listeners) for (const cb of listeners) cb(new Map(mockPresences));
    }),
    getPresences: vi.fn(() => new Map(mockPresences)),
    onPresenceChange: vi.fn(
      (channel: string, callback: (presences: Map<string, unknown>) => void) => {
        let set = presenceListeners.get(channel);
        if (!set) {
          set = new Set();
          presenceListeners.set(channel, set);
        }
        set.add(callback);
        return () => set!.delete(callback);
      },
    ),
    getMyIdentity: vi.fn(() => ({ stableId: "me", name: "Me", color: "#fff" })),
  },
  createPageData: vi.fn((_name: string, defaultValue: unknown) => {
    let data = defaultValue;
    const listeners = new Set<(d: unknown) => void>();
    return {
      getData: () => data,
      setData: (next: unknown | ((draft: unknown) => void)) => {
        data = typeof next === "function" ? (next as any)(data) ?? data : next;
        for (const cb of listeners) cb(data);
      },
      onUpdate: (cb: (d: unknown) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      destroy: vi.fn(),
    };
  }),
  createPresenceRoom: vi.fn((_name: string) => ({
    presence: mockedPlayhtml.presence,
    destroy: vi.fn(),
  })),
};

// Make mock available to tests
vi.stubGlobal("MOCKED_PLAYHTML", mockedPlayhtml);

// Mock playhtml initialization and event functions
vi.mock("playhtml", () => {
  return { playhtml: mockedPlayhtml };
});
