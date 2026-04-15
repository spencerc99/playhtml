// ABOUTME: Tests for PresenceRoom.dispatchEvent and PresenceRoom.onEvent.
// ABOUTME: Verifies ephemeral event dispatch and listener lifecycle.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { playhtml } from "../index";

describe("PresenceRoom events", () => {
  describe("after init", () => {
    beforeAll(async () => {
      await playhtml.init({});
      await new Promise((r) => setTimeout(r, 0));
    });

    it("room has dispatchEvent and onEvent methods", () => {
      const room = playhtml.createPresenceRoom("event-shape");
      try {
        expect(room.dispatchEvent).toBeTypeOf("function");
        expect(room.onEvent).toBeTypeOf("function");
      } finally {
        room.destroy();
      }
    });

    it("onEvent returns an unsubscribe function", () => {
      const room = playhtml.createPresenceRoom("event-unsub");
      try {
        const unsub = room.onEvent("test", () => {});
        expect(unsub).toBeTypeOf("function");
        unsub();
      } finally {
        room.destroy();
      }
    });

    it("dispatchEvent does not throw", () => {
      const room = playhtml.createPresenceRoom("event-dispatch");
      try {
        expect(() => room.dispatchEvent("test", { x: 1 })).not.toThrow();
      } finally {
        room.destroy();
      }
    });

    it("dispatchEvent without payload does not throw", () => {
      const room = playhtml.createPresenceRoom("event-no-payload");
      try {
        expect(() => room.dispatchEvent("ping")).not.toThrow();
      } finally {
        room.destroy();
      }
    });

    it("unsubscribe is safe to call twice", () => {
      const room = playhtml.createPresenceRoom("event-double-unsub");
      try {
        const unsub = room.onEvent("test", () => {});
        unsub();
        expect(() => unsub()).not.toThrow();
      } finally {
        room.destroy();
      }
    });
  });

  describe("before init", () => {
    it("createPresenceRoom throws before init", async () => {
      vi.resetModules();
      delete (globalThis as any).playhtml;
      const mod = await import("../index");
      expect(() => mod.playhtml.createPresenceRoom("pre-init")).toThrow(
        /not available before init/,
      );
    });
  });
});
