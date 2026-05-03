// ABOUTME: Configures browser API shims and provider fakes for playhtml tests.
// ABOUTME: Keeps unit tests deterministic without opening real network providers.
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
      constructor() {
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
