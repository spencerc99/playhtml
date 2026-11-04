// ABOUTME: Verifies outgoing Yjs updates are merged into at most one message per interval.
// ABOUTME: Covers the immediate first send, trailing merge, server-origin skips, and flush.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  UPDATE_SEND_INTERVAL_MS,
  coalesceProviderUpdates,
} from "../updateCoalescer";

function fakeProvider() {
  const doc = new Y.Doc();
  const sent: Uint8Array[] = [];
  const provider: any = { doc };
  provider._updateHandler = (update: Uint8Array, origin: unknown) => {
    if (origin !== provider) sent.push(update);
  };
  doc.on("update", provider._updateHandler);
  return { doc, provider, sent };
}

describe("coalesceProviderUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first change at once and merges the rest of the interval", () => {
    const { doc, provider, sent } = fakeProvider();
    coalesceProviderUpdates(provider);
    const map = doc.getMap("play");

    map.set("x", 1);
    expect(sent).toHaveLength(1);
    map.set("x", 2);
    map.set("x", 3);
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(UPDATE_SEND_INTERVAL_MS);
    expect(sent).toHaveLength(2);

    const replica = new Y.Doc();
    for (const update of sent) Y.applyUpdate(replica, update);
    expect(replica.getMap("play").get("x")).toBe(3);
  });

  it("never sends back updates the provider applied from the server", () => {
    const { doc, provider, sent } = fakeProvider();
    coalesceProviderUpdates(provider);
    const remote = new Y.Doc();
    remote.getMap("play").set("y", 1);

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), provider);
    vi.advanceTimersByTime(UPDATE_SEND_INTERVAL_MS);

    expect(sent).toHaveLength(0);
  });

  it("flush sends buffered changes right away", () => {
    const { doc, provider, sent } = fakeProvider();
    const coalescer = coalesceProviderUpdates(provider);
    doc.getMap("play").set("x", 1);
    doc.getMap("play").set("x", 2);

    coalescer.flush();

    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(UPDATE_SEND_INTERVAL_MS);
    expect(sent).toHaveLength(2);
  });

  it("the provider's own teardown removes the coalescing listener", () => {
    const { doc, provider, sent } = fakeProvider();
    coalesceProviderUpdates(provider);
    doc.off("update", provider._updateHandler);

    doc.getMap("play").set("x", 1);

    expect(sent).toHaveLength(0);
  });
});
