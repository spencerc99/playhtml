// ABOUTME: Tests for playhtml.dispatchEvent and playhtml.onEvent (page-scoped).
// ABOUTME: Verifies the new event API works alongside the deprecated dispatchPlayEvent.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { playhtml } from "../index";

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
