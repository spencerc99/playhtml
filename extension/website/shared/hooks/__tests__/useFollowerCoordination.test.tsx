// ABOUTME: Verifies follower windows judge a peer's cursor claim by their own clock.
// ABOUTME: A peer's performance.now() starts at its own load time, so its stamp cannot be compared here.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  useFollowerCoordination,
  type FollowerCoordination,
} from "../useFollowerCoordination";

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage() {}
  close() {}
}

afterEach(() => {
  FakeChannel.all = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("honors a fresh claim from a peer whose clock started later", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  // This window has been open for 100s; the peer opened 60s ago, so its
  // performance.now() reads 60s behind ours for the same moment.
  vi.spyOn(performance, "now").mockReturnValue(100_000);
  vi.spyOn(Math, "random").mockReturnValue(0);

  let coordination: FollowerCoordination | null = null;
  const Probe = () => {
    coordination = useFollowerCoordination({
      role: "follower",
      followerId: "b",
    });
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  const [channel] = FakeChannel.all;

  channel.onmessage?.({
    data: { type: "claim", cursor: 1, by: "a", ts: 40_000 },
  });

  const candidates = [
    { index: 1, x: 0, y: 0, progress: 0 },
    { index: 2, x: 0, y: 0, progress: 0 },
  ];
  expect(coordination!.pickSubject(candidates, null)).toBe(2);
  await act(async () => root.unmount());
});
