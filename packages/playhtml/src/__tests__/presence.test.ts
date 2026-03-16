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
  });

  it("setMyPresence with null clears a channel", () => {
    playhtml.presence.setMyPresence("test-channel", { value: 42 });
    playhtml.presence.setMyPresence("test-channel", null);
  });

  it("getPresences includes self with isMe flag", () => {
    const presences = playhtml.presence.getPresences();
    expect(presences).toBeInstanceOf(Map);
    // Single-client test: should have exactly one entry (self)
    expect(presences.size).toBe(1);
    const self = Array.from(presences.values())[0];
    expect(self.isMe).toBe(true);
  });

  it("getPresences includes custom presence channels", () => {
    playhtml.presence.setMyPresence("status", { text: "online" });
    const presences = playhtml.presence.getPresences();
    const self = Array.from(presences.values()).find((p) => p.isMe)!;
    expect((self as any).status).toEqual({ text: "online" });

    // Clean up
    playhtml.presence.setMyPresence("status", null);
  });

  it("onPresenceChange requires a channel and returns unsubscribe", () => {
    const unsub = playhtml.presence.onPresenceChange("status", () => {});
    expect(unsub).toBeTypeOf("function");
    unsub();
  });
});
