import { vi } from "vitest";

// Mock window dimensions
Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
Object.defineProperty(window, "scrollX", { value: 0, writable: true });
Object.defineProperty(window, "scrollY", { value: 0, writable: true });

// Mock document dimensions
Object.defineProperty(document.documentElement, "scrollWidth", { value: 1024, writable: true });
Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, writable: true });
Object.defineProperty(document.documentElement, "scrollLeft", { value: 0, writable: true });
Object.defineProperty(document.documentElement, "scrollTop", { value: 0, writable: true });

// Mock devicePixelRatio
Object.defineProperty(window, "devicePixelRatio", { value: 1, writable: true });

// Mock visualViewport
Object.defineProperty(window, "visualViewport", {
  value: {
    scale: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
});

// Mock getComputedStyle
const originalGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = (element: Element) => {
  const style = originalGetComputedStyle(element);
  return {
    ...style,
    cursor: (element as HTMLElement).dataset.cursor || "auto",
    getPropertyValue: (prop: string) => {
      if (prop === "cursor") {
        return (element as HTMLElement).dataset.cursor || "auto";
      }
      return style.getPropertyValue(prop);
    },
  } as CSSStyleDeclaration;
};

// Mock webextension-polyfill
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({}),
      onMessage: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com" }]),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    },
  },
}));

// Mock IndexedDB (simplified)
const mockIndexedDB = {
  open: vi.fn().mockReturnValue({
    result: {
      transaction: vi.fn().mockReturnValue({
        objectStore: vi.fn().mockReturnValue({
          add: vi.fn(),
          delete: vi.fn(),
          count: vi.fn(),
          index: vi.fn().mockReturnValue({
            openCursor: vi.fn(),
          }),
        }),
      }),
      objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
    },
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  }),
};

Object.defineProperty(window, "indexedDB", {
  value: mockIndexedDB,
  writable: true,
});

// Suppress verbose logging during tests
vi.mock("../config", () => ({
  VERBOSE: false,
}));

// Mock participant storage
vi.mock("../storage/participant", () => ({
  getParticipantId: vi.fn().mockResolvedValue("test-participant-id"),
  getSessionId: vi.fn().mockResolvedValue("test-session-id"),
  getTimezone: vi.fn().mockReturnValue("America/New_York"),
}));
