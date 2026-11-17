// ABOUTME: Verifies the live stream's connection state follows the current socket only.
// ABOUTME: A socket replaced by a new subscription must not mark the new one disconnected.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveEvents } from "../useLiveEvents";
import type { CollectionEvent } from "../../types";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  // The browser delivers close asynchronously, after the caller has moved on.
  close() {}
}

afterEach(() => {
  FakeSocket.all = [];
  vi.unstubAllGlobals();
});

it("keeps the new socket connected when the replaced socket closes late", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("WebSocket", FakeSocket);
  let latest: { events: CollectionEvent[]; connected: boolean } | null = null;
  const Probe = ({ types }: { types: string[] }) => {
    latest = useLiveEvents({ types });
    return null;
  };
  const root = createRoot(document.createElement("div"));

  await act(async () => root.render(<Probe types={["cursor"]} />));
  const [first] = FakeSocket.all;
  await act(async () => first.onopen?.());
  await act(async () => root.render(<Probe types={["keyboard"]} />));
  const second = FakeSocket.all[1];
  expect(second.url).toContain("types=keyboard");
  await act(async () => second.onopen?.());
  expect(latest!.connected).toBe(true);

  await act(async () => {
    first.onmessage?.({
      data: JSON.stringify({
        events: [{ id: "stale", ts: 1, type: "cursor", data: {}, meta: {} }],
      }),
    });
    first.onclose?.();
  });

  expect(latest!.connected).toBe(true);
  expect(latest!.events).toEqual([]);
  expect(FakeSocket.all).toHaveLength(2);
  await act(async () => root.unmount());
});
