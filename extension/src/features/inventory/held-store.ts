// ABOUTME: Persists per-browser found-item counts in browser.storage.local.
// ABOUTME: System tools are infinite and not tracked here; this is the future-economy seam.

import browser from "webextension-polyfill";
import type { HeldInventory } from "./types";

const STORAGE_KEY = "inventory:held:v1";

export class HeldStore {
  private held: HeldInventory = { found: {} };

  async load(): Promise<void> {
    const res = await browser.storage.local.get([STORAGE_KEY]);
    const stored = res[STORAGE_KEY] as HeldInventory | undefined;
    this.held = stored ?? { found: {} };
  }

  count(itemId: string): number {
    return this.held.found[itemId] ?? 0;
  }

  async set(itemId: string, n: number): Promise<void> {
    this.held.found[itemId] = n;
    await browser.storage.local.set({ [STORAGE_KEY]: this.held });
  }
}
