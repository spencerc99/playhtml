import { describe, it, expect, beforeAll } from "vitest";
import { playhtml } from "../index";

beforeAll(async () => {
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml.presence", () => {
  it("is available after init", () => {
    expect(playhtml.presence).toBeDefined();
    expect(playhtml.presence.getMyIdentity).toBeTypeOf("function");
    expect(playhtml.presence.setMyPresence).toBeTypeOf("function");
    expect(playhtml.presence.getPresences).toBeTypeOf("function");
    expect(playhtml.presence.onPresenceChange).toBeTypeOf("function");
  });

  it("getMyIdentity returns a PlayerIdentity with publicKey", () => {
    const id = playhtml.presence.getMyIdentity();
    expect(id.publicKey).toBeTruthy();
    expect(id.playerStyle).toBeDefined();
    expect(id.playerStyle.colorPalette).toBeInstanceOf(Array);
  });

  it("setMyPresence sets a named channel", () => {
    playhtml.presence.setMyPresence("test-channel", { value: 42 });
    // We can't directly read our own presence from getPresences (self excluded),
    // but we can verify it doesn't throw
  });

  it("setMyPresence with null clears a channel", () => {
    playhtml.presence.setMyPresence("test-channel", { value: 42 });
    playhtml.presence.setMyPresence("test-channel", null);
    // Should not throw
  });

  it("getPresences returns a Map (empty in single-client test)", () => {
    const presences = playhtml.presence.getPresences();
    expect(presences).toBeInstanceOf(Map);
    // In a single-client test, self is excluded, so map should be empty
    expect(presences.size).toBe(0);
  });

  it("onPresenceChange returns an unsubscribe function", () => {
    const unsub = playhtml.presence.onPresenceChange(() => {});
    expect(unsub).toBeTypeOf("function");
    unsub();
  });
});
