// ABOUTME: Configures browser API shims and provider fakes for playhtml tests.
// ABOUTME: Keeps unit tests deterministic without opening real network providers.
((globalThis as any).litIssuedWarnings ??= new Set<string>()).add("dev-mode");

// JSDOM doesn't implement some layout APIs; mock minimal ones we use.
Object.defineProperty(window, "outerWidth", { value: 1024, writable: true });
Object.defineProperty(window, "innerHeight", { value: 768, writable: true });

const appendHeadChild = document.head.appendChild.bind(document.head);
document.head.appendChild = ((child: Node) => {
  if (
    child instanceof HTMLLinkElement &&
    child.href.includes("https://unpkg.com/playhtml@latest/dist/style.css")
  ) {
    child.href = "data:text/css,/* playhtml */";
  }
  return appendHeadChild(child);
}) as typeof document.head.appendChild;

// Basic getBoundingClientRect mock for created elements in tests
if (!HTMLElement.prototype.getBoundingClientRect) {
  // @ts-ignore
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
      width: 100,
      height: 100,
    } as DOMRect;
  };
}

// Global mocks for modules that rely on browser-only features
import { vi } from "vitest";

vi.mock("y-indexeddb", () => ({ IndexeddbPersistence: class {} }));

vi.mock("y-partyserver/provider", () => {
  return {
    default: class FakeProvider {
      ws?: {
        send: (s: string) => void;
        addEventListener: (t: string, cb: any) => void;
      };
      awareness: any;
      private listeners: Record<string, Function[]> = {};
      private clientId: number = 1;
      roomname: string;
      constructor(_host: string, room: string) {
        if ((globalThis as any).PLAYHTML_TEST_PROVIDER_THROW) {
          throw new Error("test provider init failure");
        }
        this.roomname = room;
        this.ws = {
          send: vi.fn(),
          addEventListener: vi.fn(),
        } as any;
        const states = new Map<number, any>();
        const local = { state: {} as any };
        this.awareness = {
          clientID: this.clientId,
          getLocalState: () => local.state,
          setLocalStateField: (key: string, value: any) => {
            local.state = { ...local.state, [key]: value };
            states.set(this.clientId, local.state);
            // Emit change event with proper structure expected by cursor-client
            // When local state changes, it's considered an "update" for our own client
            this.emit("change", {
              added: [],
              updated: [this.clientId],
              removed: [],
            });
          },
          getStates: () => states,
          on: (t: string, cb: any) => this.on(t, cb),
        };
        ((globalThis as any).PLAYHTML_TEST_PROVIDERS ??= []).push(this);
        if (!(globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC) {
          queueMicrotask(() => this.emit("sync", true));
        }
      }
      on(t: string, cb: any) {
        this.listeners[t] ??= [];
        this.listeners[t].push(cb);
      }
      emit(t: string, ...args: any[]) {
        (this.listeners[t] || []).forEach((cb) => cb(...args));
      }
      destroy() {
        this.listeners = {};
      }
    },
  };
});

vi.mock("partysocket", () => {
  class FakePresencePartySocket {
    readyState = 0; // CONNECTING
    sent: string[] = [];
    closed = false;
    options: Record<string, unknown>;
    private listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      ((globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS ??= []).push(this);
      if (!(globalThis as any).PLAYHTML_TEST_PRESENCE_MANUAL_OPEN) {
        queueMicrotask(() => this.open());
      }
    }

    send(message: string): void {
      if (this.readyState !== 1) return;
      this.sent.push(message);
    }

    close(): void {
      this.closed = true;
      this.readyState = 3; // CLOSED
    }

    addEventListener(type: string, callback: (event: unknown) => void): void {
      const callbacks = this.listeners.get(type) ?? new Set();
      callbacks.add(callback);
      this.listeners.set(type, callbacks);
    }

    removeEventListener(type: string, callback: (event: unknown) => void): void {
      this.listeners.get(type)?.delete(callback);
    }

    open(): void {
      if (this.closed) return;
      this.readyState = 1; // OPEN
      this.dispatch("open", {});
    }

    receive(data: unknown): void {
      this.dispatch("message", { data: JSON.stringify(data) });
    }

    private dispatch(type: string, event: unknown): void {
      for (const callback of this.listeners.get(type) ?? []) {
        callback(event);
      }
    }
  }

  return { default: FakePresencePartySocket };
});

import { beforeEach } from "vitest";

beforeEach(() => {
  (globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS = [];
});

// Silence the noisy multi-line banner during tests while preserving other logs
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  try {
    const suppress = args.some(
      (a) =>
        typeof a === "string" &&
        (a.includes("booting up playhtml") || a.includes("[PLAYHTML]"))
    );
    if (suppress) return;
  } catch {}
  // @ts-ignore
  return originalConsoleLog(...args);
};
