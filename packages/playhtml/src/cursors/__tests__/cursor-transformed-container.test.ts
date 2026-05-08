// ABOUTME: Verifies cursor coords round-trip through a transformed container.
// ABOUTME: Stubs DOMMatrixReadOnly because jsdom doesn't ship it.
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as Y from "yjs";
import { CursorClientAwareness } from "../cursor-client";

// Minimal DOMMatrixReadOnly polyfill for tests. Supports the affine subset
// (translate + scale) that the fridge uses; that's all the production code
// invokes on the matrix.
class TestMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: string) {
    if (!init || init === "none") return;
    // Accept "matrix(a, b, c, d, e, f)" — the form getComputedStyle returns.
    const match = /matrix\(([^)]+)\)/.exec(init);
    if (match) {
      const [a, b, c, d, e, f] = match[1].split(",").map((s) => parseFloat(s.trim()));
      Object.assign(this, { a, b, c, d, e, f });
      return;
    }
    // Accept "translate(Xpx, Ypx) scale(S)" for convenience.
    const tx = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(init);
    const sc = /scale\(([-\d.]+)\)/.exec(init);
    if (tx) {
      this.e = parseFloat(tx[1]);
      this.f = parseFloat(tx[2]);
    }
    if (sc) {
      this.a = parseFloat(sc[1]);
      this.d = parseFloat(sc[1]);
    }
  }
  inverse(): TestMatrix {
    const m = new TestMatrix();
    m.a = 1 / this.a;
    m.d = 1 / this.d;
    m.e = -this.e / this.a;
    m.f = -this.f / this.d;
    return m;
  }
  transformPoint(p: { x: number; y: number }): { x: number; y: number } {
    return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f };
  }
}

function makeFakeProvider() {
  const doc = new Y.Doc();
  const listeners: Array<(args: any) => void> = [];
  const awareness: any = {
    _states: new Map<number, Record<string, unknown>>(),
    getStates() {
      return this._states;
    },
    setLocalState() {},
    setLocalStateField(field: string, value: unknown) {
      const local = (this._states.get(this.clientID) as Record<string, unknown>) ?? {};
      local[field] = value;
      this._states.set(this.clientID, local);
    },
    getLocalState() {
      return this._states.get(this.clientID) ?? null;
    },
    on(_event: string, cb: (args: any) => void) {
      listeners.push(cb);
    },
    off() {},
    emit(args: any) {
      listeners.forEach((cb) => cb(args));
    },
    clientID: 1,
    doc,
  };
  return { doc, awareness, on() {}, off() {} } as any;
}

describe("transformed cursor container", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
    vi.stubGlobal("DOMMatrixReadOnly", TestMatrix);
  });

  it("client→storage→client round-trips through a translate+scale container", () => {
    const container = document.createElement("div");
    container.id = "fridge-content";
    document.body.appendChild(container);

    // Stub the parts of the DOM that aren't implemented in jsdom.
    container.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 0, height: 0, right: 0, bottom: 0, x: 100, y: 50, toJSON() {} }) as DOMRect;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ transform: "translate(20px, 30px) scale(2)" }) as CSSStyleDeclaration,
    );

    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      coordinateMode: "absolute",
      container: "#fridge-content",
      playerIdentity: {
        publicKey: "pk-test",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    // Access the private helpers via the instance for the round-trip check.
    const c2s = (client as any).clientToStorage.bind(client);
    const s2c = (client as any).storageToClient.bind(client);

    const stored = c2s(300, 200);
    const back = s2c(stored.x, stored.y);
    expect(back.x).toBeCloseTo(300, 5);
    expect(back.y).toBeCloseTo(200, 5);

    // Container's getBoundingClientRect already reflects its transform —
    // rect.left = 100 means the post-transform top-left is at viewport
    // (100, 50). Translate is already absorbed in the rect, so the inverse
    // is purely (clientX - rect.left) / scale. With scale=2:
    //   (300 - 100) / 2 = 100
    //   (200 - 50) / 2  = 75
    expect(stored.x).toBeCloseTo(100, 5);
    expect(stored.y).toBeCloseTo(75, 5);

    client.destroy();
  });

  it("falls through to default coords when the container is document.body", () => {
    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      coordinateMode: "absolute",
      // container undefined → resolves to document.body → identity branch
      playerIdentity: {
        publicKey: "pk-test-2",
        playerStyle: { colorPalette: ["#00ff00"] },
      } as any,
    });
    const c2s = (client as any).clientToStorage.bind(client);
    const stored = c2s(500, 400);
    // In absolute mode with no scroll/zoom, document coords == client coords.
    expect(stored.x).toBeCloseTo(500, 5);
    expect(stored.y).toBeCloseTo(400, 5);
    client.destroy();
  });
});
