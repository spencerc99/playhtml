// ABOUTME: Verifies window.cursors.custom / setCustom persistence and event emission.
// ABOUTME: Covers replace-all semantics, merge/delete, ephemeral keys, and the size cap.

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { CursorClientAwareness } from "../cursor-client";
import { PLAYER_IDENTITY_STORAGE_KEY } from "@playhtml/common";

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

describe("window.cursors.custom / setCustom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((n) => n.remove());
    localStorage.clear();
  });

  it("replaces the whole bag and emits a custom event", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    const customEvents: Array<Record<string, unknown>> = [];
    window.cursors!.on("custom", (c: Record<string, unknown>) =>
      customEvents.push(c),
    );

    window.cursors!.custom = { mood: "curious" };

    expect(window.cursors!.custom).toEqual({ mood: "curious" });
    expect(customEvents).toContainEqual({ mood: "curious" });

    window.cursors!.custom = { mood: "sleepy", streak: 3 };
    expect(window.cursors!.custom).toEqual({ mood: "sleepy", streak: 3 });

    client.destroy?.();
  });

  it("does not emit a custom event when the bag is unchanged", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    window.cursors!.custom = { mood: "curious" };

    const customEvents: Array<Record<string, unknown>> = [];
    window.cursors!.on("custom", (c: Record<string, unknown>) =>
      customEvents.push(c),
    );

    window.cursors!.custom = { mood: "curious" };
    expect(customEvents).toEqual([]);

    client.destroy?.();
  });

  it("setCustom merges a single key without touching others", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    window.cursors!.custom = { mood: "curious", streak: 3 };
    window.cursors!.setCustom("mood", "sleepy");

    expect(window.cursors!.custom).toEqual({ mood: "sleepy", streak: 3 });

    client.destroy?.();
  });

  it("setCustom deletes the key when value is undefined", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    window.cursors!.custom = { mood: "curious", streak: 3 };
    window.cursors!.setCustom("mood", undefined);

    expect(window.cursors!.custom).toEqual({ streak: 3 });

    client.destroy?.();
  });

  it("keeps persist:false keys in the published identity but strips them from localStorage", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    window.cursors!.setCustom("streak", 3);
    window.cursors!.setCustom("typing", true, { persist: false });

    expect(window.cursors!.custom).toEqual({ streak: 3, typing: true });

    const stored = JSON.parse(
      localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY)!,
    );
    expect(stored.custom).toEqual({ streak: 3 });

    client.destroy?.();
  });

  it("clears ephemeral marks when the whole bag is replaced", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    window.cursors!.setCustom("typing", true, { persist: false });
    window.cursors!.custom = { typing: true };

    const stored = JSON.parse(
      localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY)!,
    );
    expect(stored.custom).toEqual({ typing: true });

    client.destroy?.();
  });

  it("throws when the custom bag exceeds 1024 bytes", () => {
    const client = new CursorClientAwareness(makeFakeProvider(), {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#111111"] },
      } as any,
    });

    expect(() => {
      window.cursors!.custom = { blob: "x".repeat(1024) };
    }).toThrow("identity.custom must be 1024 bytes or less");

    expect(() => {
      window.cursors!.setCustom("blob", "x".repeat(1024));
    }).toThrow("identity.custom must be 1024 bytes or less");

    client.destroy?.();
  });
});
