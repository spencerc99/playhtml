// ABOUTME: BottleManager.seal() unit tests — new optional note fields and the
// ABOUTME: latest-author self-reply guard.

import type { PageDataChannel } from "@playhtml/common";
import { beforeEach, describe, expect, it } from "vitest";
import { BottleManager, type BottlePageData } from "../features/BottleManager";
import type { BottleAnchor } from "../features/bottle-anchor";

const anchor: BottleAnchor = {
  selector: "body",
  offsetX: 0.5,
  offsetY: 0.5,
};

class MemoryPageDataChannel<T> implements PageDataChannel<T> {
  private listeners = new Set<(data: T) => void>();

  constructor(private data: T) {}

  getData(): T {
    return structuredClone(this.data);
  }

  setData(next: T | ((draft: T) => void)): void {
    if (typeof next === "function") {
      const draft = structuredClone(this.data);
      const mutate = next as (draft: T) => void;
      mutate(draft);
      this.data = draft;
    } else {
      this.data = structuredClone(next);
    }
    for (const listener of this.listeners) listener(this.getData());
  }

  onUpdate(callback: (data: T) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  destroy(): void {
    this.listeners.clear();
  }

  // Test-only accessor for reading current state without cloning semantics
  // mattering to the assertion.
  read(): T {
    return this.getData();
  }
}

function createPageDataWith(data: BottlePageData) {
  return <T,>(_name: string, _defaultValue: T): PageDataChannel<T> =>
    new MemoryPageDataChannel(data as T);
}

function makeManager(
  channel: MemoryPageDataChannel<BottlePageData>,
  pid = "me",
) {
  const createPageData = <T,>(_name: string, _defaultValue: T) =>
    channel as unknown as PageDataChannel<T>;
  const mgr = new BottleManager("#4a9a8a", pid, createPageData);
  mgr.init(() => {});
  return mgr;
}

describe("BottleManager.seal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists authorName, styleId, and pageUrl on the note", () => {
    const channel = new MemoryPageDataChannel<BottlePageData>({ bottles: {} });
    const mgr = makeManager(channel);
    const ok = mgr.seal(
      "hello",
      { id: "b1", anchor },
      { authorName: "Spencer", styleId: "web1" },
    );
    expect(ok).toBe(true);
    const bottle = Object.values(channel.read().bottles)[0];
    expect(bottle.notes[0].authorName).toBe("Spencer");
    expect(bottle.notes[0].styleId).toBe("web1");
    expect(bottle.notes[0].pageUrl).toBe(window.location.href);
  });

  it("omits meta fields when not provided (legacy-shaped note)", () => {
    const channel = new MemoryPageDataChannel<BottlePageData>({ bottles: {} });
    const mgr = makeManager(channel);
    mgr.seal("hello", { id: "b1", anchor });
    const bottle = Object.values(channel.read().bottles)[0];
    expect(bottle.notes[0].authorName).toBeUndefined();
    expect(bottle.notes[0].styleId).toBeUndefined();
  });

  it("rejects a reply when the latest note is our own", () => {
    const channel = new MemoryPageDataChannel<BottlePageData>({
      bottles: {
        b1: {
          id: "b1",
          anchor,
          notes: [
            { text: "first", createdAt: 1, createdBy: "me", authorColor: "#000" },
          ],
        },
      },
    });
    const mgr = makeManager(channel, "me");
    const ok = mgr.seal("again", { id: "b1", anchor });
    expect(ok).toBe(false);
    expect(channel.read().bottles.b1.notes).toHaveLength(1);
  });

  it("allows a reply when the latest note is someone else's", () => {
    const channel = new MemoryPageDataChannel<BottlePageData>({
      bottles: {
        b1: {
          id: "b1",
          anchor,
          notes: [
            { text: "first", createdAt: 1, createdBy: "them", authorColor: "#000" },
          ],
        },
      },
    });
    const mgr = makeManager(channel, "me");
    const ok = mgr.seal("reply", { id: "b1", anchor });
    expect(ok).toBe(true);
    expect(channel.read().bottles.b1.notes).toHaveLength(2);
  });
});
