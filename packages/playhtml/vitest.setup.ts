// JSDOM doesn't implement some layout APIs; mock minimal ones we use.
Object.defineProperty(window, "outerWidth", { value: 1024, writable: true });
Object.defineProperty(window, "innerHeight", { value: 768, writable: true });

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

vi.mock("y-partykit/provider", () => {
  return {
    default: class FakeProvider {
      ws?: {
        send: (s: string) => void;
        addEventListener: (t: string, cb: any) => void;
      };
      awareness: any;
      private listeners: Record<string, Function[]> = {};
      constructor() {
        this.ws = {
          send: vi.fn(),
          addEventListener: vi.fn(),
        } as any;
        const states = new Map<number, any>();
        const local = { state: {} as any };
        this.awareness = {
          getLocalState: () => local.state,
          setLocalStateField: (key: string, value: any) => {
            local.state = { ...local.state, [key]: value };
            this.emit("change", true);
          },
          getStates: () => states,
          on: (t: string, cb: any) => this.on(t, cb),
        };
        queueMicrotask(() => this.emit("sync", true));
      }
      on(t: string, cb: any) {
        this.listeners[t] ??= [];
        this.listeners[t].push(cb);
      }
      emit(t: string, ...args: any[]) {
        (this.listeners[t] || []).forEach((cb) => cb(...args));
      }
    },
  };
});
