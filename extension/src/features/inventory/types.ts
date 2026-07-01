// ABOUTME: Core inventory types — items, tiers, the armed tool, and the public InventoryAPI.
// ABOUTME: Shared by the manager, the satchel UI, and the social experiments that register items.

export type ItemTier = "system" | "found";

export interface Item {
  /** Stable id, e.g. "quarantine-tape", "message-bottle". */
  id: string;
  tier: ItemTier;
  /** Human label shown in tooltips. */
  label: string;
  /** Asset URL for the cut-out icon (resolved via browser.runtime.getURL at register time). */
  icon: string;
  /** Author/player color carried for experiments to use (e.g. an armed edge glow); inventory itself doesn't render it yet. */
  accent?: string;
}

export interface ArmedTool {
  itemId: string;
}

/** Personal, per-browser. System tools are implicit (always held); this tracks found-item counts. */
export interface HeldInventory {
  found: Record<string, number>; // itemId -> count
}

export interface InventoryAPI {
  /** Register an item this experiment provides. Idempotent by id (last wins). */
  register(item: Item): void;
  /** All registered items, in registration order. */
  list(): Item[];
  /** Arm an item by id. No-op if the item isn't registered or (for found items) count is 0. */
  arm(itemId: string): void;
  /** Disarm whatever is armed. */
  disarm(): void;
  /** The currently armed tool, or null. */
  getArmed(): ArmedTool | null;
  /** Subscribe to arm/disarm changes. Returns an unsubscribe fn. */
  onArmedChange(cb: (armed: ArmedTool | null) => void): () => void;
  /** Count for an item. Infinite (system) items return Infinity. */
  count(itemId: string): number;
}
