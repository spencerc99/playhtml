// ABOUTME: Assembles the InventoryAPI from the registry, armed-state, and held-store.
// ABOUTME: Owns arm-guards (unregistered / zero-count found items can't arm).

import { InventoryRegistry } from "./registry";
import { ArmedState } from "./armed-state";
import { HeldStore } from "./held-store";
import type { ArmedTool, InventoryAPI, Item } from "./types";

export class InventoryManager {
  private registry = new InventoryRegistry();
  private armedState = new ArmedState();
  private held = new HeldStore();

  async load(): Promise<void> {
    await this.held.load();
  }

  count(itemId: string): number {
    const item = this.registry.get(itemId);
    if (!item) return 0;
    return item.tier === "system" ? Infinity : this.held.count(itemId);
  }

  readonly api: InventoryAPI = {
    register: (item: Item) => this.registry.register(item),
    list: () => this.registry.list(),
    arm: (itemId: string) => {
      const item = this.registry.get(itemId);
      if (!item) return;
      if (this.count(itemId) <= 0) return;
      this.armedState.arm(itemId);
    },
    disarm: () => this.armedState.disarm(),
    getArmed: (): ArmedTool | null => this.armedState.get(),
    onArmedChange: (cb) => this.armedState.subscribe(cb),
    count: (itemId: string) => this.count(itemId),
  };
}
