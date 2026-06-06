// ABOUTME: Verifies configure({ playerIdentity }) emits color/name events.
// ABOUTME: The extension identity-injection path depends on these so React reacts.

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { CursorClientAwareness } from "../cursor-client";

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

describe("configure({ playerIdentity }) event emission", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((n) => n.remove());
  });

  it("emits a color event when the configured identity changes color", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    const colors: string[] = [];
    window.cursors!.on("color", (c: string) => colors.push(c));

    client.configure({
      playerIdentity: {
        publicKey: "injected-key",
        playerStyle: { colorPalette: ["#ffae00"] },
      } as any,
    });

    expect(colors).toContain("#ffae00");
    client.destroy?.();
  });

  it("emits a name event when the configured identity changes name", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    const names: Array<string | undefined> = [];
    window.cursors!.on("name", (n: string | undefined) => names.push(n));

    client.configure({
      playerIdentity: {
        publicKey: "local-key",
        name: "spencer",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    expect(names).toContain("spencer");
    client.destroy?.();
  });

  it("does not emit a color event when the color is unchanged", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    const colors: string[] = [];
    window.cursors!.on("color", (c: string) => colors.push(c));

    client.configure({
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    expect(colors).toEqual([]);
    client.destroy?.();
  });
});
