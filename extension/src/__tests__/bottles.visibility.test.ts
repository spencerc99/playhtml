// ABOUTME: Verifies the shared inventory visibility state controls the bottles surface.
// ABOUTME: Covers hiding and restoring the real injected bottle shadow host.

import type { PageDataChannel, PresenceAPI } from "@playhtml/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryManager } from "../features/inventory/InventoryManager";
import { bottlesExperiment } from "../features/social/bottles";
import type { BottlePageData } from "../features/BottleManager";

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

vi.mock("../components/MessageBottle", () => ({
  MESSAGE_BOTTLE_CSS: "",
  MessageBottle: () => null,
}));

class MemoryPageDataChannel<T> implements PageDataChannel<T> {
  constructor(private data: T) {}

  getData(): T {
    return this.data;
  }

  setData(next: T | ((draft: T) => void)): void {
    if (typeof next === "function") {
      (next as (draft: T) => void)(this.data);
    }
    else this.data = next;
  }

  onUpdate(): () => void {
    return () => {};
  }

  destroy(): void {}
}

describe("bottles inventory visibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "<p id='essay'>A readable page with enough text for a bottle.</p>";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("hides and restores the bottle shadow host with the satchel objects", async () => {
    const inventoryManager = new InventoryManager();
    const channel = new MemoryPageDataChannel<BottlePageData>({ bottles: {} });
    const cleanup = await bottlesExperiment.init({
      createPageData: <T,>() => channel as unknown as PageDataChannel<T>,
      presence: {} as PresenceAPI,
      playerColor: "#4a9a8a",
      playerPid: "me",
      signPlayerPayload: async () => null,
      inventory: inventoryManager.api,
    });
    const host = document.querySelector<HTMLElement>("#we-were-online-bottles");

    expect(host).not.toBeNull();
    expect(host!.hidden).toBe(false);

    inventoryManager.api.hidePageObjects();
    expect(host!.hidden).toBe(true);

    inventoryManager.api.showPageObjects();
    expect(host!.hidden).toBe(false);

    cleanup();
  });
});
