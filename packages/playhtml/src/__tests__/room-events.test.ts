// ABOUTME: Tests for PresenceRoom.dispatchEvent and PresenceRoom.onEvent.
// ABOUTME: Verifies ephemeral event dispatch and listener lifecycle.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { playhtml } from "../index";

function latestProvider(): any {
  return (globalThis as any).__getLatestFakeProvider();
}

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

    describe("wire roundtrip", () => {
      it("onEvent receives payloads from incoming custom-message frames", () => {
        const room = playhtml.createPresenceRoom("event-roundtrip");
        const roomProvider = latestProvider();
        try {
          const received: unknown[] = [];
          room.onEvent("ping", (payload) => received.push(payload));
          roomProvider.emit(
            "custom-message",
            JSON.stringify({ type: "ping", eventPayload: { count: 3 } }),
          );
          expect(received).toEqual([{ count: 3 }]);
        } finally {
          room.destroy();
        }
      });

      it("unsubscribe stops delivery", () => {
        const room = playhtml.createPresenceRoom("event-room-stop");
        const roomProvider = latestProvider();
        try {
          const received: unknown[] = [];
          const unsub = room.onEvent("x", (p) => received.push(p));
          unsub();
          roomProvider.emit(
            "custom-message",
            JSON.stringify({ type: "x", eventPayload: "nope" }),
          );
          expect(received).toEqual([]);
        } finally {
          room.destroy();
        }
      });

      it("dispatchEvent calls provider.sendMessage with EventMessage JSON", () => {
        const room = playhtml.createPresenceRoom("event-room-dispatch");
        const roomProvider = latestProvider();
        try {
          room.dispatchEvent("hello", { a: 1 });
          expect(roomProvider.sendMessage).toHaveBeenCalledWith(
            JSON.stringify({ type: "hello", eventPayload: { a: 1 } }),
          );
        } finally {
          room.destroy();
        }
      });
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
