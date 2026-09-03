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
const usersChangeListeners = new Set<(users: Array<Record<string, unknown>>) => void>();
const mockSelfIdentity = {
  pid: "mock-pid",
  name: undefined as string | undefined,
  color: "#123456",
};

function notifyUsersChange() {
  const snapshot = mockGetAllUsers();
  for (const cb of usersChangeListeners) cb(snapshot);
}

// Mutable so tests can simulate an identity change (e.g. the extension
// injecting identity post-sync) and assert usePresence().myIdentity updates.
const mockPlayerIdentity = {
  publicKey: "me",
  name: "Me" as string | undefined,
  playerStyle: {
    colorPalette: ["#fff"] as string[],
    cursorStyle: undefined as string | undefined,
  },
  createdAt: undefined as number | undefined,
};

function mockGetAllUsers(): Array<Record<string, unknown>> {
  return [
    {
      pid: mockSelfIdentity.pid,
      name: mockSelfIdentity.name,
      color: mockSelfIdentity.color,
      isMe: true,
    },
  ];
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
  },
  getAll: vi.fn(() => mockGetAllUsers()),
  onChange: vi.fn((callback: (users: Array<Record<string, unknown>>) => void) => {
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
  mockedPlayhtml.createPresenceRoom.mockImplementation(createMockPresenceRoom);
}

function createMockPresenceRoom(_name: string) {
  return {
    presence: mockedPlayhtml.presence,
    destroy: vi.fn(),
  };
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
  getHandle: vi.fn(),
  dispatchPlayEvent: vi.fn(),
  registerPlayEventListener: vi.fn().mockReturnValue("mock-id"),
  removePlayEventListener: vi.fn(),
  handleNavigation: vi.fn().mockResolvedValue(undefined),
  presence: {
    setMyPresence: vi.fn((channel: string, data: unknown) => {
      const view: Record<string, unknown> = {
        ...(mockPresences.get("me") as Record<string, unknown> | undefined),
        isMe: true,
        cursor: null,
      };
      if (data === null) {
        delete view[channel];
      } else {
        view[channel] = data;
      }
      mockPresences.set("me", view);
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
    getMyIdentity: vi.fn(() => ({
      publicKey: mockPlayerIdentity.publicKey,
      name: mockPlayerIdentity.name,
      playerStyle: { ...mockPlayerIdentity.playerStyle },
      createdAt: mockPlayerIdentity.createdAt,
    })),
  },
  users: mockUsers,
  setMockPlayerIdentity: (next: Partial<typeof mockPlayerIdentity>) => {
    Object.assign(mockPlayerIdentity, next);
    notifyUsersChange();
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
  createPresenceRoom: vi.fn(createMockPresenceRoom),
};

resetMockReady();

// Make mock available to tests
vi.stubGlobal("MOCKED_PLAYHTML", mockedPlayhtml);

// Mock playhtml initialization and event functions
vi.mock("playhtml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("playhtml")>();
  return { ...actual, playhtml: mockedPlayhtml };
});
