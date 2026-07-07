// ABOUTME: Configures React test assertions and the mocked playhtml singleton.
// ABOUTME: Provides deterministic readiness, presence, and page-data test doubles.
import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect method with methods from React Testing Library
expect.extend(matchers);

// Runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
  resetMockReady();
});

// Create a mock playhtml instance
const presenceListeners = new Map<string, Set<(presences: Map<string, unknown>) => void>>();
const mockPresences = new Map<string, unknown>();

// Mock users module: a minimal in-memory identity + getAll/onChange, enough
// to drive usePlayerIdentity/useUsers tests without a real Yjs/PartyKit stack.
const usersChangeListeners = new Set<(users: Map<string, unknown>) => void>();
const mockSelfIdentity = {
  pid: "mock-pid",
  name: undefined as string | undefined,
  color: "#123456",
  custom: {} as Record<string, unknown>,
};

function notifyUsersChange() {
  const snapshot = mockGetAllUsers();
  for (const cb of usersChangeListeners) cb(snapshot);
}

function mockGetAllUsers(): Map<string, unknown> {
  return new Map([
    [
      mockSelfIdentity.pid,
      {
        pid: mockSelfIdentity.pid,
        name: mockSelfIdentity.name,
        color: mockSelfIdentity.color,
        custom: mockSelfIdentity.custom,
        isMe: true,
      },
    ],
  ]);
}

const mockUsers = {
  me: {
    get pid() {
      return mockSelfIdentity.pid;
    },
    get name() {
      return mockSelfIdentity.name;
    },
    set name(value: string | undefined) {
      mockSelfIdentity.name = value;
      notifyUsersChange();
    },
    get color() {
      return mockSelfIdentity.color;
    },
    set color(value: string) {
      mockSelfIdentity.color = value;
      notifyUsersChange();
    },
    get custom() {
      return { ...mockSelfIdentity.custom };
    },
    set custom(value: Record<string, unknown>) {
      mockSelfIdentity.custom = { ...value };
      notifyUsersChange();
    },
    setCustom: vi.fn((key: string, value: unknown) => {
      if (value === undefined) {
        delete mockSelfIdentity.custom[key];
      } else {
        mockSelfIdentity.custom[key] = value;
      }
      notifyUsersChange();
    }),
  },
  getAll: vi.fn(() => mockGetAllUsers()),
  onChange: vi.fn((callback: (users: Map<string, unknown>) => void) => {
    usersChangeListeners.add(callback);
    callback(mockGetAllUsers());
    return () => usersChangeListeners.delete(callback);
  }),
};

let mockReadyResolve: () => void = () => {};
let mockReadyReject: (error: unknown) => void = () => {};
let mockReady: Promise<void>;

function resetMockReady() {
  mockReady = new Promise<void>((resolve, reject) => {
    mockReadyResolve = resolve;
    mockReadyReject = reject;
  });
  mockReady.catch(() => {});
  mockedPlayhtml.isLoading = true;
  mockedPlayhtml.init.mockImplementation(() => {
    mockedPlayhtml.isInitialized = true;
    mockedPlayhtml.isLoading = false;
    mockReadyResolve();
    return mockReady;
  });
}

const mockedPlayhtml = {
  isInitialized: false,
  isLoading: true,
  get ready() {
    return mockReady;
  },
  resetReady: resetMockReady,
  resolveReady: () => {
    mockedPlayhtml.isLoading = false;
    mockReadyResolve();
  },
  rejectReady: (error: unknown) => {
    mockReadyReject(error);
  },
  configure: vi.fn(),
  init: vi.fn().mockImplementation(() => {
    mockedPlayhtml.isInitialized = true;
    mockedPlayhtml.isLoading = false;
    mockReadyResolve();
    return mockReady;
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
  users: mockUsers,
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

resetMockReady();

// Make mock available to tests
vi.stubGlobal("MOCKED_PLAYHTML", mockedPlayhtml);

// Mock playhtml initialization and event functions
vi.mock("playhtml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("playhtml")>();
  return { ...actual, playhtml: mockedPlayhtml };
});
