// ABOUTME: Tests for playhtml.dispatchEvent and playhtml.onEvent (page-scoped).
// ABOUTME: Verifies the new event API works alongside the deprecated dispatchPlayEvent.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { playhtml } from "../index";

// Reach the latest FakeProvider instance (set up in vitest.setup.ts) so
// tests can simulate inbound messages via emit("custom-message", payload).
function latestProvider(): any {
  return (globalThis as any).__getLatestFakeProvider();
}

beforeAll(async () => {
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml page-scoped events", () => {
  it("dispatchEvent is a function", () => {
    expect(playhtml.dispatchEvent).toBeTypeOf("function");
  });

  it("onEvent is a function", () => {
    expect(playhtml.onEvent).toBeTypeOf("function");
  });

  it("onEvent returns an unsubscribe function", () => {
    const unsub = playhtml.onEvent("test-page-event", () => {});
    expect(unsub).toBeTypeOf("function");
    unsub();
  });

  it("dispatchEvent does not throw", () => {
    const unsub = playhtml.onEvent("test-dispatch", () => {});
    expect(() => playhtml.dispatchEvent("test-dispatch", { x: 1 })).not.toThrow();
    unsub();
  });

  it("dispatchEvent without payload does not throw", () => {
    const unsub = playhtml.onEvent("test-no-payload", () => {});
    expect(() => playhtml.dispatchEvent("test-no-payload")).not.toThrow();
    unsub();
  });

  it("unsubscribe is safe to call twice", () => {
    const unsub = playhtml.onEvent("test-double-unsub", () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  describe("wire roundtrip", () => {
    it("onEvent receives payloads from incoming custom-message frames", () => {
      const received: unknown[] = [];
      const unsub = playhtml.onEvent("roundtrip", (payload) => {
        received.push(payload);
      });
      try {
        latestProvider().emit(
          "custom-message",
          JSON.stringify({ type: "roundtrip", eventPayload: { hello: "world" } }),
        );
        expect(received).toEqual([{ hello: "world" }]);
      } finally {
        unsub();
      }
    });

    it("unsubscribe actually stops delivery", () => {
      const received: unknown[] = [];
      const unsub = playhtml.onEvent("stop-delivery", (p) => received.push(p));
      unsub();
      latestProvider().emit(
        "custom-message",
        JSON.stringify({ type: "stop-delivery", eventPayload: 1 }),
      );
      expect(received).toEqual([]);
    });

    it("deprecated registerPlayEventListener delivers via shared wire format", () => {
      const received: unknown[] = [];
      const id = playhtml.registerPlayEventListener("old-api", {
        onEvent: ({ eventPayload }) => received.push(eventPayload),
      });
      try {
        latestProvider().emit(
          "custom-message",
          JSON.stringify({ type: "old-api", eventPayload: 42 }),
        );
        expect(received).toEqual([42]);
      } finally {
        playhtml.removePlayEventListener("old-api", id);
      }
    });

    it("new onEvent and deprecated register fire together on same type", () => {
      const newReceived: unknown[] = [];
      const oldReceived: unknown[] = [];
      const unsub = playhtml.onEvent("shared", (p) => newReceived.push(p));
      const id = playhtml.registerPlayEventListener("shared", {
        onEvent: ({ eventPayload }) => oldReceived.push(eventPayload),
      });
      try {
        latestProvider().emit(
          "custom-message",
          JSON.stringify({ type: "shared", eventPayload: "both" }),
        );
        expect(newReceived).toEqual(["both"]);
        expect(oldReceived).toEqual(["both"]);
      } finally {
        unsub();
        playhtml.removePlayEventListener("shared", id);
      }
    });
  });
});

describe("playhtml page-scoped events before init", () => {
  it("onEvent returns valid unsubscribe before init", async () => {
    vi.resetModules();
    delete (globalThis as any).playhtml;
    const mod = await import("../index");
    const unsub = mod.playhtml.onEvent("pre-init-evt", () => {});
    expect(unsub).toBeTypeOf("function");
    unsub();
  });

  it("dispatchEvent does not throw before init", async () => {
    vi.resetModules();
    delete (globalThis as any).playhtml;
    const mod = await import("../index");
    expect(() => mod.playhtml.dispatchEvent("pre-init-evt", {})).not.toThrow();
  });
});
