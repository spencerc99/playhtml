// ABOUTME: The inventory item registry — register and list items, idempotent by id.
// ABOUTME: Pure in-memory map preserving first-registration order.

import type { Item } from "./types";

export class InventoryRegistry {
  private items = new Map<string, Item>();

  register(item: Item): void {
    this.items.set(item.id, item); // Map preserves insertion order; set on existing key keeps position
  }

  get(id: string): Item | undefined {
    return this.items.get(id);
  }

  list(): Item[] {
    return [...this.items.values()];
  }
}
