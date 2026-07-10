// ABOUTME: Drives EmoteBroadcaster with a fake PresenceAPI (no mocked behavior).
// ABOUTME: Covers local-first emit, dedupe by id, throttle, and targetPid passthrough.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmoteBroadcaster } from "../features/emotes/EmoteBroadcaster";
import type { PresenceView } from "@playhtml/common";

function makeFakePresence() {
  const listeners: Record<string, (m: Map<string, PresenceView>) => void> = {};
  const sent: Array<{ channel: string; data: unknown }> = [];
  return {
    api: {
      setMyPresence: (channel: string, data: unknown) => {
        sent.push({ channel, data });
      },
      getPresences: () => new Map(),
      onPresenceChange: (
        channel: string,
        cb: (m: Map<string, PresenceView>) => void,
      ) => {
        listeners[channel] = cb;
        return () => delete listeners[channel];
      },
      getMyIdentity: () => ({ publicKey: "me" }) as any,
    },
    sent,
    fire(channel: string, m: Map<string, PresenceView>) {
      listeners[channel]?.(m);
    },
  };
}

describe("EmoteBroadcaster", () => {
  let now = 10_000;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  it("emits locally and broadcasts to the emotes channel", () => {
    const fake = makeFakePresence();
    const seen: Array<[string, string, boolean]> = [];
    const b = new EmoteBroadcaster(fake.api as any, (pid, e, isMe) =>
      seen.push([pid, e.emoteId, isMe]),
    );
    b.emote("wave");
    expect(seen[0][0]).toBe("me");
    expect(seen[0][1]).toBe("wave");
    expect(seen[0][2]).toBe(true);
    expect(fake.sent[0].channel).toBe("emotes");
  });

  it("carries targetPid", () => {
    const fake = makeFakePresence();
    const b = new EmoteBroadcaster(fake.api as any, () => {});
    b.emote("poke", "peerX");
    expect((fake.sent[0].data as any).targetPid).toBe("peerX");
  });

  it("throttles rapid sends but always renders locally", () => {
    const fake = makeFakePresence();
    let localCount = 0;
    const b = new EmoteBroadcaster(fake.api as any, () => localCount++);
    b.emote("wave");
    b.emote("wave"); // within 500ms
    expect(localCount).toBe(2);
    expect(fake.sent).toHaveLength(1);
  });

  it("renders peer emotes once (dedupe by id)", () => {
    const fake = makeFakePresence();
    const seen: string[] = [];
    new EmoteBroadcaster(fake.api as any, (pid) => seen.push(pid));
    const msg = { id: "abc", emoteId: "dance", ts: now };
    const view = { emotes: msg } as unknown as PresenceView;
    fake.fire("emotes", new Map([["peer1", view]]));
    fake.fire("emotes", new Map([["peer1", view]])); // same id again
    expect(seen).toEqual(["peer1"]);
  });
});
